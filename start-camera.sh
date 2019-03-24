#!/bin/bash

cd /home/pi/grid-bot

while /bin/true; do
    [ -f etc/camera.conf ] && source etc/camera.conf
	raspistill -n \
        -w ${WIDTH:-1600} \
        -h ${HEIGHT:-1200} \
        -q ${QUALITY:-20} \
        -o ${FILE_TEMP:-/tmp/camera.jpg} \
        -l ${FILE_PERM:-/var/www/html/camera.jpg} \
        -t ${TIMEOUT:-500} \
        -ss ${EXPOSURE:-40000} \
        -rot ${ROTATION:-90} || exit
done
