/** Copyright Stewart Allen <sa@grid.space> -- All Rights Reserved */

"use strict";

const IGNORE = 1;

const MCODE = {
    M92:  "steps per",
    M145: IGNORE, // material properties
    M149: IGNORE, // temps: C, F
    M200: IGNORE, // filament size: S0 D1.75
    M201: "accel max",
    M203: "feedrate max",
    M204: "accel",
    M205: "advanced",
    M206: "home offset",
    M301: "hot end pid",
    M304: "bed pid",
    M412: "filament runout",
    M413: "power loss",
    M414: IGNORE, // language font
    M420: "bed leveling",
    M603: "filament",
    M851: "z probe offset",
    M808: "repeat count",
    M900: "linear advance",
    M906: "stepper current",
    M913: "hybrid @",
    M914: "stallguard @"
};

const MLINE = {
    M205: 4
};

const MKEYS = {
    M205: [ "X", "Y", "Z", "E", "B", "S", "T" ]
}

let istouch = true;//'ontouchstart' in document.documentElement || window.innerWidth === 800;
let interval = null;
let timeout = null;
let queue = [];
let logs = [];
let files = {};
let file_selected = null;
let ready = false;
let sock = null;
let last_jog = null;
let last_jog_speed = null;
let last_set = {};      // last settings object
let last_hash = '';     // last settings hash
let jog_val = 0.0;
let jog_speed = 1000;
let input = null;       // active input for keypad
let settings = localStorage;
let selected = null;
let mode = null;        // for checking against current status
let grbl = false;
let run_verb = 'print';
let job_verb = 'print';

function $(id) {
    return document.getElementById(id);
}

function log(msg) {
    console.log({msg});
}

function zpad(v) {
    return v < 10 ? `0${v}` : v;
}

function elapsed(millis) {
    let time = moment.duration(millis);
    return `${zpad(time.hours())}:${zpad(time.minutes())}:${zpad(time.seconds())}`;
}

function alert_on_run() {
    if (last_set.print.run && !last_set.print.pause) {
        alert(`${job_verb} in progress`);
        return true;
    }
    return false;
}

function reload() {
    document.location = document.location;
}

function update_code() {
    if (confirm("update code?")) {
        send("*exec bin/update-code.sh");
    }
}

function reboot() {
    if (confirm("reboot system?")) {
        send("*exec sudo reboot");
    }
}

function shutdown() {
    if (confirm("shutdown system?")) {
        send("*exec sudo halt -p");
    }
}

function runbox() {
    if (selected && ["n","g"].indexOf(selected.ext) >= 0) {
        if (confirm(`run boundary for "${selected.file}" @ ${jog_speed} mm/m`)) {
            send(`*runbox ${selected.file} @ ${jog_speed}`);
        }
    } else {
        alert('no gcode file selected');
    }
}

function print_selected() {
    if (selected) {
        print(selected.file, selected.ext);
    } else {
        alert('no gcode file selected');
    }
}

function download_selected() {
    if (selected) {
        download(selected.file, selected.ext);
    } else {
        alert('no gcode file selected');
    }
}

function delete_selected(yes) {
    if (selected) {
        remove(selected.file, yes);
    } else {
        alert('no gcode file selected');
    }
}

function select(file, ext, ev) {
    file = files[file];
    if (file) {
        $('file-name').innerText = file.name;
        $('file-date').innerText = moment(new Date(file.time)).format('YY/MM/DD HH:mm:ss');
        // add thousand's place commas
        $('file-size').innerText = file.size
            .toString()
            .split('')
            .reverse()
            .map((v,i,a) => {
                return i < a.length - 1 && i % 3 === 2 ? ',' + v : v;
            })
            .reverse()
            .join('')
            ;
        if (file.last) {
            $('file-print').innerText = elapsed(file.last.end - file.last.start);
            $('file-last').style.display = '';
        } else {
            $('file-last').style.display = 'none';
        }
        $('file-go').innerText = (ext === 'g' ? run_verb : 'install');
        if (file_selected) {
            file_selected.classList.remove("file-selected");
        }
        file_selected = $(file.uuid);
        file_selected.classList.add("file-selected");
        selected = {file: file.name, ext};
        if (ev) {
            if (ev.metaKey || ev.ctrlKey) {
                if (!ev.shiftKey) {
                    download_selected()
                } else {
                    delete_selected(true);
                }
            }
        }
    } else {
        selected = null;
    }
}

