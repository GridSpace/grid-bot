// serial port worker
let serial = self.navigator ? self.navigator.serial : undefined;
let port;

if (!serial) {
    console.log('no serial support');
} else {
    init().catch(err => {
        console.log({err});
    });
}

async function init() {
    console.log('init serial', serial);
}

function getPorts() {
    serial.getPorts()
        .then(ports => {
            send(ports.length);
        })
        .catch(err => {
            console.log({err});
        });
}

function openPort(portnum, baudRate) {
    serial.getPorts()
        .then(ports => {
            port = ports[portnum];
            return port.open({ baudRate });
        })
        .then(abc => {
            send(`*open ${portnum}`);
        })
        .catch(err => {
            console.log({err});
        });
}

function send(msg) {
    switch (typeof msg) {
        case 'object':
            postMessage(JSON.stringify(msg));
            break;
        default:
            postMessage(msg);
            break;
    }
}

self.onmessage = (msg) => {
    console.log('index said', msg.data);
    let data = msg.data.toString();
    let toks = data.split(' ');
    switch (toks[0]) {
        case '*ports':
            getPorts();
            break;
        case '*port':
            openPort(parseInt(toks[1]) || 0, parseInt(toks[2]) || 9600);
            break;
    }
};

send('*ready');
