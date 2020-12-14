/** Copyright Stewart Allen <sa@grid.space> -- All Rights Reserved */

"use strict";

/**
 * About
 *
 * provide raw socket, web socket, and web interface to serial-controlled
 * hardware such as FDM 3D printers and CNC mills based on marlin derived
 * firmwares.
 */

const vernum = "018";
const version = `Serial [${vernum}]`;

const LineBuffer = require("./linebuffer");
const SerialPort = require('serialport');
const { exec, spawn } = require('child_process');
const path = require('path');
const opt = require('minimist')(process.argv.slice(2));
const net = require('net');
const fs = require('fs');

const os = require('os');
const url = require('url');
const http = require('http');
const https = require('https');
const serve = require('serve-static');
const moment = require('moment');
const connect = require('connect');
const WebSocket = require('ws');
const bedclear = "etc/bedclear";
const oport = opt.device || opt.port || opt._[0]; // serial port device path

let baud = parseInt(opt.baud || "250000");      // baud rate for serial port
let filedir = opt.dir || opt.filedir || `${process.cwd()}/tmp`;
let webdir = opt.webdir || "src/web";
let webport = parseInt(opt.web || opt.webport || 4080) || 0;
let grid = opt.grid || "https://live.grid.space";
let mode = opt.mode || "fdm";
let grbl = opt.grbl ? true : false;
let ctrlport = opt.listen;
let gridlast = '*';

const STATES = {
    IDLE: "idle",
    NODEVICE: "no controller",
    CONNECTING: "connecting",
    PRINTING: "printing",
    MILLING: "milling",
    FLASHING: "flashing"
};

const MCODE = {
    M92:  "steps_per",
    M201: "accel_max",
    M203: "feedrate_max",
    M204: "accel",
    M205: "advanced",
    M206: "home_offset",
    M301: "pid_tuning",
    M420: "UBL",
    M851: "z_probe_offset",
    M900: "linear_advance",
    M906: "stepper_current",
    M913: "hybrid_threshold",
    M914: "stallguard"
};

let bufdefault = parseInt(opt.buflen || mode === 'cnc' ? 3 : 8);
let bufmax = bufdefault;        // max unack'd output lines
let port = oport;               // default port (possible to probe)
let checksum = opt.checksum;    // use line numbers and checksums
let lineno = 1;                 // next output line number
let starting = false;           // output phase just after reset
let quiescence = false;         // achieved quiescence after serial open
let waiting = 0;                // unack'd output lines
let maxout = 0;                 // high water mark for buffer
let paused = false;             // queue processing paused
let processing = false;         // queue being drained
let cancel = false;             // job cancel requested
let updating = false;           // true when updating firmware
let sdspool = false;            // spool to sd for printing
let dircache = [];              // cache of files in watched directory
let clients = [];               // connected clients
let buf = [];                   // output line buffer
let match = [];                 // queue for matching command with response
let collect = null;             // collect lines between oks
let sport = null;               // bound serial port
let upload = null;              // name of file being uploaded
let debug = opt.debug;          // debug and dump all data
let extrude = true;             // enable / disable extrusion
let onboot = [];                // commands to run on boot
let onabort = [];               // commands to run on job abort
let onboot_fdm = [
    "M155 S2",          // report temp every 2 seconds
    "M115",             // get firmware info
    "M211",             // get endstop boundaries
    "M119",             // get endstop status
    "M114"              // get position
];
let onboot_cnc = [
    "G21",              // metric units
    "G90",              // absolute moves
    "G92 X0 Y0 Z0"      // zero out XYZ
];
let onabort_fdm = [
    "G21",              // metric units
    "G90",              // absolute moves
    "G92 X0 Y0 Z0 E0",  // zero out XYZE
    "M155 S2",          // report temp every 2 seconds
    "M104 S0 T0",       // extruder 0 heat off
    "M140 S0 T0",       // bed heat off
    "M107",             // shut off cooling fan
    "G91",              // set relative moves
    "G0 Z10 X0 Y0",     // drop bed 1cm
    "G28 XY",           // home X & Y
    "G90",              // restore absolute moves
    "M84"               // disable steppers
];
let onabort_cnc = [
    "G21",              // metric units
    "G90",              // absolute moves
    "G92 X0 Y0 Z0",     // zero out XYZ
    "M84"               // disable steppers
];
let onerror = onabort.slice();
let onpause = [
    "*pos-push"
];
let onresume = [
    "*pos-pop"
];
let uuid = [
    Date.now().toString(36),
    Math.round(Math.random() * 0xffffffff).toString(36),
    Math.round(Math.random() * 0xffffffff).toString(36),
].join('-');

// marlin-centric, to be fixed
const status = {
    now: 0,                     // server's current time
    state: STATES.NODEVICE,     // server state
    clients: {
        ws: 0,                  // web socket client count
        net: 0,                 // direct network clients
        stdin: 0                // 1 of stdin active
    },
    buffer: {
        waiting: 0,             // unack'd output
        queue: 0,               // queue depth
        match: null,            // current outstanding commands
        collect: null           // lines collected against current command
    },
    flags: {                    // status of internal flags
        debug,                  // verbose serial port tracking
        extrude                 // extrusion enabled / disabled
    },
    device: {
        addr: [],               // ip addresses
        port: webport,          // admin port
        name: os.hostname(),    // device host name for web display
        uuid,
        mode,                   // device mode: fdm or cnc
        grbl,                   // cnc grbl mode
        version,                // version of code running
        firm: {                 // firmware version and author
            ver: "?",
            auth: "?"
        },
        min: {                  // read from M211
            X: 0.0,
            Y: 0.0,
            Z: 0.0
        },
        max: {                  // read from M211
            X: 300.0,
            Y: 300.0,
            Z: 300.0
        },
        ready: false,           // true when connected and post-init
        boot: 0,                // time of last boot
        connect: 0,             // time port was opened successfully
        close: 0,               // time of last close
        line: 0,                // time of last line output
        lines: 0,               // number of lines recieved from device
        lineno: 0,              // last line # sent
        camera: false,          // true if camera present
    },
    error: {
        time: 0,                // time of last error
        cause: null             // last error message
    },
    print: {
        run: false,             // print running
        pause: false,           // true if paused
        abort: false,           // true if aborted
        cancel: false,          // true if cancelled
        clear: false,           // bed is clear to print
        filename: null,         // current file name
        outdir: null,           // output of current print (images)
        outseq: 0,              // output image sequence #
        progress: 0.0,          // 0.00-100% progress tracker
        prep: 0,                // gcode pre start time
        start: 0,               // gcode print start time
        mark: 0,                // gcode last line out time
        end: 0,                 // gcode end of queue time
        emit: 0                 // total mm extruded
    },
    target: {                   // target temp
        bed: null,              // bed
        ext: [ null ]           // extruders
    },
    temp: {                     // measured temp
        bed: null,              // bed
        ext: [ null ]           // extruders
    },
    pos: {                      // current gcode position
        X: 0,
        Y: 0,
        Z: 0,
        E: 0,
        rel: false,             // relative moves
        stack: []               // saved positions
    },
    grbl: {
        wco: [0,0,0],
        pos: [0,0,0]
    },
    feed: 1,                    // feed scaling
    estop: {                    // endstop status
        min: {},
        max: {}
    },
    settings: {}                // map of active settings
};

