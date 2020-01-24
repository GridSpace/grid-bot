#!/bin/bash

(
	echo "updating code from github"
	cd ../grid-bot && git pull && \
	cd ../grid-host && git pull && \
	cd ../grid-apps && git pull
    echo "code update complete"
) | tee -a /tmp/update-code.log