function print(file, ext, yes) {
    if (!last_set) {
        alert('not connected');
        return;
    }
    if (alert_on_run()) return;
    if (ext === "h") {
        return firmware_update(file);
    }
    if (yes || confirm(`start ${job_verb} "${file}"?`)) {
        send('*clear');
        send(`*kick ${file}`);
        menu_select('home');
    }
}

function download(file, ext) {
    location = `${location.origin}/${file}`;
}

function remove(file, yes) {
    if (yes || confirm(`delete "${file}"?`)) {
        send(`*delete ${file}`);
        setTimeout(() => {
            send('*list');
        }, 250);
    }
}

function clear_files(yes) {
    if (yes || confirm('delete all files?')) {
        for (let file in files) {
            send(`*delete ${file}`);
        }
        setTimeout(() => {
            send('*list');
        }, 500);
    }
}

function center_go() {
    let stat = last_set;
    send_safe(`G0 X${stat.device.max.X/2} Y${stat.device.max.Y/2} F${jog_speed}`);
}

function home_go() {
    if (mode === 'fdm') {
        send_safe('G28;M18');
    }
    if (mode === 'cnc') {
        origin_go();
    }
}

function origin_go() {
    send_safe(`G0 X0 Y0 F${jog_speed}`);
    if (mode === 'fdm') {
        send_safe('G0 Z0');
    }
}

function origin_set() {
    if (alert_on_run()) return;
    if (mode === 'fdm' && last_set && last_set.pos) {
        let pos = last_set.pos;
        send(`M206 X-${pos.X} Y-${pos.Y}`);
        send('M500');
    }
    if (mode === 'cnc') {
        send('G92 X0 Y0 Z0');
        if (grbl) {
            send('G10 L20 P1 X0 Y0 Z0; ?');
        }
    }
}

function origin_set_axis(axis) {
    if (alert_on_run()) return;
    axis = axis.toUpperCase();
    send(`G92 ${axis}0`);
    if (grbl) {
        send(`G10 L20 P1 ${axis}0; ?`);
    } else {
        send('*status');
    }
}


function origin_clear() {
    if (alert_on_run()) return;
    if (!grbl) {
        send('M206 X0 Y0 Z0');
        send('M500');
    }
}

function update_probe_z() {
    if (alert_on_run()) return;
    let status = last_set;
    let settings = status.settings;
    let pos = status.pos;
    if (!settings.M851) return alert('missing M851');
    if (!pos) return alertn('missing position');
    let newz = settings.M851.Z + pos.Z;
    if (isNaN(newz)) return alert(`invalid new z ${newz}`);
    if (newz > 5 || newz < -5) return alert(`invalid new z value ${newz}`);
    if (confirm(`set new z probe offset to ${newz}`)) {
        send(`M851 Z${newz}; M503; *status`);
    }
}

function probe_bed() {
    if (alert_on_run()) return;
    if (confirm('run bed level probe?')) {
        send('G29 P1');
        send('G29 T');
        menu_select('comm');
    }
}

function calibrate_pid() {
    if (alert_on_run()) return;
    if (confirm('run hot end PID calibration?')) {
        send('M303 S220 C8 U1');
        menu_select('comm');
    }
}

function update_position() {
    send('M114');
}

function eeprom_save() {
    if (alert_on_run()) return;
    if (confirm('save eeprom settings')) {
        send('M500');
    }
}

function eeprom_restore() {
    if (alert_on_run()) return;
    if (confirm('restore eeprom settings')) {
        send('M501');
        send('M503');
        settings_done = false;
    }
}

