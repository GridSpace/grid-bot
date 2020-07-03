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


import json
import time
import urllib
import socket
import asyncio
import requests

from requests.exceptions import Timeout
from requests.exceptions import HTTPError
from requests.exceptions import ConnectionError

uuid = socket.getfqdn()
host = socket.gethostname()
addr = str(socket.gethostbyname(host))
stat = {"device":{"name":host,"host":host,"uuid":uuid,"port":5000,"mode":"octo","addr":[addr]},"state":"ready"}
stat = urllib.parse.quote_plus(json.dumps(stat, separators=(',', ':')))
url = "https://grid.space/api/grid_up?uuid={uuid}&stat={stat}".format(uuid=uuid,stat=stat)

async def background_spool():
    while True:
        print('grid.spool connect')

        try:
            response = requests.get(url)
        except ConnectionError as error:
            print('connection error', error)
            time.sleep(10)
            break
        except HTTPError as error:
            print('http error', error)
            time.sleep(5)
            break
        except Timeout:
            print('timeout')
            time.sleep(1)
            continue
    #    except:
    #        print('error')
    #        continue

        if response:
            text = response.text
            if text == 'superceded':
                print('superceded')
                break
            elif text == 'reconnect':
                print('reconnect')
            else:
                body = text.split('\0')
                file = body[0]
                gcode = body[1]
                print('file',file)
                print('gcode',len(gcode))


# noinspection PyMissingConstructor
class GridLocalPlugin(octoprint.plugin.SettingsPlugin,
                     octoprint.plugin.StartupPlugin,
                     octoprint.plugin.EnvironmentDetectionPlugin):

    def __init__(self):
        self._startup_time = monotonic_time()
        print('gridlocal','__init__')

    def initialize(self):
        print('gridlocal','initialize')
        asyncio.run(background_spool())

    ##~~ SettingsPlugin

    def get_settings_defaults(self):
        return dict(enabled=None)

    def on_settings_save(self, data):
        print('gridlocal','settings_save')

        enabled = self._settings.get(["enabled"])

        octoprint.plugin.SettingsPlugin.on_settings_save(self, data)

        #if enabled is None and self._settings.get(["enabled"]):
            # tracking was just enabled, let's start up tracking
            #self._start_tracking()

    ##~~ EnvironmentDetectionPlugin

    def on_environment_detected(self, environment, *args, **kwargs):
        print('gridlocal','environment',environment)

        self._environment = environment

    ##~~ StartupPlugin

    def on_after_startup(self):
        print('gridlocal','after startup')

    # noinspection PyUnresolvedReferences
    def on_event(self, event, payload):
        print('gridlocal','event',event,payload)

    ##~~ helpers

    def _init_id(self):
        if not self._settings.get(["unique_id"]):
            import uuid
            self._settings.set(["unique_id"], str(uuid.uuid4()))
            self._settings.save()

__plugin_name__ = "Grid.Local Cloud Spooler"
__plugin_description__ = "Provides access to a secure endpoint allowing for local spooling from browser-based applications"
__plugin_url__ = "https://github.com/GridSpace/grid-bot"
__plugin_author__ = "Stewart Allen"
__plugin_author_email = "sa@grid.space"
__plugin_implementation__ = GridLocalPlugin()
