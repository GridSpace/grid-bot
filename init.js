module.exports = (server) => {
    let path = server.path;
    let join = require('path').join;
    let moddir = server.const.moddir;
    let srcdir = join(moddir, "src");
    let webdir = join(moddir, "src/web");

    // server "web" dir at the root of "/data"
    path.static(webdir, "/send");
};
