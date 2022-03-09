/** Copyright Stewart Allen <sa@grid.space> */

class LineBuffer {

    constructor(stream, online) {
        if (!stream) {
            throw "missing stream";
        }
        const lbuf = this;
        this.enabled = true;
        this.buffer = null;
        this.stream = stream;
        this.online = online;
        this.bytes = 0;
        this.crlf = false;
        if (online) {
            stream.on("readable", () => {
                let data;
                while (data = stream.read()) {
                  lbuf.ondata(data);
                }
            });
        } else {
            stream.on("data", data => {
                lbuf.ondata(data);
            });
        }
    }

    ondata(data) {
        this.bytes += data.length;
        if (this.buffer) {
            this.buffer = Buffer.concat([this.buffer, data]);
        } else {
            this.buffer = data;
        }
        this.nextLine();
    }

    nextLine() {
        if (!this.enabled) {
            return;
        }
        let left = 0;
        const data = this.buffer;
        const cr = data.indexOf("\r");
        const lf = data.indexOf("\n");
        if (lf && cr + 1 == lf) {
            left = 1;
            this.crlf = true;
        } else {
            this.crlf = false;
        }
        if (lf >= 0) {
            let slice = data.slice(0, lf - left);
            if (this.online) {
                this.online(slice);
            } else {
                this.stream.emit("line", slice);
            }
            this.buffer = data.slice(lf + 1);
            this.nextLine();
        }
    }

}

module.exports = LineBuffer;
