#!/bin/bash

# for standalone operation, add the following line to /etc/rc.local
# nohup nice -n 19 su -l -c /home/pi/start-camera.sh pi > /tmp/camera.log 2>&1 &

cd /home/pi/grid-bot >/dev/null 2>&1 || cd /home/pi

export cmd=$(which raspistill || which libcamera-still)

[ ! -z $cmd ] || exit

while /bin/true; do
    [ -f etc/camera.conf ] && source etc/camera.conf
    export RUN=1
    export DATE=$(date '+%Y-%m-%d')
    export TIME=$(date '+%H:%M')
    export TMPFILE=/tmp/camera.jpg
    if [ ! -z ${TIMELAPSE} ]; then
       mkdir -p "${TIMELAPSE}/${DATE}"
       export TMPFILE="${TIMELAPSE}/${DATE}/${TIME}.jpg"
       if [ ! -z ${MAXAGE} ]; then
           find ${TIMELAPSE} -type f -mtime ${MAXAGE} -print -delete
           rmdir "${TIMELAPSE}/*" >/dev/null 2>&1
       fi
       if [ ! -z ${TRIGGER} ]; then
           if [ ! -f ${TRIGGER} ]; then
               export RUN=0
           fi
       fi
    fi
    [ ${RUN} -eq 1 ] && ${cmd} -n \
        --width ${WIDTH:-1600} \
        --height ${HEIGHT:-1200} \
        -q ${QUALITY:-20} \
        -o ${FILE_TEMP:-${TMPFILE}} \
        --latest ${FILE_PERM:-/var/www/html/camera.jpg} \
        -t ${TIMEOUT:-500} \
        --shutter ${EXPOSURE:-40000} \
        --rotation ${ROTATION:-90} \
		-awb ${BALANCE:-greyworld}
done
