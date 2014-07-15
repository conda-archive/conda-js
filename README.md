# conda-js

A library to interact with `conda` from both the browser and Node.js

## Usage as a Library

From Node.js:

    $ npm install

Then, in your code, use

    conda = require('conda');

From the browser, include the Promise polyfill

    <script src="https://www.promisejs.org/polyfills/promise-4.0.0.js"></script>

as well as jQuery, and then include `conda.js`.


In your code use Conda like so:

    conda.info().then(function(info) {
        // Do something with info
    });

The library is structured asynchronously. Under Node.js `conda-js` calls
Conda as a subprocess with the `--json` option. In the browser, `conda-js`
makes a request to the server, which should use the subprocess as well.

### Usage under Atom Shell/node-webkit

`conda-js` can be used as a Node library under Atom Shell and
node-webkit. The procedure is the same as for Node.js from the renderer
side. From the client side, the library expects `window.nodeRequire` to be
the `require` function (the reason being that some client side libraries
redefine `require`). Under Atom Shell, it should be required using
`nodeRequire('conda')` and not through the `remote` library (its IPC is
incomplete and will break the library).

## Development Server

To make the library easier to debug, it comes with its own server. Simply
run

    $ node conda.js --server

and visit [http://localhost:8000](http://localhost:8000). Open the
JavaScript console and begin using `conda-js`.
