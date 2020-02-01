const MCODE = {
    M92:  "steps per",
    M201: "accel max",
    M203: "feedrate max",
    M204: "accel",
    M205: "advanced",
    M206: "home offset",
    M301: "pid tuning",
    M420: "UBL",
    M851: "z probe offset",
    M900: "linear advance",
    M906: "stepper current",
    M913: "hybrid threshold",
    M914: "stallguard threshold"
};

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
    if (last_set.print.run) {
        alert("print in progress");
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

function print_selected() {
    if (selected) {
        print(selected.file, selected.ext);
    }
}

function delete_selected() {
    if (selected) {
        remove(selected.file);
    }
}

function select(file, ext) {
    file = files[file];
    if (file) {
        $('file-name').innerText = file.name;
        $('file-date').innerText = moment(new Date(file.time)).format('YY/MM/DD HH:mm:ss');
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
        $('file-go').innerText = (ext === 'g' ? 'print' : 'install');
        if (file_selected) {
            file_selected.classList.remove("file-selected");
        }
        file_selected = $(file.uuid);
        file_selected.classList.add("file-selected");
        selected = {file: file.name, ext};
    } else {
        selected = null;
    }
}

function print(file, ext) {
    if (!last_set) {
        alert('not connected');
        return;
    }
    if (alert_on_run()) return;
    if (ext === "h") {
        return firmware_update(file);
    }
    if (confirm(`start print "${file}"?`)) {
        send('*clear');
        send(`*kick ${file}`);
    }
}

function remove(file) {
    if (confirm(`delete "${file}"?`)) {
        send(`*delete ${file}`);
        setTimeout(() => {
            send('*list');
        }, 250);
    }
}

function clear_files() {
    if (confirm('delete all files?')) {
        for (file in files) {
            send(`*delete ${file}`);
        }
        setTimeout(() => {
            send('*list');
        }, 500);
    }
}

function center_go() {
    let stat = last_set;
    send(`G0 X${stat.device.max.X/2} Y${stat.device.max.Y/2} Z1 F7000`);
}

function origin_go() {
    if (alert_on_run()) return;
    send('G0 X0 Y0');
    send('G0 Z0');
}

function origin_set() {
    if (alert_on_run()) return;
    if (last_set && last_set.pos) {
        let pos = last_set.pos;
        send(`M206 X-${pos.X} Y-${pos.Y}`);
        send('M500');
    }
}

function origin_clear() {
    if (alert_on_run()) return;
    send('M206 X0 Y0 Z0');
    send('M500');
}

function fan_on() {
    if (alert_on_run()) return;
    send('M106 255');
}

function fan_off() {
    if (alert_on_run()) return;
    send('M107');
}

function calibrate_pid() {
    if (alert_on_run()) return;
    if (confirm('run hot end PID calibration?')) {
        send('M303 S220 C8 U1');
        menu_select('comm');
    }
}

function update_endstops() {
    send('M119');
}

function update_temps() {
    send('M105');
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

function goto_home() {
    if (alert_on_run()) return;
    send('G28');
    send('M18');
}

function disable_motors() {
    if (alert_on_run()) return;
    send('M18');
}

function stop_motors() {
    if (alert_on_run()) return;
    send('M410');
}

function clear_bed() {
    if (alert_on_run()) return;
    send('*clear');
    send('*status');
}

function print_next() {
    if (alert_on_run()) return;
    if (confirm(`start next print?`)) {
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

function controller_update() {
    if (alert_on_run()) return;
    if (confirm("update controller?")) {
        send('*exit');
    }
}

function pause() {
    if (status && status.print && status.print.run && confirm('pause print job?')) {
        send('*pause');
    }
}

function resume() {
    if (status && status.print && status.print.run && confirm('resume print job?')) {
        send('*resume');
    }
}

function abort() {
    if (confirm('abort print job?')) {
        send('*abort');
    }
}

function extrude(v) {
    if (alert_on_run()) return;
    gr(`E${jog_val} F250`);
}

function retract(v) {
    if (alert_on_run()) return;
    gr(`E-${jog_val} F250`);
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
    send('G91');
    send(`G0 ${msg}`);
    send('G90');
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
    var list = $("file-list-wrap");

    list.addEventListener("dragover", function(evt) {
        evt.stopPropagation();
        evt.preventDefault();
        evt.dataTransfer.dropEffect = 'copy';
        list.classList.add("bg_red");
    });

    list.addEventListener("dragleave", function(evt) {
        list.classList.remove("bg_red");
    });

    list.addEventListener("drop", function(evt) {
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
    let url = `http://${location.hostname}/camera.jpg?time=${time}`;
    img.onload = () => {
        document.documentElement.style.setProperty('--video-url', `url(${url})`);
        vids_timer = setTimeout(vids_update, 1000);
    };
    img.src = url;
}

let menu;
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

function init() {
    // bind left menu items and select default
    menu = {
        home: $('menu-home'),
        move: $('menu-move'),
        file: $('menu-file'),
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
        send('*list');
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
            let status = JSON.parse(msg.substring(spos+4, epos));
            last_set = status;
            if (status.state) {
                $('state').value = status.print.pause ? "paused" : status.state;
            }
            if (status.device && status.device.name) {
                document.title = status.device.name;
            }
            if (status.print) {
                $('filename').value = cleanName(status.print.filename);
                $('progress').value = status.print.progress + '%';
                if (status.print.clear) {
                    $('clear_bed').classList.remove('bg_red');
                } else {
                    $('clear_bed').classList.add('bg_red');
                }
                if (status.print.run) {
                    $('filename').classList.add('bg_green');
                    $('progress').classList.add('bg_green');
                    $('elapsed').classList.add('bg_green');
                } else {
                    $('filename').classList.remove('bg_green');
                    $('progress').classList.remove('bg_green');
                    $('elapsed').classList.remove('bg_green');
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
                        // $('bed').classList.add('bg_red');
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
                    html.push(`<tr class="settings"><th>${MCODE[key] || key}</th>`);
                    for (let k in map) {
                        let bk = `ep-${key}-${k}`;
                        let bv = [key, k];
                        html.push(`<th>${k}</th>`);
                        html.push(`<td><input id="${bk}" size="7" value="${map[k]}"></input</td>`);
                        valuehash += [k,map[k]].join('');
                        bind.push({bk,bv});
                    }
                    html.push('</tr>');
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
        } else if (msg.indexOf("*** [") >= 0) {
            let list = $('file-list');
            let html = [];
            let trim = msg.trim().substring(spos+4, epos);
            let time = Date.now();
            files = {};
            JSON.parse(trim).forEach(file => {
                let uuid = (time++).toString(36);
                let name = cleanName(file.name);
                let ext = file.ext.charAt(0);
                files[name] = file;
                file.uuid = uuid;
                html.push(`<div id="${uuid}" class="row" onclick="select('${name}','${ext}')" ondblclick="print('${name}','${ext}')"><label class="grow">${file.name}</label><button onclick="remove('${name}')">x</button></div>`);
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
    // reload page on status click
    // $('header').onclick = ev => {
    //     if (ev.target.id === 'state') {
    //         reload();
    //     }
    // };
    // disable autocomplete
    let inputs = document.getElementsByTagName('input');
    for (let i=0; i<inputs.length; i++) {
        inputs[i].setAttribute('autocomplete', Date.now().toString(36));
    }
    init_filedrop();
    input_deselect();
    // restore settings
    set_jog(parseFloat(settings.jog_val) || 1, $(settings.jog_sel || "j10"));
    set_jog_speed(parseFloat(settings.jog_speed) || 1, $(settings.jog_speed_sel || "js1000"));
}
