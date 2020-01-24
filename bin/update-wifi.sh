#!/bin/bash

[ -z "$1" ] && echo "missing ssid" && exit
[ -z "$2" ] && echo "missing psk" && exit

export TMPF=/tmp/wpa_supplicant.conf
export FILE=/etc/wpa_supplicant/wpa_supplicant.conf

echo "SSID=${1}"
echo "PSK=${2}"
echo "FILE=${FILE}"

cat > ${TMPF} << EOF
ctrl_interface=DIR=/var/run/wpa_supplicant GROUP=netdev
update_config=1
country=US

network={
    ssid="${1}"
    psk="${2}"
}
EOF

sudo mv ${TMPF} ${FILE}
sudo cat ${FILE}

echo "updated wifi settings. reboot required"
