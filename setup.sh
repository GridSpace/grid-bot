#!/bin/bash

# require some packages
sudo apt -y install automake avrdude g++ git nginx unclutter vim wget

[ -z "${HOME}" ] && echo "HOME not set" && exit

cd ${HOME}

# quietly remove all empty directories
rmdir * >/dev/null 2>&1

export ROOT="${HOME}/grid-bot"

# install grid-bot package if missing
[ ! -d "${ROOT}" ] && {
    echo "fetching grid-bot"
    git clone https://github.com/GridSpace/grid-bot.git
}

# update grid-bot
cd "${ROOT}"
git pull
npm i

# uploads dir, remove legacy port link
cd ${ROOT}
rm port
mkdir -p uploads

# setup graphical interface boot
export LXDIR=${HOME}/.config/lxsession/LXDE-pi
mkdir -p "${LXDIR}"
cp "${ROOT}/bin/pi-ui-autostart" "${LXDIR}/autostart"
chmod 755 "${LXDIR}/autostart"

# download, expand, link node
if [ ! -d node ]; then
    echo "downloading nodejs"
    # for pi zero
    grep ARMv6 /proc/cpuinfo && {
        wget https://nodejs.org/dist/v10.15.3/node-v10.15.3-linux-armv6l.tar.xz
        tar xf node-v10.15.3-linux-armv6l.tar.xz
        ln -sf node-v10.15.3-linux-armv6l node
    }
    # for pi 3
    grep ARMv7 /proc/cpuinfo && {
        wget https://nodejs.org/dist/v10.15.3/node-v10.15.3-linux-armv7l.tar.xz
        tar xf node-v10.15.3-linux-armv7l.tar.xz
        ln -sf node-v10.15.3-linux-armv7l node
    }
fi

# ensure node in path
grep node ${HOME}/.bashrc || {
    echo "export PATH=\${PATH}:${ROOT}/node/bin" >> ${HOME}/.bashrc
}

# make sure npm will work
export PATH=${PATH}:${ROOT}/node/bin

# install grid-host
[ ! -d "${HOME}/grid-host" ] && {
    echo "installing grid-host"
    cd ${HOME}
    git clone https://github.com/GridSpace/grid-host.git grid-host
}

# update grid-host modules
cd "${HOME}/grid-host"
git pull
npm i

# install grid-apps
[ ! -d "${HOME}/grid-apps" ] && {
    echo "installing grid-apps"
    cd ${HOME}
    git clone https://github.com/GridSpace/grid-apps.git grid-apps
}

# update grid-apps modules
cd "${HOME}/grid-apps"
git pull
npm i

# do required root setups
[ ! -d "${HOME}/.grid" ] && sudo ${ROOT}/bin/setup-root.sh && mkdir "${HOME}/.grid"

# ssh setup/trust if desired
[ ! -d "${HOME}/.ssh" ] && {
    mkdir -p "${HOME}/.ssh"
    chmod 700 "${HOME}/.ssh"
}

echo "change pi user password"
echo "reboot required"
