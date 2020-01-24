#!/bin/bash

export HOME=/home/pi
export ROOT=${HOME}/grid-bot
export NODE=${ROOT}/node/bin/node
export BAUD=250000
export OPTS='--web --listen --baud=${BAUD} --filedir=${ROOT}/uploads'

cd ${ROOT}
while /bin/true; do
    [ -f etc/serial.conf ] && source etc/serial.conf
	echo "--- starting --- $(date)"
	eval "${NODE} src/js/serial.js ${OPTS}"
	echo "--- exited ---"
done
