#!/bin/bash

[ -z "$1" ] && echo "missing host name" && exit

echo "HOST NAME=${1}"
echo "${1}" > /etc/hostname || echo "unable to update hostname"
echo "127.0.0.1 ${1}" >> /etc/hosts || echo "unable to undate hosts"
hostname "${1}"

echo "updated host name. reboot required"
