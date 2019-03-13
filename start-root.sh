#!/bin/bash

nohup nice -n -20 su -l -c /home/pi/start-gridbot.sh pi > /tmp/gridbot.log 2>&1 &
nohup nice -n 19 su -l -c /home/pi/start-gridhost.sh pi > /tmp/gridhost.log 2>&1 &
nohup nice -n 19 /home/pi/start-camera.sh > /tmp/camera.log 2>&1 &

