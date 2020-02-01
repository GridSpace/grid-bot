#!/bin/bash

(
    echo "updating code from github"
    [ -d ../grid-bot ]  && (cd ../grid-bot  && git pull && npm i)
    [ -d ../grid-host ] && (cd ../grid-host && git pull && npm i)
    [ -d ../grid-apps ] && (cd ../grid-apps && git pull && npm i)
    sudo cp /home/pi/grid-bot/bin/root-rc.local /etc/rc.local
    echo "code update complete"
) | tee -a /tmp/update-code.log
