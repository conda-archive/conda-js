# conda-agent

Flask Blueprints that implement a server supporting `conda-js` API calls.

Both RPC and REST are supported.

## Usage

Without progress bar support (through WebSockets):

    app = Flask(...)
    ...
    from agent.rest import conda_js
    conda_js.url_prefix = '/api'
    app.register_blueprint(conda_js)
    ...
    app.run(...)

With progress bar support:

    from agent.rest import conda_js
    from agent.websocket import wrap
    import tornado.ioloop

    app = Flask(...)
    ...
    
    conda_js.url_prefix = '/api'
    app.register_blueprint(conda_js)
    ...
    wsgi_app, application = wrap(app, '/api_ws', debug=False)
    application.listen(PORT)
    tornado.ioloop.IOLoop.instance().start()

You can even register both blueprints under different URL prefixes.

## TODOs

Both:

- Backbone interop methods (Models, Collections, etc.) (`conda.backbone.js`?)

REST:

- `/api/pkgs`
- Test with Backbone

RPC:
