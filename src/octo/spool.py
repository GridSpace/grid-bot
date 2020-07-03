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
#print('url',url)
#print('stat',stat)
#print('addr',addr)

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

print('before')

asyncio.run(background_spool())

print('after')