function bed_toggle() {
    let toggle = $('bed_toggle');
    if (toggle.innerText === 'on') {
        toggle.innerText = 'off';
        send('M140 S' + bed_temp());
        send('M105');
    } else {
        toggle.innerText = 'on';
        send('M140 S0');
        send('M105');
    }
}

function bed_temp() {
    return parseInt($('bed_temp').value || '0');
}

function nozzle_toggle() {
    let toggle = $('nozzle_toggle');
    if (toggle.innerText === 'on') {
        toggle.innerText = 'off';
        send('M104 S' + nozzle_temp());
        send('M105');
    } else {
        toggle.innerText = 'on';
        send('M104 S0');
        send('M105');
    }
}

function preheat() {
    if (alert_on_run()) return;
    send(`M104 S${settings.default_nozzle || 220}`);
    send(`M140 S${settings.default_bed || 65}`);
    send('M105');
}

function nozzle_temp() {
    return parseInt($('nozzle_temp').value || '0');
}

function filament_load() {
    if (alert_on_run()) return;
    send('G0 E700 F300');
}

function filament_unload() {
    if (alert_on_run()) return;
    send('G0 E-700 F300');
}

function print_next() {
    if (alert_on_run()) return;
    if (confirm(`start next job?`)) {
        send('*clear');
        send('*kick');
    }
}

function firmware_update(file) {
    if (alert_on_run()) return;
    if (file) {
        if (confirm(`update firmware using "${file}"?`)) {
            send(`*update ${file}`);
        }
    } else {
        if (confirm("update firmware?")) {
            send('*update');
        }
    }
}

function controller_restart() {
    if (alert_on_run()) return;
    if (confirm("restart controller?")) {
        send('*exit');
    }
}

function pause() {
    if (!last_set) return;
    if (!last_set.print) return;
    if (!last_set.print.run) return;
    if (last_set.print.pause) return;
    // if (confirm(`pause ${job_verb}?`)) {
        send('*pause');
    // }
}

function resume() {
    if (!last_set) return;
    if (!last_set.print) return;
    if (!last_set.print.run) return;
    if (!last_set.print.pause) return;
    if (confirm(`resume ${job_verb}?`)) {
        send('*resume');
    }
}

function cancel() {
    if (confirm(`cancel ${job_verb}?`)) {
        send('*cancel');
    }
}

function estop() {
    send('*abort');
}

function extrude(v) {
    if (alert_on_run()) return;
    if (mode === 'fdm') {
        gr(`E${jog_val} F250`);
    }
    if (mode === 'cnc') {
        jog('Z', 1);
    }
}

function retract(v) {
    if (alert_on_run()) return;
    if (mode === 'fdm') {
        gr(`E-${jog_val} F250`);
    }
    if (mode === 'cnc') {
        jog('Z', -1);
    }
}

function set_jog(val, el) {
    jog_val = val;
    if (last_jog) {
        last_jog.classList.remove('bg_yellow');
    }
    if (el) {
        el.classList.add('bg_yellow');
        last_jog = el;
        settings.jog_sel = el.id;
    }
    settings.jog_val = val;
}

function set_jog_speed(val, el) {
    jog_speed = val;
    if (last_jog_speed) {
        last_jog_speed.classList.remove('bg_yellow');
    }
    el.classList.add('bg_yellow');
    last_jog_speed = el;
    settings.jog_speed_sel = el.id;
    settings.jog_speed = val;
}

function jog(axis, dir) {
    if (alert_on_run()) return;
    gr(`${axis}${dir * jog_val} F${jog_speed}`);
}

function gr(msg) {
    send(`G91; G0 ${msg}; G90`);
}

function feed_dn() {
    send(`*feed ${last_set.feed - 0.05}; *status`);
}

function feed_up() {
    send(`*feed ${last_set.feed + 0.05}; *status`);
}

function feed_reset() {
    send(`*feed 1.0; *status`);
}

function send_confirm(message, what) {
    what = what || `send ${message}`;
    if (confirm(`${what}?`)) {
        send(message);
    }
}

