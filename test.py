import sys
import flask

method = 'rpc'
if '--rest' in sys.argv:
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

    @app.route('/<fname>')
    def file(fname):
        return open(fname).read()

    print("Using method", method)

    blueprint.conda_js.url_prefix = '/api'
    app.register_blueprint(blueprint.conda_js)

    if '--progress' in sys.argv:
        print("Using websockets")

        import tornado.ioloop
        from agent.websocket import wrap
        wsgi_app, application = wrap(app, '/api_ws', debug=False)
        application.listen(8000)
        tornado.ioloop.IOLoop.instance().start()
    else:
        app.run(port=8000, debug=True)
