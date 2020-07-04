# -*- coding: utf-8 -*-
from __future__ import absolute_import, division, print_function, unicode_literals

__license__ = 'MIT'
__copyright__ = "Copyright (C) Stewart Allen [sa@grid.space]"

import octoprint.plugin
import requests
import hashlib
import logging

try:
    # noinspection PyCompatibility
    from urllib.parse import urlencode
except ImportError:
    from urllib import urlencode

# noinspection PyCompatibility
import concurrent.futures

from octoprint.util import RepeatedTimer, monotonic_time
from octoprint.util.version import get_octoprint_version_string
from octoprint.events import Events
from octoprint.filemanager.util import DiskFileWrapper


import json
import time
import urllib
import socket
import requests
import threading

from requests.exceptions import Timeout
from requests.exceptions import HTTPError
from requests.exceptions import ConnectionError

uuid = socket.getfqdn()
host = socket.gethostname()
addr = str(socket.gethostbyname(host))
stat = {"device":{"name":host,"host":host,"uuid":uuid,"port":5000,"mode":"octo","addr":[addr]},"state":"ready"}
stat = urllib.parse.quote_plus(json.dumps(stat, separators=(',', ':')))
url = "https://grid.space/api/grid_up?uuid={uuid}&stat={stat}".format(uuid=uuid,stat=stat)

def background_spool(file_saver, logger):
    while True:
        logger.debug('connect')
        try:
            response = requests.get(url)
        except ConnectionError as error:
            logger.info('connection error {}'.format(error))
            time.sleep(10)
            break
        except HTTPError as error:
            logger.info('http error {}'.format(error))
            time.sleep(5)
            break
        except Timeout:
            logger.info('timeout')
            time.sleep(1)
            continue

        if response:
            text = response.text
            if text == 'superceded':
                logger.info('superceded')
                break
            elif text == 'reconnect':
                logger.debug('reconnect')
            else:
                body = text.split('\0')
                file = body[0]
                gcode = body[1]
                logger.info('received "{}" length={}'.format(file,len(gcode)))
                file_saver(file, gcode)

class FileSaveWrapper:
    def __init__(self, gcode):
        self.gcode = gcode

    def save(self, destination):
        f = open(destination, "w")
        f.write(self.gcode)
        f.close()

class GridLocalPlugin(octoprint.plugin.SettingsPlugin,
                     octoprint.plugin.StartupPlugin,
                     octoprint.plugin.EnvironmentDetectionPlugin):

    def __init__(self):
        self._start_time = monotonic_time()

    def initialize(self):
        self._logger.debug('initialize')
        thread = threading.Thread(target=background_spool, kwargs=({
            "file_saver": self.file_saver,
            "logger": self._logger
        }))
        thread.daemon = True
        thread.start()
        self._thread = thread

    def file_saver(self, filename, gcode):
        wrapper = FileSaveWrapper(gcode)
        self._file_manager.add_file("local", filename, wrapper)

    def get_settings_defaults(self):
        return dict(enabled=None)

    def on_settings_save(self, data):
        self._logger.debug('gridlocal:settings_save')

    def on_environment_detected(self, environment, *args, **kwargs):
        self._environment = environment

    def on_after_startup(self):
        self._logger.debug('gridlocal:after startup')

    def on_event(self, event, payload):
        self._logger.debug('gridlocal:event {} {}'.format(event,payload))

__plugin_name__ = "Grid.Local Cloud Spooler"
__plugin_description__ = "Provides access to a secure endpoint allowing for local spooling from browser-based applications"
__plugin_url__ = "https://github.com/GridSpace/grid-bot"
__plugin_author__ = "Stewart Allen"
__plugin_author_email = "sa@grid.space"
__plugin_implementation__ = GridLocalPlugin()