function send_safe(message) {
    if (alert_on_run()) return;
    send(message);
}

function send(message) {
    if (ready) {
        // log({send: message});
        message.split(";").map(v => v.trim()).forEach(m => sock.send(m));
    } else {
        // log({queue: message});
        queue.push(message);
    }
}

function cleanName(rname) {
    if (!rname) {
        return rname;
    }
    let name = rname.substring(rname.lastIndexOf("/")+1);
    let doti = name.lastIndexOf('.');
    if (doti > 0) {
        name = name.substring(0,doti);
    }
    return name;
}

function init_filedrop() {
    var pages = $("pages");
    var list = $("file-list-wrap");

    pages.addEventListener("dragover", function(evt) {
        menu_select("file");
        evt.stopPropagation();
        evt.preventDefault();
        evt.dataTransfer.dropEffect = 'copy';
        list.classList.add("bg_red");
    });

    pages.addEventListener("dragleave", function(evt) {
        list.classList.remove("bg_red");
    });

    pages.addEventListener("drop", function(evt) {
        evt.stopPropagation();
        evt.preventDefault();

        list.classList.remove("bg_red");

        var files = evt.dataTransfer.files;

        for (var i=0; i<files.length; i++) {
            var file = files[i];
            var read = new FileReader();
            read.onloadend = function(e) {
                fetch("/api/drop?name=" + encodeURIComponent(file.name), {
                    method: "post",
                    body: e.target.result
                }).then(reply => {
                    return reply.text();
                }).then(text => {
                    console.log({text});
                    setTimeout(() => {
                        send('*list');
                    }, 250);
                });
            };
            read.readAsBinaryString(file);
        }
    });
}

function vids_update() {
    let time = Date.now();
    let img = new Image();
    // let url = `http://10.10.10.111/camera.jpg?time=${time}`;
    let url = `http://${location.hostname}/camera.jpg?time=${time}`;
    let now = Date.now();
    let frame = $('page-vids');
    img.onload = () => {
        vids_timer = setTimeout(vids_update, 1000);
        frame.innerHTML = '';
        frame.appendChild(img);
        let rect = frame.getBoundingClientRect();
        let { width, height } = img;
        let arr = rect.width / rect.height;
        let ari = width / height;
        let rat = arr / ari;
        if (width > height) {
            img.style.height = "100%";
            img.style.width = `${100 * rat}%`;
        } else {
            img.style.width = "100%";
            img.style.height = `${100 * rat}%`;
        }
    };
    img.src = url;
}

let menu;
let menu_named;
let menu_selected;
let page_selected;
let vids_timer;

function menu_select(key) {
    let menu = $(`menu-${key}`);
    if (menu_selected) {
        menu_selected.classList.remove("menu_sel");
    }
    menu.classList.add("menu_sel")
    menu_selected = menu;
    menu_named = key;

    let page = $(`page-${key}`);
    if (page_selected) {
        page_selected.style.display = 'none';
    }
    page.style.display = 'flex';
    page_selected = page;
    settings.page = key;

    clearTimeout(vids_timer)

    if (key === 'vids') {
        vids_update();
    }
    if (key === 'comm') {
        $('command').focus();
    }
}

function set_progress(val) {
    $('progress').value = val + '%';
    let rect = $('progress').getBoundingClientRect();
    let pbar = $('progress-bar');
    let pval = val ? rect.width * (val / 100) : 0;
    pbar.style.width = `${pval}px`;
}

