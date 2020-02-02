#!/bin/bash

# update config.txt with required fields
grep grid:bot /boot/config.txt || cat /home/pi/grid-bot/etc/root-config.txt >> /boot/config.txt

# update rc.local to start grid:bot services
cp /home/pi/grid-bot/bin/root-rc.local /etc/rc.local

# allow tcp on x server
grep ^xserver-allow-tcp=true /etc/lightdm/lightdm.conf || echo xserver-allow-tcp=true >> /etc/lightdm/lightdm.conf

# update pacakges
[ ! -f ${HOME}/.gb-up ] && apt -y update && apt -y dist-upgrade && touch ${HOME}/.gb-up

# set timezone
[ ! -f ${HOME}/.gb-tz ] && dpkg-reconfigure tzdata && touch ${HOME}/.gb-tz

grep pi-gridbot /etc/hostname || (
    echo pi-gridbot > /etc/hostname
    echo "127.0.0.1 pi-gridbot" >> /etc/hosts
)
