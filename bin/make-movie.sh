#!/bin/zsh

layers=$1

[ -z "$layers" ] && echo "missing layers parameter" && exit

x=0

while [ $x -lt $layers ]; do
	cf="image-$(printf "%04d" $x).jpg"
	[ ! -f $cf ] && echo "missing $cf" && (
		cp $lf $cf
	)
	lf=$cf
	x=$((x+1))
done

ffmpeg -r 60 -i image-%04d.jpg movie.mp4
