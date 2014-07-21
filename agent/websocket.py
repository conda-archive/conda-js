import json
import subprocess

import sockjs.tornado
import tornado.ioloop
import tornado.iostream
import tornado.web
import tornado.wsgi


class CondaJsWebSocketRouter(sockjs.tornado.SockJSConnection):
    def on_message(self, message):
        message = json.loads(message)
        subcommand = message['subcommand']
        flags = message['flags']
        positional = message['positional']

        # http://stackoverflow.com/a/14281904/262727
        # Use subprocess here to take advantage of Tornado's async process
        # routines.
        cmdList = parse(subcommand, flags, positional)
        self.subprocess = subprocess.Popen(cmdList, stdout=subprocess.PIPE)
        self.stream = tornado.iostream.PipeIOStream(self.subprocess.stdout.fileno())
        self.stream.read_until(b'\n', self.on_newline)

    def on_newline(self, data):
        # We don't know if there's going to be more progressbars or if
        # everything is done. Thus, we read to a newline, try to parse it as
        # JSON - the progressbar formatter will put all its JSON on one
        # line, while the --json formatter will not. If it parses, continue
        # looking for progressbars, else read everything else and send the
        # result.
        data = data.decode('utf-8')
        try:
            data = json.loads(data)
            self.send(json.dumps({ 'progress': data }))
            self.stream.read_bytes(
                1,
                lambda x: self.stream.read_until(b'\n', self.on_newline)
            ) # get rid of the null byte
        except ValueError:
            self.buf = data
            self.stream.read_until_close(self.on_close)

    def on_close(self, data):
        self.send(json.dumps({ 'finished': json.loads(self.buf + data.decode('utf-8')) }))


def wrap(app, url, debug=False):
    wsgi_app = tornado.wsgi.WSGIContainer(app)
    condajs_ws = sockjs.tornado.SockJSRouter(CondaJsWebSocketRouter, url)
    routes = condajs_ws.urls
    routes.append((r".*", tornado.web.FallbackHandler, dict(fallback=wsgi_app)))
    application = tornado.web.Application(routes, debug=debug)

    return wsgi_app, application
