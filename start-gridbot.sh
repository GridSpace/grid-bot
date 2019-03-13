#!/bin/bash

export HOME=/home/pi
export ROOT=${HOME}/grid-bot
export NODE=${ROOT}/node/bin/node

export TTY=${ROOT}/port
export BAUD=250000
export SOCKET=4000
export WEBPORT=4080

cd ${HOME}/grid-host
while /bin/true; do
	echo "--- starting ---"
	${NODE} src/serial.js --port=${TTY} --baud=${BAUD} --webport=${WEBPORT} --webdir=web/marlin --listen=${SOCKET} --filedir=${ROOT}/uploads
	echo "--- exited ---"
done