function status_update(status) {
    if (status.state) {
        let state = status.state;
        let pause = status.print.pause;
        if (pause) {
            if (typeof(pause) === 'string') {
                state = `${state} (paused ${pause})`;
            } else {
                state = `${state} (paused)`;
            }
        } else if (status.print.cancel) {
            state = `${state} (cancelled)`;
        } else if (status.print.abort) {
            state = `${state} (aborted)`;
        }
        $('state').value = state;
    }
    if (status.print) {
        $('filename').value = cleanName(status.print.filename);
        set_progress(status.print.run ? status.print.progress : 0);
        if (status.print.clear) {
            $('clear-bed').classList.remove('bg_red');
        } else {
            $('clear-bed').classList.add('bg_red');
        }
        if (status.print.run) {
            $('state').classList.add('bg_green');
        } else {
            $('state').classList.remove('bg_green');
        }
        let duration = 0;
        if (status.print.end && status.print.end > status.print.start) {
            duration = status.print.end - status.print.start;
        } else if (status.print.prep || status.print.start) {
            duration = (status.print.mark || Date.now()) - status.print.start;
        }
        $('elapsed').value = elapsed(duration);
    }
    if (status.target) {
        if (status.target.bed > 0) {
            if ($('bed_temp') !== input) {
                $('bed_temp').value = status.target.bed;
            }
            $('bed_temp').classList.add('bg_red');
            $('bed_toggle').innerText = 'off';
        } else {
            if ($('bed_temp') !== input) {
                $('bed_temp').value = 0;
            }
            $('bed_temp').classList.remove('bg_red');
            $('bed_toggle').innerText = 'on';
        }
        $('bed_at').value = Math.round(status.temp.bed);
        if (status.target.ext[0] > 0) {
            if ($('nozzle_temp') !== input) {
                $('nozzle_temp').value = status.target.ext[0];
            }
            $('nozzle_temp').classList.add('bg_red');
            $('nozzle_toggle').innerText = 'off';
        } else {
            if ($('nozzle_temp') !== input) {
                $('nozzle_temp').value = 0;
            }
            $('nozzle_temp').classList.remove('bg_red');
            $('nozzle_toggle').innerText = 'on';
        }
        $('nozzle_at').value = Math.round(status.temp.ext);
    }
    if (status.pos) {
        $('xpos').value = parseFloat(status.pos.X).toFixed(2);
        $('ypos').value = parseFloat(status.pos.Y).toFixed(2);
        $('zpos').value = parseFloat(status.pos.Z).toFixed(2);
    }
    // highlight X,Y,Z pod label when @ origin
    if (status.settings && status.settings.offset && status.pos) {
        let off = status.settings.offset;
        let pos = status.pos;
        $('xpos').classList.remove('bg_green');
        $('ypos').classList.remove('bg_green');
        $('zpos').classList.remove('bg_green');
        if (Math.abs(pos.X) + Math.abs(pos.Y) + Math.abs(pos.Z) < 0.1) {
            // highlight origin as green
            $('xpos').classList.add('bg_green');
            $('ypos').classList.add('bg_green');
            $('zpos').classList.add('bg_green');
        }
    }
    if (status.estop && status.estop.min) {
        $('xpos').classList.remove('bg_yellow');
        $('ypos').classList.remove('bg_yellow');
        $('zpos').classList.remove('bg_yellow');
        let min = status.estop.min;
        if (min.x === ' TRIGGERED') $('xpos').classList.add('bg_yellow');
        if (min.y === ' TRIGGERED') $('ypos').classList.add('bg_yellow');
        if (min.z === ' TRIGGERED') $('zpos').classList.add('bg_yellow');
    }
    if (status.settings) {
        let valuehash = '';
        let html = ['<table>'];
        let bind = [];
        for (let key in status.settings) {
            let map = status.settings[key];
            let kval = MCODE[key];
            let line = MLINE[key] || 6;
            if (kval === IGNORE) continue;
            let keys = (MKEYS[key] || Object.keys(map)).slice();
            let remn = keys.length;
            while (remn > 0) {
                let count = line;
                html.push(`<tr class="settings"><th><label>${kval || key}</label></th>`);
                while (count-- > 0 && keys.length) {
                    remn--;
                    let k = keys.shift();
                    let bk = `ep-${key}-${k}`;
                    let bv = [key, k];
                    html.push(`<th>${k}</th>`);
                    html.push(`<td><input id="${bk}" size="7" value="${map[k]}"></input</td>`);
                    valuehash += [k,map[k]].join('');
                    bind.push({bk,bv});
                }
                html.push('</tr>');
            }
        }
        html.push('</table>');
        if (valuehash !== last_hash) {
            $('settings').innerHTML = html.join('');
            bind.forEach(el => {
                let {bk, bv} = el;
                let input = $(bk);
                input.onkeyup = (ev) => {
                    if (ev.keyCode === 13) {
                        send_safe(`${bv[0]} ${bv[1]}${input.value.trim()}`);
                    }
                };
            });
        }
        last_hash = valuehash;
    }
    if (status.device) {
        if (status.device.name) {
            let name = status.device.name.split('.')[0] || 'GridBot';
            document.title = `${name}`;;
        }
        if (status.device.grbl !== grbl) {
            grbl = status.device.grbl;
        }
        if (status.device.mode !== mode) {
            set_mode(mode = status.device.mode);
        }
        if (status.device.camera === true) {
            $('menu-vids').style.display = 'flex';
        } else {
            $('menu-vids').style.display = 'none';
        }
    }
    if (status.feed && input !== $('feedscale')) {
        $('feedscale').value = `${Math.round(status.feed * 100)}%`;
    }
}

