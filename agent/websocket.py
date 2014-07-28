import json
import subprocess
import threading

import sockjs.tornado
import tornado.ioloop
import tornado.web
import tornado.wsgi

from .common import parse


class CondaSubprocessWorker(threading.Thread):
    def __init__(self, cmdList, send, *args, **kwargs):
        super(CondaSubprocessWorker, self).__init__(*args, **kwargs)
        self.cmdList = cmdList
        self.send = send

    def run(self):
        p = subprocess.Popen(self.cmdList, stdout=subprocess.PIPE)
        f = p.stdout
        while True:
            line = f.readline()

            if line[0] in (0, '\0'):
                line = line[1:]
            data = line.decode('utf-8')
            try:
                data = json.loads(data)
                self.send({ 'progress': data })
            except ValueError:
                rest = data + f.read().decode('utf-8')
                self.send({ 'finished': json.loads(rest) })
                break

class CondaJsWebSocketRouter(sockjs.tornado.SockJSConnection):
    def on_message(self, message):
        message = json.loads(message)
        subcommand = message['subcommand']
        flags = message['flags']
        positional = message['positional']

        # Use a thread here - Tornado's nonblocking pipe is not portable
        cmdList = parse(subcommand, flags, positional)
        self.worker = CondaSubprocessWorker(cmdList, self.process)
        self.worker.start()

    def process(self, data):
        self.send(json.dumps(data))


def wrap(app, url, debug=False):
    wsgi_app = tornado.wsgi.WSGIContainer(app)
    condajs_ws = sockjs.tornado.SockJSRouter(CondaJsWebSocketRouter, url)
    routes = condajs_ws.urls
    routes.append((r".*", tornado.web.FallbackHandler, dict(fallback=wsgi_app)))
    application = tornado.web.Application(routes, debug=debug)

    return wsgi_app, application
