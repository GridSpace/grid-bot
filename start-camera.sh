#!/bin/bash

while /bin/true; do
	raspistill -w 1600 -h 1200 -q 20 -n -o /tmp/camera.jpg -l /var/www/html/camera.jpg -t 500 -ss 40000 -rot 90 || exit
done
