#!/bin/bash

export HOME=/home/pi
export PATH=$PATH:$HOME/grid-bot/node/bin

cd $HOME/grid-host/
while /bin/true; do
	echo "--- starting --- $(date)"
    bin/grid-host
    echo "--- exited ---"
done
