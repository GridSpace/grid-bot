function init() {
    document.body.onclick = () => {
        window.location = `http://${location.hostname}:4080/index.html`;
    };
    updateImage();
}

function updateImage() {
    let time = Date.now();
    let img = new Image();
    let url = `http://${location.hostname}/camera.jpg?time=${time}`;
    img.onload = () => {
        document.documentElement.style.setProperty('--image-url', `url(${url})`);
        setTimeout(updateImage, 1000);
    };
    img.src = url;
}