function set_mode(mode) {
    if (mode === 'cnc') {
        set_mode_cnc();
    }
    if (mode === 'fdm') {
        set_mode_fdm();
    }
}

function set_mode_cnc() {
    // home
    $('heating').style.display = 'none';
    $('feedrate').style.display = '';
    $('clear-bed').style.display = 'none';
    // move
    $('zeros').style.display = '';
    $('clear-origin').style.display = 'none';
    $('up-z-probe').style.display = 'none';
    // $('go-center').style.display = 'none';
    $('jog-fdm').style.display = 'none';
    $('jog-cnc').style.display = '';
    $('abl').style.display = 'none';
    // mill ops
    $('menu-mill').style.display = '';
    // files
    run_verb = 'run gcode';
    job_verb = 'milling';
    let filego = $('file-go');
    if (filego.innerText !== 'install') {
        filego.innerText = run_verb;
    }
    $('file-box').style.display = '';
    // control
    $('ctrl-run-fdm').style.display = 'none';
}

function set_mode_fdm() {
    // home
    $('heating').style.display = '';
    $('feedrate').style.display = 'none';
    $('clear-bed').style.display = '';
    // move
    $('zeros').style.display = 'none';
    $('clear-origin').style.display = '';
    $('up-z-probe').style.display = '';
    // $('go-center').style.display = '';
    $('jog-fdm').style.display = '';
    $('jog-cnc').style.display = 'none';
    $('abl').style.display = '';
    // mill ops
    $('menu-mill').style.display = 'none';
    // files
    run_verb = 'print';
    job_verb = 'print';
    let filego = $('file-go');
    if (filego.innerText !== 'install') {
        filego.innerText = run_verb;
    }
    $('file-box').style.display = 'none';
    // control
    $('ctrl-run-fdm').style.display = '';
}

function bind_arrow_keys() {
    document.addEventListener("keydown", function(evt) {
        if (menu_named === "move" || menu_named === "vids") {
            let shift = evt.shiftKey;
            switch (evt.key) {
                case 'x':
                    send_safe("G28 X");
                    break;
                case 'y':
                    send_safe("G28 Y");
                    break;
                case "ArrowLeft":
                    jog('X', -1);
                    break;
                case "ArrowRight":
                    jog('X', 1);
                    break;
                case "ArrowUp":
                    jog(shift ? 'Z' : 'Y', 1);
                    break;
                case "ArrowDown":
                    jog(shift ? 'Z' : 'Y', -1);
                    break;
            }
        }
    });
}

