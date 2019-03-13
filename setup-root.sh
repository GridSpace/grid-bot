#!/bin/bash

apt -y update \
&& apt -y dist-upgrade \
&& dpkg-reconfigure tzdata \
&& echo pi-gridbot > /etc/hostname \
&& echo "127.0.0.1  pi-gridbot" >> /etc/hosts \
&& passwd pi

grep grid:bot /boot/config.txt || cat config.txt >> /boot/config.txt
