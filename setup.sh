#!/bin/bash

[ -z "${HOME}" ] && echo "HOME not set" && exit

# link serial port usb device, create uploads dir
cd ${HOME}/grid-bot
rm port
mkdir -p uploads
if [ -f /dev/ttyACM0 ]; then
	ln -s /dev/ttyACM0 port
else
	ln -s /dev/ttyUSB0 port
fi

# download, expand, link node
if [ ! -f node ]; then
	echo "downloading nodejs"
	which wget || sudo apt -y install wget
	wget https://nodejs.org/dist/v10.15.3/node-v10.15.3-linux-armv6l.tar.xz
	tar xf node-v10.15.3-linux-armv6l.tar.xz
	ln -s node-v10.15.1-linux-armv6l node
fi

# ensure node in path
which node || echo "missing nodejs" && {
	echo "export PATH=\${PATH}:\${HOME}/grid-bot/node/bin" >> ${HOME}/.bashrc
}

# make sure npm will work
export PATH=${PATH}:${HOME}/grid-bot/node/bin

[ ! -d "${HOME}/grid-host" ] && {
	echo "installing grid-host"
	cd ${HOME}
	git clone https://github.com/GridSpace/grid-host.git grid-host
	cd grid-host
	npm i
}

# reminder to setup /etc/rc.local
cat > /dev/stdout << EOF
--- add the following lines to /etc/rc.local ---
nohup nice -n -20 su -l -c /home/pi/start-gridbot.sh pi > /tmp/gridbot.log 2>&1 &
nohup nice -n 19 su -l -c /home/pi/start-gridhost.sh pi > /tmp/gridhost.log 2>&1 &
nohup nice -n 19 /home/pi/start-camera.sh > /tmp/camera.log 2>&1 &
EOF

