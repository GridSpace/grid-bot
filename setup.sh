#!/bin/bash

# require some packages
which git || sudo apt -y install automake avrdude g++ git install nginx vim

[ -z "${HOME}" ] && echo "HOME not set" && exit

cd ${HOME}

# install grid-bot package if missing
[ ! -d "${HOME}/grid-bot" ] && {
    echo "fetching grid-bot"
    git clone https://github.com/GridSpace/grid-bot.git
}

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
	ln -s node-v10.15.3-linux-armv6l node
fi

# ensure node in path
which node || echo "missing nodejs" && {
	echo "export PATH=\${PATH}:\${HOME}/grid-bot/node/bin" >> ${HOME}/.bashrc
}

# make sure npm will work
export PATH=${PATH}:${HOME}/grid-bot/node/bin

# install grid-host
[ ! -d "${HOME}/grid-host" ] && {
	echo "installing grid-host"
	cd ${HOME}
	git clone https://github.com/GridSpace/grid-host.git grid-host
	cd grid-host
	npm i
}

# install grid-apps
[ ! -d "${HOME}/grid-apps" ] && {
	echo "installing grid-apps"
	cd ${HOME}
	git clone https://github.com/GridSpace/grid-apps.git grid-apps
	cd grid-apps
	npm i
}

# do required root setups
[ ! -d "${HOME}/.grid" ] && sudo ${HOME}/grid-bot/setup-root.sh && mkdir "${HOME}/.grid"
