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

    @app.route('/<fname>')
    def file(fname):
        return open(fname).read()

    @app.route('/')
    def index():
        return flask.render_template('test.html')

    print("Using method", method)

    blueprint.conda_js.url_prefix = '/api'
    app.register_blueprint(blueprint.conda_js)

    app.run(port=8000, debug=True)
