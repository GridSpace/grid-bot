#!/bin/bash

export ROOT=/home/pi/grid-bot

nohup nice -n -20 su -l -c ${ROOT}/start-gridbot.sh pi > /tmp/gridbot.log 2>&1 &
nohup nice -n 19 su -l -c ${ROOT}/start-gridhost.sh pi > /tmp/gridhost.log 2>&1 &
nohup nice -n 19 ${ROOT}/start-camera.sh > /tmp/camera.log 2>&1 &
