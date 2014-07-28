import sys
import flask
import argparse

parser = argparse.ArgumentParser()
parser.add_argument('--rpc', action='store_true', default=False)
parser.add_argument('--rest', action='store_true', default=False)
parser.add_argument('--no-websockets', action='store_true', default=False)
parser.add_argument('--cross-origin', action='store_true', default=False)
parser.add_argument('--port', type=int, default=8000)
parser.add_argument('--root', type=str, default='/api')

args = parser.parse_args()

method = 'rpc'
if args.rest:
    method = 'rest'

if method == 'rpc':
    from agent import rpc as blueprint
elif method == 'rest':
    from agent import rest as blueprint


if __name__ == '__main__':
    app = flask.Flask(__name__, template_folder='./')
    app.config['SECRET_KEY'] = 'secret'

    @app.route('/')
    def index():
        return flask.render_template('test.html')

    @app.route('/mocha.js')
    def mochajs():
        return open('./node_modules/mocha/mocha.js').read()

    @app.route('/mocha.css')
    def mochacss():
        return open('./node_modules/mocha/mocha.css').read()

    @app.route('/test.browser.js')
    def test():
        return open('test.browser.js').read()

    @app.route('/conda.js')
    def conda():
        return open('conda.js').read()

    print("Using method", method)

    blueprint.conda_js.url_prefix = args.root

    if args.cross_origin:
        print("Allowing cross origin responses")

        @blueprint.conda_js.after_request
        def add_cross_origin(response):
            response.headers['Access-Control-Allow-Origin'] = '*'
            response.headers['Access-Control-Allow-Headers'] = 'Content-Type'
            response.headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE'
            return response

    app.register_blueprint(blueprint.conda_js)

    if '--no-progress' in sys.argv:
        app.run(port=args.port, debug=True)
    else:
        print("Using websockets")

        import tornado.ioloop
        from agent.websocket import wrap
        wsgi_app, application = wrap(app, args.root + '_ws', debug=False)
        application.listen(args.port)
        tornado.ioloop.IOLoop.instance().start()
