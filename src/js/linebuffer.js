/** Copyright Stewart Allen <sa@grid.space> -- All Rights Reserved */

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
        if (lf && cr + 1 == lf) { left = 1 }
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