function init() {
    // bind left menu items and select default
    menu = {
        home: $('menu-home'),
        move: $('menu-move'),
        file: $('menu-file'),
        mill: $('menu-mill'),
        comm: $('menu-comm'),
        vids: $('menu-vids'),
        ctrl: $('menu-ctrl')
    };
    for (name in menu) {
        let key = name.split('-')[0];
        menu[name].onclick = () => {
            menu_select(key);
        };
    }
    menu_select(settings.page || 'home');

    timeout = null;
    sock = new WebSocket(`ws://${document.location.hostname}:4080`);
    sock.onopen = (evt) => {
        if (ready) {
            return;
        }
        // log({wss_open: true});
        ready = true;
        while (queue.length) {
            send(queue.shift());
        }
        interval = setInterval(() => {
            send('*status');
        }, 1000);
        send('*status;*list');
    };
    sock.onclose = (evt) => {
        log({wss_close: true});
        clearInterval(interval);
        if (timeout != null) {
            return;
        }
        sock = null;
        ready = false;
        timeout = setTimeout(init, 1000);
        $('state').value = 'server disconnected';
    };
    sock.onerror = (evt) => {
        log({wss_error: true});
        if (timeout != null) {
            return;
        }
        sock = null;
        ready = false;
        timeout = setTimeout(init, 1000);
        $('state').value = 'no server connection';
    };
    sock.onmessage = (evt) => {
        let msg = unescape(evt.data);
        let spos = msg.indexOf("*** ");
        let epos = msg.lastIndexOf(" ***");
        if (msg.indexOf("*** {") >= 0) {
            status_update(last_set = JSON.parse(msg.substring(spos+4, epos)));
        } else if (msg.indexOf("*** [") >= 0) {
            let list = $('file-list');
            let html = [];
            let trim = msg.trim().substring(spos+4, epos);
            let time = Date.now();
            files = {};
            JSON.parse(trim).forEach(file => {
                let uuid = (time++).toString(36);
                let ext = file.ext.charAt(0);
                let name = cleanName(file.name);
                let cname = ext === 'g' ? name : [name,file.ext].join('.');
                files[name] = file;
                file.uuid = uuid;
                html.push(`<div id="${uuid}" class="row" onclick="select('${name}','${ext}',event)" ondblclick="print('${name}','${ext}')"><label class="grow">${cname}</label></div>`);
            });
            list.innerHTML = html.join('');
        } else if (msg.indexOf("***") >= 0) {
            try {
                log({wss_msg: msg});
                menu_select('comm');
                $('comm-log').innerHTML += `[${moment().format("HH:mm:ss")}] ${msg.trim()}<br>`;
                $('comm-log').scrollTop = $('comm-log').scrollHeight;
            } catch (e) {
                log({wss_msg: evt, err: e});
            }
        } else {
            $('comm-log').innerHTML += `[${moment().format("HH:mm:ss")}] ${msg.trim()}<br>`;
            $('comm-log').scrollTop = $('comm-log').scrollHeight;
        }
    };
    let setbed = $('bed_temp').onkeyup = ev => {
        if (ev === 42 || ev.keyCode === 13) {
            send('M140 S' + bed_temp());
            send('M105');
            $('bed_toggle').innerText = 'off';
            input_deselect();
        }
    };
    let setnozzle = $('nozzle_temp').onkeyup = ev => {
        if (ev === 42 || ev.keyCode === 13) {
            send('M104 S' + nozzle_temp());
            send('M105');
            $('nozzle_toggle').innerText = 'off';
            input_deselect();
        }
    };
    $('feedscale').onclick = ev => {
        input = $('feedscale');
        input.classList.add('bg_green');
        ev.stopPropagation();
    };
    $('feedscale').onkeyup = ev => {
        if (ev.keyCode === 13) {
            let val = $('feedscale').value.replace('%','').trim();
            val = Math.min(2,Math.max(0.1,parseInt(val) / 100.0));
            input_deselect();
            send(`*feed ${val}; *status`);
        }
    };
    $('send').onclick = $('command').onkeyup = ev => {
        if (ev.type === 'click' || ev.keyCode === 13) {
            let cmd = $('command').value.trim();
            if (cmd.indexOf('url ') === 0) {
                window.location = cmd.substring(4);
            } else {
                send(cmd);
            }
            $('command').value = '';
        }
    };
    $('clear').onclick = () => {
        $('comm-log').innerHTML = '';
        $('command').focus();
    };
    let input_deselect = document.body.onclick = (ev) => {
        if (input) {
            input.classList.remove('bg_green');
            input = null;
        }
        $('keypad').style.display = 'none';
    };
    $('nozzle_temp').onclick = (ev) => {
        input_deselect();
        if (istouch) {
            $('keypad').style.display = '';
            $('nozzle_temp').setSelectionRange(10, 10);
        }
        input = $('nozzle_temp');
        input.classList.add('bg_green');
        if (input.value === '0') {
            input.value = settings.default_nozzle || '220';
        }
        ev.stopPropagation();
    };
    $('nozzle_temp').ondblclick = (ev) => {
        let sel = $('nozzle_temp');
        if (sel.value !== '0' && confirm('set default nozzle temp')) {
            settings.default_nozzle = sel.value;
        }
    }
    $('bed_temp').onclick = (ev) => {
        input_deselect();
        if (istouch) {
            $('keypad').style.display = '';
            $('bed_temp').setSelectionRange(10, 10);
        }
        input = $('bed_temp');
        input.classList.add('bg_green');
        if (input.value === '0') {
            input.value = settings.default_bed || '55';
        }
        ev.stopPropagation();
    };
    $('bed_temp').ondblclick = (ev) => {
        let sel = $('bed_temp');
        if (sel.value !== '0' && confirm('set default bed temp')) {
            settings.default_bed = sel.value;
        }
    }
    for (let i=0; i<10; i++) {
        $(`kp-${i}`).onclick = (ev) => {
            if (input) {
                input.value += i;
                ev.stopPropagation();
            }
        };
    }
    $('kp-bs').onclick = (ev) => {
        if (input) {
            input.value = input.value.substring(0,input.value.length-1);
            ev.stopPropagation();
        }
    };
    $('kp-ok').onclick = (ev) => {
        if (input === $('bed_temp')) {
            setbed(42);
        }
        if (input === $('nozzle_temp')) {
            setnozzle(42);
        }
        ev.stopPropagation();
    };
    // bind milling ops
    let mill_selop = null;
    let mill_sel = (el, op, target) => {
        el.style.display = '';
        op.classList.add('mill-op-select');
        if (mill_selop && mill_selop.el !== el) {
            mill_selop.el.style.display = 'none';
            mill_selop.op.classList.remove('mill-op-select');
        }
        mill_selop = { el, op, target };
    };
    [...document.getElementsByClassName('mill-op')].forEach(op => {
        let target = op.getAttribute('target');
        let el = $(`mill-${target}`);
        el.style.display = 'none';
        if (!mill_selop) {
            mill_sel(el, op, target);
        }
        op.onclick = (ev) => {
            mill_sel(el, op, target);
        };
    });
    let tool_diam = $('tool-diam');
    let tool_metric = $('tool-metric');
    let tool_imperial = $('tool-imperial');
    tool_diam.value = settings.tool_diam || 0.25;
    tool_metric.checked = settings.tool_metric === 'true';
    tool_imperial.checked = !tool_metric.checked;
    tool_metric.onclick = tool_imperial.onclick = () => {
        settings.tool_metric = tool_metric.checked
    };
    tool_diam.onkeyup = (ev) => {
        settings.tool_diam = tool_diam.value;
    };
    // reload page on status click
    $('page-home').onclick = ev => {
        if (ev.target.id === 'state') {
            reload();
        }
    };
    // disable autocomplete
    let inputs = document.getElementsByTagName('input');
    for (let i=0; i<inputs.length; i++) {
        inputs[i].setAttribute('autocomplete', Date.now().toString(36));
    }
    init_filedrop();
    input_deselect();
    bind_arrow_keys();
    // restore settings
    set_jog(parseFloat(settings.jog_val) || 1, $(settings.jog_sel || "j100"));
    set_jog_speed(parseFloat(settings.jog_speed) || 100, $(settings.jog_speed_sel || "js0100"));
}
