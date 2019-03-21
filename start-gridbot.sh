#!/bin/bash

export HOME=/home/pi
export ROOT=${HOME}/grid-bot
export NODE=${ROOT}/node/bin/node
export BAUD=250000

cd ${HOME}/grid-host
while /bin/true; do
	echo "--- starting --- $(date)"
	${NODE} src/serial.js --baud=${BAUD} --web --listen --filedir=${ROOT}/uploads
	echo "--- exited ---"
done
