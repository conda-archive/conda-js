# conda-agent

Flask Blueprints that implement a server supporting `conda-js` API calls.

Both RPC and REST are supported.

## Usage

    app = Flask(...)
    ...
    from agent.rest import conda_js
    conda_js.url_prefix = '/api'
    app.register_blueprint(conda_js)
    ...
    app.run(...)

## TODOs

Both:

- Progress bar API not implemented
- Backbone interop methods (Models, Collections, etc.) (`conda.backbone.js`?)

REST:

- `/api/pkgs`
- Test with Backbone

RPC:
