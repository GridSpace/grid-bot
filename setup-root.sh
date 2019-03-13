#!/bin/bash

# update config.txt with required fields
grep grid:bot /boot/config.txt || cat /home/pi/grid-bot/root-config.txt >> /boot/config.txt

# update rc.local to start grid:bot services
cp /home/pi/grid-bot/root-rc.local /etc/rc.local

# update pacakges, timezone, password
apt -y update \
&& apt -y dist-upgrade \
&& dpkg-reconfigure tzdata \
&& echo pi-gridbot > /etc/hostname \
&& echo "127.0.0.1 pi-gridbot" >> /etc/hosts \
&& passwd pi
