software interface for [gridbot](https://cad.onshape.com/documents/64a8b0664bd09cbffb0e0d17/w/044a002e53008b3bc2a845ec/e/9b8b7abe5b303b24f2f26d14) and other 3D printers or CNC mills.

### Just the Sender and Web UI

this is suitable for anything from a Pi Zero on up.

1. clone this repo
2. cd to repo directory
3. `npm i`
4. if you don't have pm2 installed: `npm install -g pm2@latest`
5. create/edit `etc/server.json` inside the repo directory
6. `pm2 start src/js/server.js --name gridbot`
7. `pm2 log`

the web interface will be on port `4080`

### etc/server.json

```
{
	"port": "/dev/ttyUSB0",
	"baud": 250000,
}
```

### for Klipper

```
{
	"port": "/tmp/printer",
	"baud": 250000,
	"on": {
		"boot": [
			"M115"
		]
	}
}
```

### Full Touch-Pi Intall

from a fresh install of raspbian desktop, as user ```pi``` run this command:

```curl https://raw.githubusercontent.com/GridSpace/grid-bot/master/setup.sh | bash```

this could run for quite some time to update and install all OS dependencies

### Home Screen
![GridBot Home Screen](https://static.grid.space/img/gridbot-home.jpg)

### Jog and Movement Screen
![GridBot Move Screen](https://static.grid.space/img/gridbot-move.jpg)

### File Management Screen
![GridBot File Screen](https://static.grid.space/img/gridbot-file.jpg)

### Direct Communications Interface
![GridBot Comm Screen](https://static.grid.space/img/gridbot-comm.jpg)
