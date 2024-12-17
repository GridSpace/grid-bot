/** Copyright Stewart Allen <sa@grid.space> */

module.exports = { start, restart, stop, status };

/**
 *
 * @param {*} type device type
 * @param {*} url usually live.grid.space
 * @param {*} status device status
 * @param {*} update called on file receipt with (filename, gcode)
 */
function start(type, url, status, update) {
    if (req) {
        throw "grid send already started";
    }
    console.log({starting: "gridsend", url});
    proto = url.indexOf("https:") >= 0 ? https : http;
    stopped = false;
    looper(type, url, status, update);
}

function stop() {
    stopped = true;
    if (req) {
        req.destroy();
        req = undefined;
    }
}

function restart() {
    if (req) {
        req.destroy();
        req = undefined;
    }
}

function status() {
    return { stopped };
}

const https = require('https');
const http = require('http');

let gridlast = '*';
let stopped;
let req;
let debug = false;

function looper(type, url, status, update) {
    let timer = Date.now();
    let killer = null;
    let sclean = JSON.parse(JSON.stringify(status));
    sclean.buffer.collect = undefined;

    const opts = [
        `uuid=${encodeURIComponent(status.device.uuid)}`,
        `stat=${encodeURIComponent(JSON.stringify(sclean))}`,
        `last=${gridlast}`,
        `time=${timer.toString(36)}`,
        `type=${type}`
    ].join('&');

    if (opts.length > 4096) {
        console.log({invalid_opts: opts, exiting: true});
        stopped = true;
    }

    const retry = function(time, bool) {
        debug = bool;
        if (killer) {
            clearTimeout(killer);
        }
        if (stopped) {
            return;
        }
        setTimeout(() => {
            looper(type, url, status, update);
        }, time);
    };

    if (debug) {
        console.log({grid_up: url});
    }
    req = proto.get(`${url}/api/grid_up?${opts}`, (res) => {
        const { headers, statusCode, statusMessage } = res;
        gridlast = '*';
        if (debug) {
            console.log([headers, statusCode, statusMessage]);
        }
        let body = '';
        res.on('data', data => {
            body += data.toString();
        });
        res.on('end', () => {
            debug = false;
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
                    update(file, gcode);
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
            retry(2000, true);
        });
    }).on('error', error => {
        console.log({grid_up_error: error});
        retry(2000, true);
    });
    killer = setTimeout(() => {
        console.log("killing zombied connection @ 3 min idle");
        restart();
    }, 3 * 60 * 1000);
}
