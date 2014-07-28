# conda-js

A library to interact with `conda` from both the browser and Node.js

## Usage as a Library

From Node.js:

    $ npm install

Then, in your code, use

    conda = require('conda');

From the browser, include the Promise polyfill

    <script src="https://www.promisejs.org/polyfills/promise-4.0.0.js"></script>

as well as jQuery and the SockJS client library, and then include `conda.js`.


In your code use Conda like so:

    conda.info().then(function(info) {
        // Do something with info
    });

The library is structured asynchronously. Under Node.js `conda-js` calls
Conda as a subprocess with the `--json` option. In the browser, `conda-js`
makes a request to the server, which should use the subprocess as well.

### Usage with Backbone

`conda-js` includes helpers for interacting with Backbone. Currently the
only helper is for syncing environment data into a Backbone Collection:

```coffee
class Environment extends Backbone.Model
  sync: conda.Env.backboneSync  # necessary for model.destroy()

class Environments extends Backbone.Collection
  model: Environment
  sync: conda.Env.backboneSync  # necessary for collection.fetch()
```

Only `Collection.fetch` and `Model.destroy` are supported.

### Usage under Atom Shell/node-webkit

`conda-js` can be used as a Node library under Atom Shell and
node-webkit. The procedure is the same as for Node.js from the renderer
side. From the client side, the library expects `window.nodeRequire` to be
the `require` function (the reason being that some client side libraries
redefine `require`). Under Atom Shell, it should be required using
`nodeRequire('conda')` and not through the `remote` library (its IPC is
incomplete and will break the library).

## Contexts

To control the method `conda-js` uses to make its requests and where it
makes its requests, set `API_METHOD` and `API_ROOT`. `API_METHOD` should be
either `"RPC"` (default) or `"REST"`. `API_ROOT` should be the base URL of
the API routes (e.g. `/api` or `http://remote-server.com/conda/api`).

Applications interacting with multiple Conda installations need to configure
`conda.API_ROOT` and `conda.API_METHOD` accordingly. However, these are
globals and configuring them for one installation will interfere with
operations on others. Thus, `conda-js` contains a function
`conda.newContext` that creates a new `conda` library object with its own
globals. Create one for each configuration. This method is only available
in a browser-like context (browser, Node-Webkit, or Atom Shell).

Example:

```javascript
// ... define test functions
var conda = window.nodeRequire('conda');
conda.API_METHOD = 'RPC';
conda.API_ROOT = 'http://localhost:8000/api';

var context = conda.newContext();
context.API_METHOD = 'REST';
context.API_ROOT = 'http://localhost:8001/api';

test(conda);
test(context);
```

## Testing and Development Server

To make the library easier to debug, it comes with its own server. Simply
run

    $ node devserver.js

and visit [http://localhost:8000](http://localhost:8000). Open the
JavaScript console and begin using `conda-js`. If you wish to run tests for
the AJAX part of the library as well, run

    $ npm run-script pretest

before starting the dev server; then mocha will begin running tests upon
visiting localhost.

The Python test server can be used as well:

    $ python test.py

Try

    $ python test.py --help

for more options. You may want to start both

    $ python test.py
    $ python test.py --rest --port=8001 --cross-origin

to run the tests for contexts (the test script will run all the tests again,
but using REST mode against `localhost:8001` instead of `localhost:8000`).

To test the Node.js part of the library, run

    $ npm run-script test