function load_config() {
    try {
        if (lastmod('etc/server.json')) {
            let json = eval('('+fs.readFileSync('etc/server.json').toString()+')');
            let opt = json.opt || json;
            status.device.mode = mode = opt.mode || mode;
            status.device.grbl = grbl = opt.grbl || grbl;
            onboot = mode === 'fdm' ? onboot_fdm : onboot_cnc;
            onabort = mode === 'fdm' ? onabort_fdm : onabort_cnc;
            let on = json.on || {};
            if (Array.isArray(on.boot)) onboot = on.boot;
            if (Array.isArray(on.abort)) onabort = on.abort;
            if (Array.isArray(on.error)) onerror = on.error;
            if (Array.isArray(on.pause)) onpause = on.pause;
            if (Array.isArray(on.resume)) onresume = on.resume;
            filedir = opt.filedir || filedir;
            grid = opt.grid || grid;
            port = opt.port || port;
            baud = opt.baud || baud;
            bufmax = opt.maxbuf || opt.bufmax || bufmax;
            webport = opt.webport || webport;
            ctrlport = opt.listen || opt.ctrlport || ctrlport;
            webdir = opt.webdir || webdir;
            debug = opt.debug || debug;
        } else {
            onboot = mode === 'fdm' ? onboot_fdm : onboot_cnc;
            onabort = mode === 'fdm' ? onabort_fdm : onabort_cnc;
        }
    } catch (e) {
        console.log({error_reading_config: e});
    }
}

// write line to all connected clients
function emit(line, flags) {
    const stat = flags && flags.status;
    const list = flags && flags.list;
    if (typeof(line) === 'object') {
        line = JSON.stringify(line);
    }
    clients.forEach(client => {
        let error = flags && flags.error;
        let cstat = (stat && client.request_status);
        let clist = (list && client.request_list) || (list && !flags.channel && !client.console);
        let cmatch = flags && flags.channel === client;
        if (error || cmatch || cstat || clist || (client.monitoring && !stat && !list)) {
            client.write(line + "\n");
            if (cstat) {
                client.request_status = false;
            }
            if (clist) {
                client.request_list = false;
            }
        }
    });
}

function mkdir(dir) {
    try {
        fs.mkdirSync(dir);
    } catch (e) { }
}

function lastmod(file) {
    try {
        return fs.statSync(file).mtimeMs;
    } catch (e) {
        return 0;
    }
}

function cmdlog(line, flags) {
    if (debug) {
        return;
    }
    if (flags && flags.print && !opt.verbose) {
        return;
    }
    if (typeof(line) === 'object') {
        line = JSON.stringify(line);
    }
    emit("[" + waiting + ":" + bufmax + "," + buf.length + ":" + maxout + "] " + line, flags);
};

// send *** message *** to all clients (not stdout unless stdin specified)
function evtlog(line, flags) {
    if (typeof(line) === 'object') {
        line = JSON.stringify(line);
    }
    emit("*** " + line + " ***", flags);
};

// find the port with the controller
function probe_serial(then) {
    let nport = undefined;
    let nbaud = undefined;
    let nmode = undefined;
    SerialPort.list().then(ports => {
        for (let port of ports) {
            let { manufacturer, vendorId, productId, serialNumber, pnpId, path, comName } = port;
            let npath = path || comName;
            let manu = manufacturer ? manufacturer.toLowerCase().trim() : '';
            let args = [ npath, manu, vendorId, productId, pnpId, serialNumber ].filter(v => v);
            console.log('... scanning', ...args);
            if (port.pnpId) {
                nport = npath;
            } else if (manu.indexOf("arduino") >= 0 || manu.indexOf('marlinfw.org') >= 0) {
                nport = npath;
            } else if (!nport && (vendorId || productId || serialNumber)) {
                nport = port.comnName;
            }
            // sainsmart genmitsu
            if (nport && vendorId === '1a86' && productId === '7523') {
                console.log(`--- found SainSmart Genmitsu 3018 ---`);
                nbaud = 115200;
                nmode = 'cnc';
                break;
            }
        }
        then(nport, nbaud, nmode);
    });
}

function on_serial_port() {
    if (updating || !port || sport) {
        if (!status.device.ready) {
            status.state = updating ? STATES.FLASHING : STATES.NODEVICE;
        }
        setTimeout(on_serial_port, 2000);
        return;
    }
    sport = new SerialPort(port, { baudRate: baud })
        .on('open', function() {
            evtlog("open: " + port);
            new LineBuffer(sport, on_serial_line);
            status.device.connect = Date.now();
            status.device.lines = 0;
            status.state = STATES.CONNECTING;
            status.print.pause = paused = false;
            lineno = 1;
            starting = false;
            quiescence = false;
            // wait up to 3 seconds on new open for device input.
            // if no input received, call on_quiescence() which causes
            // a "bump boot". wait up to 3 more seconds and if no input
            // then close the port which will re-start the whole cycle.
            setTimeout(() => {
                if (status.device.lines === 0) {
                    evtlog("device input timeout");
                    on_quiescence();
                    setTimeout(() => {
                        if (status.device.lines === 0) {
                            evtlog("device not responding. reopening port.");
                            sport.close();
                        }
                    }, 3000);
                }
            }, 3000);
        })
        .on('error', function(error) {
            sport = null;
            console.log(error);
            setTimeout(on_serial_port, 2000);
            status.device.connect = 0;
            status.device.ready = false;
        })
        // .on('line', on_serial_line)
        .on('close', function() {
            sport = null;
            evtlog("close");
            setTimeout(on_serial_port, 2000);
            status.device.close = Date.now();
            status.device.ready = false;
            status.state = STATES.NODEVICE;
        });
}

let wait_quiesce = null;
let wait_counter = 0;
let wait_time = 10000;

function quiescence_waiter() {
    clearTimeout(wait_quiesce);
    evtlog(`await quiescence ${wait_counter}, currently ${status.device.lines}`);
    if (status.device.lines === wait_counter) {
        wait_quiesce = null;
        quiescence = true;
        on_quiescence();
    } else {
        wait_counter = status.device.lines;
        wait_quiesce = setTimeout(quiescence_waiter, 1000);
    }
}

