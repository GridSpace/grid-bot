#!/bin/bash

export HOME=/home/pi
export ROOT=${HOME}/grid-bot
export NODE=${ROOT}/node/bin/node
export BAUD=250000
export OPTS='--web --listen --baud=${BAUD} --filedir=${ROOT}/uploads'

cd ${HOME}/grid-host
while /bin/true; do
    [ -f etc/serial.conf ] && source etc/serial.conf
	echo "--- starting --- $(date)"
	eval "${NODE} src/serial.js ${OPTS}"
	echo "--- exited ---"
done
