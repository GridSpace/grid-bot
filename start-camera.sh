#!/bin/bash

while /bin/true; do
	raspistill -w 1600 -h 1200 -q 20 -n -o /tmp/camera.jpg -l /var/www/html/camera.jpg -tl 1000 -t 10000000 -ss 40000 -rot 90
done