// perform boot sequence upon quiescence
function on_quiescence() {
    evtlog(`on quiescence starting=${starting}`);
    if (starting) {
        collect = [];
        starting = false;
        status.state = STATES.IDLE;
        evtlog("device ready");
    } else {
        if (!sport) {
            evtlog("bump boot: missing serial port. exiting.");
            return process.exit(1);
        }
        evtlog("bump boot");
        if (!grbl) {
            sport.write('\r\nM110 N0\r\n');
            sport.flush();
            onboot.push('M503')
        }
        on_serial_line('start');
        status.device.firm.ver = 'new';
        status.device.firm.auth = 'new';
        // request info and new quiescence
        starting = true;
        quiescence_waiter();
    }
    evtlog(`on boot commands: ${onboot.length}`);
    // queue onboot commands
    onboot.forEach(cmd => {
        queue(cmd);
    });
    onboot = [];
    // allow remote spooling
    // grid_spool();
}

// handle a single line of serial input
function on_serial_line(line) {
    // on first line, setup a quiescence timer
    if (status.device.lines++ === 0) {
        wait_counter = status.device.lines;
        wait_quiesce = setTimeout(quiescence_waiter, 2000);
    } else if (wait_quiesce) {
        quiescence_waiter();
    }
    if (debug) {
        let cmd = (match[0] || {line:''}).line;
        console.log("<... " + (cmd ? cmd + " -- " + line : line));
    }
    status.device.line = Date.now();
    line = line.toString().trim();
    if (line.length === 0) {
        return;
    }
    let matched = false;
    let istemp = false;
    let update = false;
    // parse M105/M155 temperature updates
    if (line.indexOf("T:") === 0) {
        istemp = true;
        // eliminate spaces before slashes " /"
        let toks = line.replace(/ \//g,'/').split(' ');
        // parse extruder/bed temps
        toks.forEach(tok => {
            tok = tok.split(":");
            switch (tok[0]) {
                case 'T':
                    tok = tok[1].split("/");
                    status.temp.ext[0] = parseFloat(tok[0]);
                    status.target.ext[0] = parseFloat(tok[1]);
                    update = true;
                    break;
                case 'B':
                    tok = tok[1].split("/");
                    status.temp.bed = parseFloat(tok[0]);
                    status.target.bed = parseFloat(tok[1]);
                    update = true;
                    break;
            }
        });
    }
    if (line.indexOf("ok") === 0 || line.indexOf("error:") === 0) {
        // match output to an initiating command (from a queue)
        if (line.indexOf("ok ") === 0 && collect) {
            line = line.substring(3);
            collect.push(line);
        }
        matched = match.shift();
        let from = matched ? matched.line : "???";
        let flags = matched ? matched.flags : {};
        // if checksumming is enabled, lines start with Nxxxx
        if (line.charAt(0) === 'N') {
            let lno = parseInt(line.split(' ')[0].substring(1));
            if (lno !== flags.lineno) {
                console.log({mismatch: line, lno, matched, collect});
            }
        }
        // callbacks used by M117 to track start of print
        if (matched && flags.callback) {
            flags.callback(collect, matched.line);
        }
        // emit collected lines
        if (collect && collect.length) {
            if (collect.length >= 4) {
                cmdlog("==> " + from, flags);
                collect.forEach((el, i) => {
                    if (i === 0) {
                        cmdlog("<-- " + el, flags);
                    } else {
                        cmdlog("    " + el, flags);
                    }
                });
            } else {
                cmdlog("==> " + from + " -- " + JSON.stringify(collect), flags);
            }
        }
        status.buffer.waiting = waiting = Math.max(waiting - 1, 0);
        if (paused && waiting === 0 && on_pause_handler) {
            let do_handler = on_pause_handler;
            on_pause_handler = null;
            do_handler();
        }
        if (status.update) {
            status.update = false;
        }
        collect = [];
    } else if (collect && !istemp) {
        collect.push(line);
    } else if (!istemp) {
        cmdlog("<-- " + line, {matched});
    }
    // force output of eeprom settings because it doesn't happen under these conditions
    if (line.indexOf("echo:EEPROM version mismatch") === 0) {
        evtlog("M503 on eeprom version mismatch");
        write("M503");
    }
    // status.buffer.match = match;
    status.buffer.collect = collect;
    // 8-bit marlin systems send "start" on a serial port open
    if (line === "start") {
        lineno = 1;
        update = true;
        starting = true;
        status.device.ready = true;
        status.device.boot = Date.now();
        status.buffer.waiting = waiting = 0;
        collect = null;
        match = [];
        buf = [];
    }
    // parse M114 x/y/z/e positions
    if (line.indexOf("X:") === 0) {
        let pos = status.pos = { stack:[] };
        let done = false;
        line.split(' ').forEach(tok => {
            if (done) {
                return;
            }
            tok = tok.split(':');
            if (tok.length === 2) {
                // do not overwrite value (Z: comes twice, for example)
                if (!pos[tok[0]]) {
                    pos[tok[0]] = parseFloat(tok[1]);
                    update = true;
                }
            } else {
                done = true;
            }
        });
    }
    // parse M119 endstop status
    if (line.indexOf("_min:") > 0) {
        status.estop.min[line.substring(0,1)] = line.substring(6);
        update = true;
    }
    if (line.indexOf("_max:") > 0) {
        status.estop.max[line.substring(0,1)] = line.substring(6);
        update = true;
    }
    // parse Marlin version
    if (line.indexOf("echo:Marlin") === 0) {
        status.device.firm.ver = line.split(' ')[1];
    }
    // parse last compile info
    if (line.indexOf("echo: Last Updated") === 0) {
        status.device.firm.auth = line.substring(line.lastIndexOf('(')+1, line.lastIndexOf(')'));
    }
    // parse M503 settings status
    if (line.indexOf("echo:  M") === 0) {
        let toks = line.substring(7).split(' ');
        let code = toks.shift();
        let map = {};
        toks.forEach(tok => {
            map[tok.substring(0,1)] = parseFloat(tok.substring(1));
        });
        status.settings[code] = map;
        update = true;
    }
    // parse M115 output
    if (line.indexOf("FIRMWARE_NAME:") === 0) {
        let fni = line.indexOf("FIRMWARE_NAME:");
        let sci = line.indexOf("SOURCE_CODE_URL:");
        if (fni >= 0 && sci > fni) {
            status.device.firm.ver = line.substring(fni + 14, sci).trim();
        }
        let mti = line.indexOf("MACHINE_TYPE:");
        let eci = line.indexOf("EXTRUDER_COUNT:");
        if (mti > 0 && eci > mti) {
            status.device.firm.auth = line.substring(mti + 13, eci).trim();
        }
    }
    // parse M211 output
    if (line.indexOf("echo:Soft endstops:") >= 0) {
        let minpos = line.indexOf("Min:");
        let maxpos = line.indexOf("Max:");
        if (minpos > 0 && maxpos > minpos) {
            line.substring(minpos+5, maxpos)
                .trim()
                .split(' ')
                .forEach(v => {
                    status.device.min[v.charAt(0)] = parseFloat(v.substring(1));
                });
            line.substring(maxpos+5)
                .trim()
                .split(' ')
                .forEach(v => {
                    status.device.max[v.charAt(0)] = parseFloat(v.substring(1));
                });
        }
    }
    if (line.indexOf("Grbl 1.1") === 0 && mode === 'cnc') {
        evtlog(`enabling grbl support`);
        status.device.grbl = grbl = true;
    }
    // parse GRBL position
    if (line.charAt(0) === '<' && line.charAt(line.length-1) === '>') {
        let gopt = status.grbl;
        let grbl = line.substring(1,line.length-2).split('|').forEach(tok => {
            tok = tok.split(':');
            if (tok[0] === 'MPos') gopt.pos = tok[1].split(',').map(v => parseFloat(v));
            if (tok[0] === 'WCO') gopt.wco = tok[1].split(',').map(v => parseFloat(v));
        });
        status.pos.X = gopt.pos[0] - gopt.wco[0];
        status.pos.Y = gopt.pos[1] - gopt.wco[1];
        status.pos.Z = gopt.pos[2] - gopt.wco[2];
    }
    // resend on checksum errors
    if (line.indexOf("Resend:") === 0) {
        let from = line.split(' ')[1];
        evtlog(`resend from ${from}`, {error: true});
        sport.close();
        process.exit(-1);
    }
    // catch fatal errors and reboot
    if (!opt.noerror && line.indexOf("Error:") === 0) {
        status.error = {
            time: Date.now(),
            cause: line.substring(6)
        };
        evtlog(line, {error: true});
        if (line.indexOf("Error:checksum mismatch") === 0) {
            // ignore then act on 'Resend:'
        } else {
            try {
                sport.close();
                onboot = onerror;
            } catch (e) { }
            if (opt.fragile) {
                if (debug) {
                    console.log({status});
                    process.exit(-1);
                }
            }
        }
    }
    // catch processing errors and reboot
    if (opt.fragile && line.indexOf("Unknown command:") >= 0) {
        evtlog(`fatal: ${line}`, {error: true});
        sport.close();
        if (debug) {
            console.log({status});
            process.exit(-1);
        }
    }
    if (update) {
        status.update = true;
    }
    process_queue();
}

function bed_clear() {
    status.print.clear = true;
    status.update = true;
    send_status();
    try {
        fs.closeSync(fs.openSync(bedclear, 'w'));
    } catch (e) {
        console.log(e);
        evtlog("marking bed clear");
    }
}

function bed_dirty() {
    status.print.clear = false;
    status.update = true;
    send_status();
    try {
        fs.unlinkSync(bedclear);
    } catch (e) {
        console.log(e);
    }
    evtlog("marking bed dirty");
}

function is_bed_clear() {
    let old = status.print.clear;
    try {
        fs.statSync(bedclear);
        status.print.clear = true;
    } catch (e) {
        status.print.clear = false;
    }
    if (status.print.clear !== old) {
        status.update = true;
    }
    return status.print.clear;
}

function clear_dir(dir, remove) {
    fs.readdirSync(dir).forEach(file => {
        fs.unlinkSync(path.join(dir, file));
    });
    if (remove) {
        fs.rmdirSync(dir);
    }
}

function send_file(filename) {
    if (!check_device_ready()) {
        return;
    }
    if (!status.print.clear) {
        return evtlog("bed not marked clear. use *clear first", {error: true});
    }
    if (fs.statSync(filename).size === 0) {
        return evtlog("invalid file: empty", {error: true});
    }
    status.print.run = true;
    status.print.abort = false;
    status.print.pause = paused = false;
    status.print.cancel = cancel = false;
    status.print.filename = filename;
    status.print.outdir = filename.substring(0, filename.lastIndexOf(".")) + ".output";
    status.print.outseq = 0;
    status.print.start = Date.now();
    status.state = mode === 'cnc' ? STATES.MILLING : STATES.PRINTING;
    evtlog(`job head ${filename}`);
    try {
        let stat = null;
        try {
            stat = fs.statSync(status.print.outdir);
        } catch (e) {
            // no such directory
        }
        if (stat && stat.isDirectory()) {
            clear_dir(status.print.outdir);
        } else {
            mkdir(status.print.outdir);
        }
        let gcode = fs.readFileSync(filename).toString().split("\n");
        if (sdspool) {
            evtlog(`spooling "${filename} to SD"`);
            queue(`M28 print.gco`);
            gcode.forEach(line => {
                queue(line);
            });
            queue(`M29`);
            evtlog(`printing "${filename} from SD"`);
            queue(`M23 print.gco`);
            queue(`M24`);
        } else {
            gcode.forEach(line => {
                queue(line, {print: true});
            });
        }
    } catch (e) {
        evtlog("error sending file", {error: true});
        console.log(e);
    }
}

function send_status(pretty) {
    evtlog(JSON.stringify(status,undefined,pretty), {status: true});
}

function process_input(line, channel) {
    try {
        process_input_two(line, channel);
    } catch (e) {
        console.trace(line, e);
    }
}

function process_input_two(line, channel) {
    line = line.toString().trim();
    // remap *name to an *exec call
    if (line.indexOf("*name ") === 0) {
        status.device.name = line.substring(6);
        line = `*exec sudo bin/update-name.sh ${status.device.name}`;
    }
    // remap *wifi to an *exec call
    if (line.indexOf("*wifi ") === 0) {
        line = `*exec sudo bin/update-wifi.sh ${line.substring(6)}`;
    }
    // handle *exec calls
    if (line.indexOf("*exec ") === 0) {
        let cmd = line.substring(6);
        evtlog(`exec: ${cmd}`, {channel});
        exec(cmd, (err, stdout, stderr) => {
            (stdout || stderr).split('\n').forEach(line => {
                if (line) {
                    evtlog("--> " + line, {channel});
                }
            });
            if (stderr) {
                evtlog(JSON.stringify({cmd, err, stdout, stderr}));
            }
        });
        return;
    }
    // handle *buf reset
    if (line.indexOf('*buf ') === 0) {
        bufmax = parseInt(line.substring(5));
        return;
    }
    // handle feed scaling
    if (line.indexOf('*feed ') === 0) {
        return status.feed = parseFloat(line.substring(6));
    }
    // debug tokenization
    if (line.indexOf("*tok ") === 0) {
        return evtlog(tokenize_line(line.substring(5)).join(','));
    }
    let pretty = undefined;
    switch (line) {
        case "*exit": return process.exit(0);
        case "*bounce": return sport ? sport.close() : null;
        case "*debug on": return debug = true;
        case "*debug off": return debug = false;
        case "*extrude on": return extrude = true;
        case "*extrude off": return extrude = false;
        case "*setmode fdm": return status.device.mode = 'fdm';
        case "*setmode cnc": return status.device.mode = 'cnc';
        case "*match":
            console.log({match});
            return;
        case "*list":
            if (channel) {
                channel.request_list = true;
            }
            return evtlog(JSON.stringify(dircache), {list: true, channel});
        case "*clearkick":
            bed_clear();
        case "*kick":
            if (status.print.run) {
                return evtlog("job in progress");
            }
            return kick_next();
        case "*update": return update_firmware();
        case "*cancel": return job_cancel();
        case "*abort": return job_abort();
        case "*resume": return job_resume();
        case "*clear":
            bed_clear();
            return evtlog("bed marked clear");
        case "*monitor on":
            if (channel && !channel.monitoring) {
                channel.monitoring = true;
                evtlog("monitoring enabled");
            }
            return;
        case "*monitor off":
            if (channel && channel.monitoring) {
                evtlog("monitoring disabled");
                channel.monitoring = false;
            }
            return;
        case "*status+":
            pretty = 2;
        case "*status":
            status.now = Date.now();
            status.flags.debug = debug;
            status.flags.extrude = extrude;
            if (channel) {
                channel.request_status = true;
            }
            return send_status(pretty);
            // return evtlog(JSON.stringify(status,undefined,pretty), {status: true});
        case "*center":
            queue_priority(`G0 X${status.device.max.X/2} Y${status.device.max.Y/2} F6000`, channel);
            return;
    }
    if (line === '*pause' || line.indexOf('*pause ') === 0) {
        line = line.split(' ');
        return job_pause(line[1]);
    }
    if (line.indexOf("*update ") === 0) {
        let file = line.substring(8);
        if (file.indexOf(".hex") < 0) {
            file += ".hex";
        }
        return update_firmware(file);
    }
    if (line.indexOf("*upload ") === 0) {
        if (channel.linebuf) {
            // accumulate all input data to linebuffer w/ no line breaks
            channel.linebuf.enabled = false;
            upload = line.substring(8);
            // evtlog({upload});
        } else {
            evtlog({no_upload_possible: channel});
        }
    } else if (line.indexOf("*delete ") === 0) {
        let base = line.substring(8);
        let eio = base.lastIndexOf(".");
        if (eio > 0) {
            base = base.substring(0, eio);
        }
        let files = [
            path.join(filedir, base + ".nc"),
            path.join(filedir, base + ".hex"),
            path.join(filedir, base + ".gcode"),
            path.join(filedir, base + ".print"),
            path.join(filedir, encodeURIComponent(base + ".gcode"))
        ];
        remove_files(files, (res) => {
            try {
                clear_dir(path.join(filedir, base + ".output"), true);
            } catch (e) {
                evtlog(`no output dir for ${base}`);
            }
            check_file_dir(true);
        });
    } else if (line.indexOf("*kick ") === 0) {
        if (status.print.run) {
            return evtlog("job in progress", {channel});
        }
        let file = line.substring(6);
        if (file.indexOf(".gcode") < 0) {
            file += ".gcode";
        }
        kick_named(path.join(filedir, file));
    } else if (line.indexOf("*runbox ") === 0) {
        if (status.print.run) {
            return evtlog("job in progress", {channel});
        }
        let opt = line.substring(8).split('@').map(v => v.trim());
        let file = opt[0];
        if (file.indexOf(".gcode") < 0) {
            file += ".gcode";
        }
        runbox(path.join(filedir, file), parseInt(opt[1] || 3000));
    } else if (line.indexOf("*send ") === 0) {
        send_file(line.substring(6));
    } else if (line.charAt(0) === '!') {
        let ecmd = line.substring(1);
        if (sport) {
            sport.write(`${ecmd}\n`);
            evtlog(`emergency command issued: ${ecmd}`);
        } else {
            evtlog(`missing port for emergency command: ${ecmd}`);
        }
    } else if (line.charAt(0) !== "*") {
        queue_priority(line, channel);
    } else {
        evtlog(`invalid command "${line.substring(1)}"`, {channel});
    }
};

function remove_files(files, ondone, res) {
    res = res || [];
    if (files && files.length) {
        let file = files.shift();
        fs.unlink(file, (err) => {
            res.push({file, err});
            remove_files(files, ondone, res);
        });
    } else {
        ondone(res);
    }
}

function update_firmware(hexfile, retry) {
    if (updating) {
        return;
    }
    if (sport) {
        if (retry === undefined) {
            retry = 3;
        }
        if (retry === 0) {
            evtlog(`update aborted. serial port open.`);
            return;
        }
        evtlog(`update delayed. serial port open. retries left=${retry}`);
        setTimeout(() => {
            update_firmware(hexfile, retry-1);
        }, 1000);
    }
    updating = true;
    let choose = hexfile || "marlin.ino.hex";
    let newest = 0;
    let fwdir = opt.fwdir || filedir || `${process.cwd()}/firmware`;
    if (!hexfile) {
        fs.readdirSync(fwdir).forEach(file => {
            if (file.indexOf(".hex") < 0) {
                return;
            }
            let stat = fs.statSync(`${fwdir}/${file}`);
            if (stat.mtimeMs > newest) {
                newest = stat.mtimeMs;
                choose = file;
            }
        });
    }
    if (sport) {
        sport.close();
    }
    evtlog(`flashing with ${choose}`, {error: true});
    let proc = spawn("avrdude", [
            "-patmega2560",
            "-cwiring",
            `-P${port}`,
            "-b115200",
            "-D",
            `-Uflash:w:${fwdir}/${choose}:i`
        ])
        .on('error', error => {
            updating = false;
            evtlog("flash update failed", {error: true});
        })
        .on('exit', code => {
            updating = false;
            if (code === 0) {
                evtlog(`flash update completed`, {error: true});
                setTimeout(() => {
                    // bounce controller after successful firmware update
                    process.exit(0);
                }, 1000);
            } else {
                evtlog("flash update failed", {error: true});
            }
        });
    new LineBuffer(proc.stdout);
    new LineBuffer(proc.stderr);
    proc.stdout.on('line', line => { if (line.toString().trim()) evtlog(line.toString()) });
    proc.stderr.on('line', line => { if (line.toString().trim()) evtlog(line.toString()) });
}

function check_device_ready() {
    if (!status.device.ready) {
        evtlog("device missing or not ready", {error: true});
        return false;
    }
    return true;
}

function job_cancel() {
    if (!check_device_ready()) {
        return;
    }
    evtlog("job cancelled");
    status.print.cancel = cancel = true;
    buf = [];
}

function job_abort() {
    if (!check_device_ready()) {
        return;
    }
    evtlog("job aborted", {error: true});
    sport.write('\nM999\n');
    sport.write('\nM410\n');
    buf = [];
    onboot = onabort;
    status.print.pause = false;
    status.print.abort = true;
    // forces re-init of marlin and onboot script to run
    sport.close();
};

function job_pause(reason) {
    if (paused || !check_device_ready()) {
        return;
    }
    if (reason) {
        evtlog(`execution paused for ${reason}`);
    } else {
        evtlog("execution paused");
    }
    status.print.pause = paused = reason || true;
    on_pause_handler = pause_handler;
};

function pause_handler() {
    evtlog("executing pause handler");
    onpause.forEach(cmd => {
        queue(cmd, {onpause: true, priority: true});
    });
    process_queue();
}

function job_resume() {
    if (!paused || !check_device_ready()) {
        return;
    }
    evtlog("execution resumed");
    status.print.pause = paused = false;
    onresume.forEach(cmd => {
        queue(cmd, {priority: true});
    });
    process_queue();
};

let on_pause_handler = null;

function process_queue() {
    if (processing) {
        return;
    }
    processing = true;
    while (waiting < bufmax && buf.length && !paused && !cancel) {
        if (paused) {
            // peek to see if next queue entry runs while paused
            let {line, flags} = buf[0];
            // exit while if next entry is not pause-runnable
            if (!flags || !flags.onpause) {
                break;
            }
        }
        let {line, flags} = buf.shift();
        status.buffer.queue = buf.length;
        status.print.mark = Date.now();
        write(line,flags);
    }
    if (cancel || buf.length === 0) {
        maxout = 0;
        if (status.print.run) {
            status.print.end = Date.now();
            status.print.run = false;
            status.print.pause = false;
            status.state = STATES.IDLE;
            if (status.print.cancel) {
                evtlog(`job cancelled ${status.print.filename} after ${((status.print.end - status.print.start) / 60000)} min`);
            } else if (status.print.abort) {
                evtlog(`job aborted ${status.print.filename} after ${((status.print.end - status.print.start) / 60000)} min`);
            } else {
                status.print.progress = "100.00";
                evtlog(`job done ${status.print.filename} in ${((status.print.end - status.print.start) / 60000)} min`);
            }
            let fn = status.print.filename;
            let lp = fn.lastIndexOf(".");
            fn = `${fn.substring(0,lp)}.print`;
            fs.writeFileSync(fn, JSON.stringify(status.print));
        }
    } else {
        if (status.print.run) {
            status.print.progress = ((1.0 - (buf.length / maxout)) * 100.0).toFixed(2);
        }
    }
    processing = false;
};

function queue(line, flags) {
    // special goto 0,0 after G28 because safe probe offset
    let returnHome = false;
    if (line.indexOf('G28') >= 0) {
        let tmp = line.split(';')[0].trim();
        if (tmp === 'G28') {
            returnHome = true;
        }
    }
    let priority = flags && flags.priority;
    line = line.trim();
    if (line.length === 0) {
        return;
    }
    if ((!paused && waiting < bufmax) || (paused && priority)) {
        write(line, flags);
    } else {
        if (priority) {
            // find highest priority queue # and insert after
            let ind = 0;
            while (ind < buf.length) {
                let el = buf[ind];
                if (el.flags && el.flags.priority) {
                    ind++;
                    continue;
                }
                break;
            }
            buf.splice(ind, 0, {line, flags})
        } else {
            buf.push({line, flags});
        }
        status.buffer.queue = buf.length;
        maxout = Math.max(maxout, buf.length);
    }
    if (returnHome) {
        queue('G0 X0.5 Y0.5 F9000', flags);
        queue('G0 Z0 F200', flags);
    }
};

function queue_priority(line, channel) {
    queue(line, {priority: true, channel});
}

function tokenize_line(line) {
    let toks = [];
    let cur = '';
    for (let i=0; i<line.length; i++) {
        let char = line[i];
        let upper = (char >= 'A' && char <= 'Z');
        let lower = (char >= 'a' && char <= 'z');
        let space = char === ' ';
        if (upper || lower || space) {
            if (upper) {
                if (cur.length > 0) {
                    toks.push(cur);
                }
                cur = char;
            } else if (lower) {
                cur += char;
            } else if (space) {
                if (cur.length > 0) {
                    toks.push(cur);
                }
                cur = '';
            }
        } else if ((char >= '0' && char <= '9') || char === '.' || char === '-') {
            cur += char;
        }
        if (i === line.length - 1 && cur.length > 0) {
            toks.push(cur);
        }
    }
    return toks;
}

function write(line, flags) {
    // if (paused) {
    //     console.trace({write_paused: line, flags});
    // }
    if (!line) {
        console.trace("missing line", line, flags);
        return;
    }
    let sci = line.indexOf(";");
    if (sci > 0) {
        line = line.substring(0, sci).trim();
    }
    flags = flags || {};
    // handle push/pop
    if (line.charAt(0) === '*') {
        switch (line) {
            case "*pos-push":
                status.pos.stack.push({
                    X: status.pos.X,
                    Y: status.pos.Y,
                    Z: status.pos.Z,
                    F: status.pos.F
                });
                return;
            case "*pos-pop":
                let last = status.pos.stack.shift();
                if (last) {
                    line = `G0 X${last.X} Y${last.Y} Z${last.Z} F${last.F || 3000}`;
                } else {
                    evtlog(`no saved position on stack to pop`);
                }
                break;
        }
        if (line === '*pause' || line.indexOf('*pause ') === 0) {
            line = line.split(' ');
            return job_pause(line[1]);
        }
    }
    switch (line.charAt(0)) {
        case ';':
            // layer change. capture picture
            if (line.indexOf(" layer ") > 0 && line.indexOf("@") > 0) {
                let seq = (status.print.outseq++).toString().padStart(4,'0');
                fs.link(
                    "/var/www/html/camera.jpg",
                    status.print.outdir + `/image-${seq}.jpg`,
                    err => {});
            }
            return;
        case '$': // grbl settings
        case '?': // grbl position
        case '~': // grbl resume
        case 'M':
            // consume & report M117 Start
            if (line.indexOf('M117 Start') === 0) {
                flags.callback = () => {
                    bed_dirty();
                    status.print.prep = status.print.start;
                    status.print.start = Date.now();
                    evtlog(`job body ${status.print.filename}`);
                };
            }
        case 'G':
            let toks = tokenize_line(line);
            // look for G0 / G1 moves
            if (toks[0] === 'G0' || toks[0] === 'G1') {
                // elide 'E' extrude moves when extrusion disabled
                if (extrude === false) {
                    toks = toks.filter(t => t.charAt(0) !== 'E');
                }
                // adjust feed scaling
                if (!status.pos.feed) {
                    status.pos.feed = status.feed;
                }
                let newfeed = status.feed !== status.pos.feed;
                let realf = null;
                if (newfeed || status.feed !== 1) {
                    let scaled = false;
                    toks = toks.map(tok => {
                        if (tok.charAt(0) === 'F') {
                            scaled = true;
                            realf = parseFloat(tok.substring(1));
                            let nfeed = Math.round(realf * status.feed);
                            return `F${nfeed}`;
                        } else {
                            return tok;
                        }
                    });
                    if (scaled) {
                        // line had F and was re-scaled
                        line = toks.join(' ');
                        status.pos.feed = status.feed;
                    } else if (status.pos.F && newfeed) {
                        // line had no F, so we synthesize one
                        toks.push(`F${Math.round(status.pos.F * status.feed)}`);
                        line = toks.join(' ');
                        realf = status.pos.F;
                        status.pos.feed = status.feed;
                    }
                }
                // extract position from gcode
                toks.slice(1).forEach(t => {
                    let axis = t.charAt(0);
                    let val = parseFloat(t.substring(1));
                    if (status.pos.rel || axis === 'E') {
                        status.pos[axis] += val;
                    } else {
                        status.pos[axis] = val;
                    }
                    // mark bed dirty on first gcode extrusion of print
                    if (status.print.run && axis === 'E') {
                        status.print.emit += val;
                    }
                });
                // store the real F, not the scaled one
                if (realf) {
                    status.pos.F = realf;
                }
            } else if (toks[0] === 'G90') {
                status.pos.rel = false;
            } else if (toks[0] === 'G91') {
                status.pos.rel = true;
            } else if (toks[0] === 'M0' || toks[0] === 'M1' || toks[0] === 'M2000') {
                return job_pause(toks[1]);
            }
            match.push({line, flags});
            waiting++;
            status.buffer.waiting = waiting;
            break;
    }
    if (sport) {
        if (checksum) {
            flags.lineno = lineno;
            status.device.lineno = lineno;
            line = `N${lineno++} ${line}`;
            let cksum = 0;
            Buffer.from(line).forEach(ch => {
                cksum = cksum ^ ch;
            });
            line = `${line}*${cksum}`;
        }
        if (debug) console.log("...> " + line);
        cmdlog("--> " + line, flags);
        sport.write(`${line}\n`);
    } else {
        evtlog("serial port missing: " + line, flags);
    }
}

let known = {}; // known files
let printCache = {}; // cache of print

/** scan file drop dir for reporting to client(s) */
function check_file_dir(once) {
    if (!filedir) return;
    try {
        let prints = {};
        let recs = {};
        let valid = [];
        fs.readdirSync(filedir).forEach(name => {
            let lp = name.lastIndexOf(".");
            if (lp <= 0) {
                return;
            }
            let ext = name.substring(lp+1);
            let short = name.substring(0,lp);
            let stat = fs.statSync(path.join(filedir, name));
            let isnew = !known[name] || known[name] !== stat.mtimeMs;
            if (isnew) {
                known[name] = stat.mtimeMs;
            }
            if (ext === "gcode" || ext === "nc" || ext === "hex") {
                valid.push(recs[short] = {name, ext, size: stat.size, time: stat.mtimeMs});
            } else if (ext === "print") {
                if (isnew) {
                    try {
                        printCache[short] = JSON.parse(fs.readFileSync(path.join(filedir, name)));
                    } catch (e) { }
                }
                prints[short] = printCache[short];
            }
        });
        Object.keys(prints).forEach(key => {
            if (recs[key]) {
                recs[key].last = prints[key];
            }
        });
        dircache = valid.sort((a, b) => {
            return a.ext === b.ext ?
                b.time - a.time :
                a.ext > b.ext ? 1 : -1;
        });
        if (once) {
            process_input("*list");
        } else {
            setTimeout(check_file_dir, 2000);
        }
    } catch (e) {
        console.log(e);
    }
};

function kick_named(filename) {
    send_file(filename);
}

function runbox(filename, feed) {
    try {
        let min = { x: Infinity, y: Infinity };
        let max = { x: -Infinity, y: -Infinity };
        let pos = { x: 0, y: 0 };
        let abs = true;
        fs.readFileSync(filename)
            .toString()
            .split("\n")
            .forEach(line => {
                let toks = tokenize_line(line);
                if (toks[0] === 'G0' || toks[0] === 'G1') {
                    let x = pos.x;
                    let y = pos.y;
                    toks.forEach(tok => {
                        if (tok.charAt(0) === 'X') {
                            x = parseFloat(tok.substring(1));
                        } else if (tok.charAt(0) === 'Y') {
                            y = parseFloat(tok.substring(1));
                        }
                    });
                    if (abs) {
                        pos.x = x;
                        pos.y = y;
                    } else {
                        pos.x += x;
                        pos.y += y;
                    }
                    min.x = Math.min(min.x, pos.x);
                    max.x = Math.max(max.x, pos.x);
                    min.y = Math.min(min.y, pos.y);
                    max.y = Math.max(max.y, pos.y);
                } else if (toks[0] === 'G90') {
                    abs = true;
                } else if (toks[0] === 'G91') {
                    abs = false;
                }
            });
            let start_x = status.pos.X;
            let start_y = status.pos.Y;
            queue(`G1 X${min.x} Y${min.y} F${feed||3000}`);
            queue(`G1 X${min.x} Y${max.y}`);
            queue(`G1 X${max.x} Y${max.y}`);
            queue(`G1 X${max.x} Y${min.y}`);
            queue(`G1 X${min.x} Y${min.y}`);
            queue(`G1 X${start_x} Y${start_y}`);
    } catch (e) {
        evtlog(`runbox error: ${e}`);
        console.log(e);
    }
}

function kick_next() {
    for (let i=0; i<dircache.length; i++) {
        if (dircache[i].ext === 'gcode') {
            return send_file(filedir + "/" + dircache[0].name);
        }
    }
    evtlog("no valid files", {error: true});
}

function headers(req, res, next) {
    res.setHeader("Access-Control-Allow-Origin", req.headers['origin'] || '*');
    res.setHeader("Access-Control-Allow-Credentials", true);
    res.setHeader("Access-Control-Allow-Headers", "X-Moto-Ajax");
    next();
}

function drop_handler(req, res, next) {
    const dropkey = "/api/drop?name=";
    if (req.url.indexOf(dropkey) === 0 && req.method === 'POST') {
        let name = decodeURIComponent(req.url.substring(dropkey.length));
        let body = '';
        req.on('data', data => {
            body += data.toString();
        })
        req.on('end', () => {
            res.end("file received");
            fs.writeFile(path.join(filedir, name), body, () => {
                check_file_dir(true);
            });
        })
    } else {
        next();
    }
}

// probe network interfaces
function find_net_address() {
    status.device.addr = [];
    let ifmap = os.networkInterfaces();
    let ifkeys = Object.keys(ifmap).forEach(key => {
        let ifc = ifmap[key];
        if (!Array.isArray(ifc)) {
            ifc = [ifc];
        }
        ifc.forEach(int => {
            if (int.internal === false && int.family === 'IPv4') {
                status.device.addr.push(int.address);
            }
        });
    });
    if (status.device.addr.length === 0) {
        setTimeout(find_net_address, 5000);
    }
}

function check_camera() {
    status.device.camera = lastmod('/var/www/html/camera.jpg') ? true : false;
}

// look for existing uuid or generate a new one
function get_set_uuid() {
    try {
        let olduuid = fs.readFileSync("etc/uuid");
        status.device.uuid = uuid = olduuid.toString();
    } catch (e) {
        mkdir("etc");
        fs.writeFileSync("etc/uuid", uuid);
    }
}

function grid_spool() {
    if (opt.nogrid) {
        return;
    }
    let timer = Date.now();
    let killer = null;
    const stat = encodeURIComponent(JSON.stringify(status));
    const uuid = encodeURIComponent(status.device.uuid);
    const opts = [
        `uuid=${uuid}`,
        `stat=${stat}`,
        `last=${gridlast}`,
        `time=${timer.toString(36)}`,
        `type=gb-${vernum}`
    ].join('&');
    const retry = function(time) {
        if (killer) {
            clearTimeout(killer);
        }
        setTimeout(grid_spool, time);
    };
    // console.log({up: grid, opts});
    const proto = grid.indexOf("https:") >= 0 ? https : http;
    const req = proto.get(`${grid}/api/grid_up?${opts}`, (res) => {
        const { headers, statusCode, statusMessage } = res;
        gridlast = '*';
        // console.log([headers, statusCode, statusMessage]);
        let body = '';
        res.on('data', data => {
            body += data.toString();
        });
        res.on('end', () => {
            timer = Date.now() - timer;
            if (body === 'superceded') {
                // we have overlapping outbound calls (bad on us)
                console.log({grid_up: body});
                return;
            }
            if (body === 'reconnect') {
                // console.log({reconnect: timer});
                retry(100);
            } else {
                let [file, gcode] = body.split("\0");
                if (file && gcode) {
                    console.log({file, gcode: gcode.length});
                    gridlast = file;
                    fs.writeFile(path.join(filedir, file), gcode, () => {
                        check_file_dir(true);
                        if (mode !== 'cnc') {
                            kick_named(path.join(filedir, file));
                        }
                    });
                } else {
                    if (body.length > 80) {
                        body = body.split('\n').slice(0,10);
                    }
                    console.log({grid_up_reply: body, timer});
                }
                retry(1000);
            }
        });
        res.on('error', error => {
            console.log({http_get_error: error});
            retry(2000);
        });
    }).on('error', error => {
        console.log({grid_up_error: error});
        retry(2000);
    });
    killer = setTimeout(() => {
        console.log("killing zombied connection @ 10 min idle");
        req.destroy();
    }, 600000);
}

// -- start it up --

if (opt.help) {
    console.log([
        "usage: serial [options]",
        "   --device=<dev>   : path to serial port device (detected if absent)",
        "   --baud=<rate>    : baud rate for serial device (default: 250000)",
        "   --grid=<urlpre>  : url prefix for grid spool service",
        "   --nogrid         : disable grid spool service",
        "   --listen=<port>  : port for command interface",
        "   --webport=<port> : port to listen for web connections (or 'off')",
        "   --webdir=<dir>   : directory to serve on <webport>",
        "   --filedir=<dir>  : directory to watch for gcode",
        "   --stdin          : enable stdin as command interface"
    ].join("\n"));
    process.exit(0);
}

if (opt.probe) {
    SerialPort.list().then(ports => {
        ports.forEach(port => {
            console.log({
                com: port.path || port.comName,
                pnp: port.pnpId        || null,
                man: port.manufacturer || null,
                ven: port.vendorId     || null,
                prd: port.productId    || null,
                ser: port.serialNumber || null
            });
        });
        process.exit(0);
    });
    return;
}

function add_proc_ctrl() {
    // add stdout to clients
    clients.push({console: true, monitoring: true, write: (line) => {
        process.stdout.write(`[${moment().format("HH:mm:ss")}] ${line}`);
    }});

    process.stdout.monitoring = true;

    if (opt.stdin) {
        new LineBuffer(process.stdin);
        process.stdin.on("line", line => { process_input(line, clients[0]) });
        status.clients.stdin = 1;
    }
}

function start_ctrl_port(ctrlport) {
    if (!ctrlport) return;
    net.createServer(socket => {
        let dev = status.device;
        status.clients.net++;
        socket.linebuf = new LineBuffer(socket);
        socket.write(`*ready ${dev.name} ${dev.version} ${dev.firm.auth} ${dev.addr.join(',')}\n`);
        socket.on("line", line => { process_input(line, socket) });
        socket.on("close", () => {
            clients.splice(clients.indexOf(socket),1);
            status.clients.net--;
            let buffer = socket.linebuf.buffer;
            // store upload, if available
            if (upload && buffer && buffer.length) {
                let size = buffer.length;
                fs.writeFile(path.join(filedir, upload), buffer, (err) => {
                    evtlog({upload: upload, size, err});
                    check_file_dir(true);
                });
            }
        });
        clients.push(socket);
    }).listen(parseInt(ctrlport) || 4000);
}

// start web server
function start_web_port(webport) {
    if (!(webport > 0)) return;
    const handler = connect()
        .use(headers)
        .use(drop_handler)
        .use(serve(process.cwd() + "/" + webdir + "/"))
        .use(serve(filedir));
    const server = http.createServer(handler).listen(webport);
    const wss = new WebSocket.Server({ server });
    wss.on('connection', (ws) => {
        status.clients.ws++;
        ws
            .on('close', () => {
                clients.splice(clients.indexOf(ws),1);
                status.clients.ws--;
            })
            .on('error', (error) => {
                console.log({wss_error: error});
            })
            .on('message', (message) => {
                process_input(message, ws);
            });

        let dev = status.device;
        ws.send(`*ready ${dev.name} ${dev.version} ${dev.firm.auth} ${dev.addr.join(',')}\n`);
        ws.write = (data) => {
            try {
                ws.send(data);
            } catch (e) {
                // client will be removed above on 'close' event
            }
        };
        clients.push(ws);
    });
}

function startup() {
    load_config();
    console.log({
        mode,
        uuid,
        files: filedir,
        grid,
        device: port || 'missing',
        baud,
        maxbuf: bufmax,
        webport: webport || 'off',
        ctrlport: ctrlport || 'off',
        webdir,
        version
    });
    add_proc_ctrl();
    start_ctrl_port(ctrlport);
    start_web_port(webport);
    mkdir(filedir);
    get_set_uuid();
    is_bed_clear();
    on_serial_port();
    check_file_dir();
    find_net_address();
    check_camera();
    if (opt.register !== false) {
        grid_spool();
    }
}

if (!port) {
    probe_serial((nport, nbaud, nmode) => {
        if (nport) {
            port = nport;
        }
        if (nbaud) {
            baud = nbaud;
        }
        if (nmode) {
            mode = nmode;
        }
        startup();
    });
} else {
    startup();
}
