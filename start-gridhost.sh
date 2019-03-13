#!/bin/bash

export HOME=/home/pi
export PATH=$PATH:$HOME/node/bin

cd $HOME/grid-host/
bin/grid-host
