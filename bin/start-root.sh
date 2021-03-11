#!/bin/bash

export ROOT=/home/pi/grid-bot

# redirect traffic from port 80 to gridbot interface
iptables -A PREROUTING -t nat -i eth0 -p tcp --dport 80 -j REDIRECT --to-port 4080

nohup nice -n -20 su -l -c ${ROOT}/bin/start-gridbot.sh pi > /tmp/gridbot.log 2>&1 &
#nohup nice -n 19 su -l -c ${ROOT}/bin/start-gridhost.sh pi > /tmp/gridhost.log 2>&1 &
nohup nice -n 19 ${ROOT}/bin/start-camera.sh > /tmp/camera.log 2>&1 &
