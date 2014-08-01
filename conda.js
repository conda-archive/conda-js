/**
 * A Promise (similar to a jQuery `Deferred`) is used to represent an
 * asynchronous operation.
 *
 * `conda-js` only rejects Promises if there was an error parsing the JSON
 * from Conda. Else, the Promise will be fulfilled with the error object.
 *
 * @external Promise
 */

/**
 * Helper function that patches a Promise object with methods to register
 * callbacks for progress support.
 *
 * These methods will exist on any {@link external:Promise} that comes from
 * a method called with `progress: true`.
 *
 * @private
 */
var __makeProgressPromise = function(promise) {
    var callbacks = [];

    /**
     * Adds a callback to be called when progress info is received.
     *
     * @memberof! external:Promise#
     */
    promise.progress = function(f) {
        callbacks.push(f);
        return this;
    };

    /**
     * Fires the progress event.
     *
     * @memberof! external:Promise
     * @private
     */
    promise.onProgress = function(data) {
        callbacks.forEach(function(f) { f(data); });
    };

    var fixThen = function(promise) {
        if (typeof Promise.prototype.then === "undefined") {
            var oldThen = promise.then;
        }
        else {
            var oldThen = Promise.prototype.then.bind(promise);
        }
        promise.then = function(f, g) {
            var result = oldThen(f, g);
            result.progress = promise.progress.bind(result);
            fixThen(result);
            return result;
        };
    };

    fixThen(promise);

    return promise;
};


// Browser API
function apiContext() {
    var __parse = function(flags, positional) {
        if (typeof flags === "undefined") {
            flags = {};
        }
        if (typeof positional === "undefined") {
            positional = [];
        }

        var data = flags;
        data.positional = positional;

        return data;
    }

    var rpcApi = function(command, data) {
        // URL structure: /api/command
        // Flags are GET query string or POST body
        // Positional is in query string or POST body

        // Translation of JS flag camelCase to command line flag
        // dashed-version occurs server-side

        var method = 'post';
        if (['info', 'list', 'search'].indexOf(command) !== -1 ||
            command === 'config' && data.get) {
            method = 'get';
        }

        var contentType = '';
        if (method === 'post') {
            contentType = 'application/json';
            data = JSON.stringify(data);
        }

        return Promise.resolve($.ajax({
            contentType: contentType,
            data: data,
            dataType: 'json',
            type: method,
            url: context.conda.API_ROOT + "/" + command
        }));
    };

    var restApi = function(command, data) {
        // URL structure is same as RPC API, except commands involving an
        // environment are structured more RESTfully - additionally, we use
        // GET/POST/PUT/DELETE based on the subcommand.
        // Commands involving --name and --prefix are translated to
        // /api/env/name/<name>/subcommand<? other args>
        var url = '';

        if (typeof data.name !== "undefined") {
            url += '/env/name/' + encodeURIComponent(data.name);
        }
        else if (typeof data.prefix !== "undefined") {
            // Double-encode so URL routers aren't confused by slashes if
            // they decode before routing
            url += '/env/prefix/' + encodeURIComponent(encodeURIComponent(data.prefix));
        }

        delete data['name'];
        delete data['prefix'];

        if (['install', 'update', 'remove'].indexOf(command) > -1) {
            if (data.positional.length > 1) {
                throw new context.conda.CondaError('conda: REST API supports only manipulating one package at a time');
            }
            if (data.positional.length === 1) {
                url += '/' + data.positional[0];
            }
            data.positional = [];
        }
        else if (command === 'run' && url.slice(0, 4) === '/env') {
            url += '/' + data.positional[0] + '/run';
            data.positional = [];
        }
        else if (command === 'create' || command === 'list') {
            // Ignore these - don't append the command to the URL
        }
        else {
            url += '/' + command;
        }

        var method = {
            'install': 'post',
            'create': 'post',
            'update': 'put',
            'remove': 'delete'
        }[command];
        if (typeof method === "undefined") {
            method = 'get';
        }

        if (command === 'config') {
            if (typeof data.add !== "undefined") {
                method = 'put';
                url += '/' + data.add[0] + '/' + data.add[1];
            }
            else if (typeof data.set !== "undefined") {
                method = 'put';
                data.value = data.set[1];
                url += '/' + data.set[0];
            }
            else if (typeof data.remove !== "undefined") {
                method = 'delete';
                url += '/' + data.remove[0] + '/' + data.remove[1];
            }
            else if (typeof data.removeKey !== "undefined") {
                method = 'delete';
                url += '/' + data.removeKey;
            }
            else if (typeof data.get !== "undefined" && data.get !== true) {
                url += '/' + data.get;
            }
            delete data['get'];
            delete data['add'];
            delete data['set'];
            delete data['remove'];
            delete data['removeKey'];
        }

        if (typeof data.positional !== "undefined" && data.positional.length > 0) {
            data.q = data.positional;
        }
        delete data.positional;

        if (method !== 'get') {
            data = JSON.stringify(data);
        }
        return Promise.resolve($.ajax({
            contentType: 'application/json',
            data: data,
            dataType: 'json',
            type: method,
            url: context.conda.API_ROOT + url
        }));
    };

    var api = function(command, flags, positional) {
        var data = __parse(flags, positional);

        if (flags && typeof flags.quiet !== "undefined" && flags.quiet === false) {
            // Handle progress bars
            return progressApi(command, flags, positional);
        }

        if (context.conda.API_METHOD === "RPC") {
            return rpcApi(command, data);
        }
        else if (context.conda.API_METHOD === "REST") {
            return restApi(command, data);
        }
        else {
            throw new context.conda.CondaError("conda: Unrecognized API_METHOD " + context.conda.API_METHOD);
        }
    };
    var context = api;

    // Returns Promise like api(), but this object has additional callbacks
    // for progress bars. Retrieves data via websocket.
    var progressApi = function(command, flags, positional) {
        var promise = new Promise(function(fulfill, reject) {
            var data = __parse(flags, positional);
            positional = data.positional;
            delete data.positional;

            var socket = new SockJS(context.conda.API_ROOT + '_ws/');
            socket.onopen = function() {
                socket.send(JSON.stringify({
                    subcommand: command,
                    flags: data,
                    positional: positional
                }));
            };
            socket.onmessage = function(e) {
                var data = JSON.parse(e.data);
                if (typeof data.progress !== "undefined") {
                    promise.onProgress(data.progress);
                }
                else if (typeof data.finished !== "undefined") {
                    fulfill(data.finished);
                }
            };
        });

        return __makeProgressPromise(promise);
    };

    return api;
}

/**
   Creates a new `conda-js` context.

   A context is a copy of the `conda-js` library with its own globals,
   intended to let a single app communicate with multiple remote servers
   with different configurations.

   @memberof conda
 */
var newContext = function() {
    var api = apiContext();
    var conda = factory(api);
    api.conda = conda;
    return conda;
};

// Set up module to run in browser and in Node.js
// Based loosely on https://github.com/umdjs/umd/blob/master/nodeAdapter.js
if ((typeof module === 'object' && typeof define !== 'function') || (window && window.nodeRequire)) {
    // We are in Node.js or Node-webkit/Atom Shell

    // We don't want to redefine require - in the browser it confuses AMD
    // apps and in Node it confuses browserify.
    if (typeof window !== "undefined" && window.nodeRequire) {
        var ChildProcess = window.nodeRequire('child_process');
        // We assume the Promise polyfill has been included.
        var Promise = window.Promise;
    }
    else {
        var ChildProcess = require('child_process');
        var Promise = require('promise');
    }

    // converts a name like useIndexCache to --use-index-cache
    var __convert = function(f) {
        return "--" + f.replace(/([A-Z])/g, function(a, b) { return "-" + b.toLocaleLowerCase(); });
    };

    var __parse = function(command, flags, positional) {
        if (typeof flags === "undefined") { flags = {}; }
        if (typeof positional === "undefined") { positional = []; }

        var cmdList = [command];

        for (var key in flags) {
            if (flags.hasOwnProperty(key)) {
                var value = flags[key];
                if (value !== false && value !== null) {
                    cmdList.push(__convert(key));

                    if (Array.isArray(value)) {
                        cmdList = cmdList.concat(value);
                    }
                    else if (value !== true) {
                        cmdList.push(value);
                    }
                }
            }
        }

        cmdList = cmdList.concat(positional);
        cmdList.push('--json');

        return cmdList;
    }

    var __spawn = function(cmdList) {
        var conda = ChildProcess.spawn('conda', cmdList, { env: process.env });
        conda.stdout.setEncoding('utf8');
        return conda;
    };

    var api = function(command, flags, positional) {
        var cmdList = __parse(command, flags, positional);

        if (flags && typeof flags.quiet !== "undefined" && flags.quiet === false) {
            // Handle progress bars
            return progressApi(command, flags, positional);
        }

        var promise = new Promise(function(fulfill, reject) {
            try {
                var conda = __spawn(cmdList);
            }
            catch (ex) {
                reject({
                    'exception': ex
                });
                return;
            }

            var buffer = [];
            conda.stdout.on('data', function(data) {
                buffer.push(data);
            });

            conda.on('close', function() {
                try {
                    fulfill(JSON.parse(buffer.join('')));
                }
                catch (ex) {
                    reject({
                        'exception': ex,
                        'result': buffer.join('')
                    });
                }
            });
        });
        return promise;
    };

    // Returns Promise like api(), but this object has additional callbacks
    // for progress bars. Retrieves data via ChildProcess.
    var progressApi = function(command, flags, positional) {
        var cmdList = __parse(command, flags, positional);
        var promise = new Promise(function(fulfill, reject) {
            try {
                var conda = __spawn(cmdList);
            }
            catch (ex) {
                reject({
                    'exception': ex
                });
                return;
            }

            var progressing = true;
            var buffer = [];
            conda.stdout.on('data', function(data) {
                var rest = data;
                if (rest.indexOf('\0') == -1) {
                    progressing = false;
                }
                else {
                    // Handles multiple progress bars (e.g. fetch then install)
                    progressing = true;
                }

                if (!progressing) {
                    buffer.push(data);
                    return;
                }
                while (rest.indexOf('\0') > -1 && progressing) {
                    var dataEnd = rest.indexOf('\0');
                    var first = rest.slice(0, dataEnd);
                    rest = rest.slice(dataEnd + 1);
                    buffer.push(first);
                    try {
                        var json = JSON.parse(buffer.join(''));
                        buffer = [];
                        promise.onProgress(json);
                    }
                    catch(ex) {
                        console.log(ex)
                    }

                    if (json.finished === true && rest.indexOf('\0') === -1) {
                        progressing = false;
                    }
                }
                if (rest) {
                    buffer.push(rest);
                }
            });

            conda.on('close', function() {
                try {
                    fulfill(JSON.parse(buffer.join('')));
                }
                catch(ex) {
                    reject({
                        'exception': ex,
                        'result': buffer.join('')
                    });
                }
            });
        });
        return __makeProgressPromise(promise);
    };

    if (typeof window !== "undefined" && typeof window.nodeRequire !== "undefined") {
        window.conda = factory(api);
        window.conda.api = api;
        window.conda.progressApi = api;
        // For node-webkit/Atom Shell we provide the browser API as well, as
        // these environments are a mix of Node and browser
        window.conda.newContext = newContext;
    }
    if (typeof module !== "undefined" && typeof module.exports !== "undefined") {
        module.exports = factory(api);
        module.exports.api = api;
        module.exports.progressApi = progressApi;
    }
}
else {
    // We are in the browser
    /**
     * `conda-js` methods generally take an options object and return a
     * {@link external:Promise}. The options each method takes are the same
     * as its command-line counterpart, simply covert to camelCase. For
     * instance, `--use-index-cache` becomes `{ useIndexCache: true }`.
     *
     * If you want progress information, pass `{ progress: true }` and use
     * {@link external:Promise#progress}.
     *
     * @namespace conda
     */
    window.conda = newContext();
    window.conda.newContext = newContext;
}

function factory(api) {
    "use strict";

    /**
     * Make a call to the Conda API. Only available in Node.js.
     *
     * @function api
     * @inner
     * @memberof conda
     * @param {string} command - the Conda subcommand to run.
     * @param {Object} flags - the switches to pass to Conda.
     * @param {string[]} [positional] - positional arguments to pass to Conda.
     */

    // TODO make this context-dependent
    var PATH_SEP = '/';
    if (typeof process !== "undefined") {
        if (process.platform === 'win32') {
            PATH_SEP = '\\';
        }
    }
    else if (typeof navigator !== "undefined") {
        if (/windows/.test(navigator.userAgent.toLowerCase())) {
            PATH_SEP = '\\';
        }
    }

    var defaultOptions = function(options, defaults) {
        if (typeof options === "undefined" || options === null) {
            return defaults;
        }
        for (var key in defaults) {
            if (defaults.hasOwnProperty(key)) {
                if (typeof options[key] === "undefined") {
                    options[key] = defaults[key];
                }
            }
        }

        return options;
    };

    var nameOrPrefixOptions = function(name, options, defaults) {
        defaults.name = null;
        defaults.prefix = null;

        options = defaultOptions(options, defaults);
        if (!(options.name || options.prefix)) {
            throw new CondaError(name + ": either name or prefix required");
        }
        if (options.name && options.prefix) {
            throw new CondaError(name + ": exactly one of name or prefix allowed");
        }

        return options;
    };

    /**
     * Exception type used by conda-js.
     *
     * @memberof conda
     */
    var CondaError = (function() {
        function CondaError(message) {
            this.message = message;
        }

        CondaError.prototype = new Error;
        CondaError.prototype.constructor = CondaError;

        CondaError.prototype.toString = function() {
            return "CondaError: " + this.message;
        };

        return CondaError;
    })();

    /**
     * A Conda environment.
     *
     * This object is a thin wrapper that by default contains only the name
     * and prefix of the environment, as well as methods to manipulate the
     * environment. Generally this should not be instantiated directly.
     *
     * @class Env
     */
    var Env = (function() {
        /**
           @constructor
        */
        function Env(name, prefix) {
            this.name = name;
            this.prefix = prefix;

            this.is_default = false;
            this.is_root = false;

            this.installed = {};
            this.history = [];
        }

        /**
         * List all linked packages in the environment.
         *
         * @memberof Env
        */
        Env.prototype.linked = function(options) {
            options = defaultOptions(options, { simple: false });

            return api('list', { prefix: this.prefix }).then(function(fns) {
                if (options.simple) {
                    return fns;
                }

                var promises = [];
                for (var i = 0; i < fns.length; i++) {
                    promises.push(Package.load(fns[i]));
                }
                return Promise.all(promises).then(function(pkgs) {
                    this.installed = {};
                    pkgs.forEach(function(pkg) {
                        this.installed[pkg.name] = pkg;
                    }.bind(this));
                    return pkgs;
                }.bind(this));
            }.bind(this));
        };

        /**
         * Get a list of revisions of this environment.
         *
         * @memberof Env
        */
        Env.prototype.revisions = function() {
            return api('list', { prefix: this.prefix, revisions: true })
                .then(function(revisions) {
                    this.history = revisions;
                    return revisions;
                }.bind(this));
        };

        /**
         * Install packages in this environment (or revert to a revision).
         *
         * @memberof Env
        */
        Env.prototype.install = function(options) {
            options = defaultOptions(options, {
                progress: false,
                packages: []
            });

            if (options.packages.length === 0 && typeof options.revision === "undefined") {
                throw new CondaError("Env.install: must specify at least one package, or a revision");
            }

            var packages = options.packages;
            delete options.packages;

            options.quiet = !options.progress;
            delete options.progress;
            options.prefix = this.prefix;

            return api('install', options, packages);
        };

        /**
         * Update packages in this environment.
         *
         * @memberof Env
        */
        Env.prototype.update = function(options) {
            options = defaultOptions(options, {
                packages: [],
                dryRun: false,
                unknown: false,
                noDeps: false,
                useIndexCache: false,
                useLocal: false,
                noPin: false,
                all: false,
                progress: false
            });

            if (options.packages.length === 0 && !options.all) {
                throw new CondaError("Env.update: must specify packages to update or all");
            }

            var packages = options.packages;
            delete options.packages;

            options.quiet = !options.progress;
            delete options.progress;
            options.prefix = this.prefix;

            return api('update', options, packages);
        };

        /**
         * Remove packages in this environment.
         *
         * @memberof Env
        */
        Env.prototype.remove = function(options) {
            options = defaultOptions(options, {
                progress: false,
                packages: []
            });

            if (options.packages.length === 0) {
                throw new CondaError("Env.remove: must specify at least one package");
            }

            var packages = options.packages;
            delete options.packages;

            options.quiet = !options.progress;
            delete options.progress;
            options.prefix = this.prefix;

            return api('remove', options, packages);
        };

        /**
         * Clone this environment.
         *
         * @memberof Env
        */
        Env.prototype.clone = function(options) {
            var options = nameOrPrefixOptions("Env.clone", options, {
                progress: false
            });

            options.clone = this.prefix;
            options.quiet = !options.progress;
            delete options.progress;

            return api('create', options).then(function(data) {
                if (typeof data.success !== "undefined" && data.success) {
                    data.env = new Env(options.name, data.actions.PREFIX);
                    return data;
                }
                else {
                    this.reject(data);
                }
            });
        };

        /**
         * Run an app installed in this environment.
         *
         * @memberof Env
        */
        Env.prototype.run = function(options) {
            var options = defaultOptions(options, {
                name: null,
                pkg: null
            });

            if (!(options.name || options.pkg)) {
                throw new CondaError("Env.run: either name or pkg needed");
            }
            if (options.name && options.pkg) {
                throw new CondaError("Env.run: exactly one of name or pkg allowed");
            }

            var pkg = options.name;
            if (options.pkg) {
                pkg = options.pkg;
            }

            return api('run', { prefix: this.prefix }, [pkg]);
        };

        /**
         * Delete this environment (`conda remove --all`).
         *
         * @memberof Env
        */
        Env.prototype.removeEnv = function(options) {
            options = defaultOptions(options, {
                progress: false,
                forcePscheck: false
            });

            return api('remove', {
                all: true,
                prefix: this.prefix,
                quiet: !options.progress,
                forcePscheck: options.forcePscheck
            });
        };

        /**
         * Create a new environment with the given packages installed.
         *
         * @static
         * @memberof Env
        */
        Env.create = function(options) {
            var options = nameOrPrefixOptions("Env.create", options, {
                progress: false,
                packages: [],
                forcePscheck: false
            });

            if (options.packages.length === 0) {
                throw new CondaError("Env.create: at least one package required");
            }

            var packages = options.packages;
            delete options.packages;
            options.quiet = !options.progress;
            delete options.progress;

            var progress = api('create', options, packages);
            var promise = progress.then(function(data) {
                if (typeof data.success !== "undefined" && data.success) {
                    data.env = new Env(options.name, data.actions.PREFIX);
                }
                return data;
            });
            return promise;
        };

        /**
         * Get all environments known to conda. This is the method you
         * should use to create Env objects.
         *
         * @static
         * @memberof Env
        */
        Env.getEnvs = function() {
            return info().then(function(info) {
                var envs = [new Env('root', info.root_prefix)];

                var prefixes = info.envs;
                for (var i = 0; i < prefixes.length; i++) {
                    var prefix = prefixes[i];
                    var name = prefix.split(PATH_SEP);
                    name = name[name.length - 1];
                    envs.push(new Env(name, prefix));
                }

                envs.forEach(function(env) {
                    env.is_default = env.prefix == info.default_prefix;
                    env.is_root = env.prefix == info.root_prefix;
                });
                return envs;
            });
        };

        /**
         * Get the root environment (assumed to be named `'root'`).
         *
         * @static
         * @memberof Env
        */
        Env.getRoot = function() {
            return info().then(function(info) {
                var root = new Env('root', info.root_prefix);
                root.isDefault = info.root_prefix == info.default_prefix;
                root.isRoot = true;

                return root;
            });
        };

        /**
         * Sync method for Backbone collections and models. Supports
         * Collection#fetch and Model#destroy.
         *
         * @static
         * @memberof Env
         */
        Env.backboneSync = function(method, model, options) {
            switch (method) {
            case "read":
                Env.getEnvs().then(function(envs) {
                    var promises = [];
                    envs.forEach(function(env) {
                        if (typeof options.loadLinked === "undefined" ||
                            options.loadLinked) {
                            promises.push(env.linked());
                        }
                        if (typeof options.loadRevisions === "undefined" ||
                            options.loadRevisions) {
                            promises.push(env.revisions());
                        }
                        env.id = env.prefix ? env.prefix : env.name;
                    });

                    Promise.all(promises).then(function() {
                        options.success(envs);
                    });
                });
                break;

            case "delete":
                var forcePscheck = false;
                if (typeof options.forcePscheck !== "undefined") {
                    forcePscheck = options.forcePscheck;
                }
                return model.attributes.removeEnv({ forcePscheck: forcePscheck }).then(function(result) {
                    options.success(result);
                });
                break;

            default:
                console.log("Env.backboneSync: cannot handle method " + method);
            }
        };

        return Env;
    })();

    /**
     * A Conda package.
     *
     * This object carries the information from the search index, and is
     * similar to Python `conda.plan.Package`. Generally this will not be
     * directly instantiated either.
     *
     * @class Package
     */
    var Package = (function() {
        var _cache = {};

        function Package(fn, info) {
            _cache[fn] = this;
            this.fn = fn;
            this.name = info.name;
            this.build = info.build;
            this.build_number = info.build_number;
            this.dist = this.fn;
            this.version = info.version;
            this.info = info;
        }

        Package.prototype.reload = function() {
            return Package.load(this.fn).then(function(pkg) {
                this.info = pkg.info;
            }.bind(this));
        };

        /**
         * Parse a filename like `python-2.7.8-0`.
         *
         * @static
         * @memberof Package
         * @returns {Object} info
         * @returns {string} info.name
         * @returns {string} info.version
         * @returns {string} info.build
         */
        Package.splitFn = function(fn) {
            var parts = fn.split('-');
            return {
                name: parts.slice(0, -2).join('-'),
                build: parts[parts.length - 1],
                version: parts[parts.length - 2]
            };
        };

        /**
         * Parse a version string into its parts.
         *
         * Matches 2.1, 2.1.3, 2.1.3a, 2.1.3a2, 2.1.4rc1, 2.1.5.2, ...
         *
         * Note: 2.1.3a == 2.1.3a0
         *
         * @static
         * @memberof Package
         * @returns {Object} version
         * @returns {number[]} version.parts - the version numbers
         * @returns {string} version.suffix - the suffix (`a`, `rc`)
         * @returns {number} version.suffixNumber - the suffix number (defaults to 0)
         */
        Package.parseVersion = function(version) {
            var matches = version.match(/^(\d+)\.(\d+)((?:\.\d+)*)([a-zA-Z]+(?:\d+)?)?$/);
            if (!matches) {
                throw new CondaError("Package.parseVersion: Cannot parse version " + version);
            }
            var parts = [parseInt(matches[1], 10), parseInt(matches[2], 10)];
            var extra = matches[3];
            if (typeof extra !== "undefined") {
                extra = extra.split(/\./g).slice(1);
                extra.forEach(function(e) {
                    parts.push(parseInt(e, 10));
                });
            }
            var suffixMatch = matches[4];
            var suffix = null;
            var suffixNumber = null;
            if (typeof suffixMatch !== "undefined") {
                var suffixParts = suffixMatch.split(/(\d+)/);
                suffix = suffixParts[0];
                suffixNumber = 0;
                if (suffixParts.length > 1) {
                    suffixNumber = parseInt(suffixParts[1], 10);
                }
            }
            return {
                parts: parts,
                suffix: suffix,
                suffixNumber: suffixNumber
            };
        };

        /**
         * Is pkg2 newer than pkg1
         *
         * @static
         * @memberof Package
         * @returns {boolean}
         */
        Package.isGreater = function(pkg1, pkg2) {
            if (pkg1.version === pkg2.version) {
                return pkg2.build_number > pkg1.build_number;
            }

            try {
                var parts1 = Package.parseVersion(pkg1.version);
                var parts2 = Package.parseVersion(pkg2.version);
            }
            catch (e) {
                return pkg2.version > pkg1.version;
            }
            for (var i = 0, len = Math.max(parts1.parts.length, parts2.parts.length);
                 i < len; i++) {
                var part1 = parts1.parts[i];
                var part2 = parts2.parts[i];
                var part1d = typeof part1 !== "undefined";
                var part2d = typeof part2 !== "undefined";

                if (part1d && !part2d) {
                    return false;
                }
                else if (!part1d && part2d) {
                    return true;
                }

                if (part2 > part1) {
                    return true;
                }
                if (part2 < part1) {
                    return false;
                }
            }

            if (parts1.suffix !== null && parts2.suffix === null) {
                return true;
            }
            else if (parts1.suffix === null && parts2.suffix !== null) {
                return false;
            }
            else if (parts1.suffix !== null && parts2.suffix !== null &&
                     parts1.suffix === parts2.suffix) {
                return parts2.suffixNumber > parts1.suffixNumber;
            }
            else {
                return parts2.suffix > parts1.suffix;
            }
        };

        /**
         * Load a package object from the package index.
         *
         * The packages returned are CACHED and MUTABLE. Make a copy if you
         * plan to mutate the object, or otherwise the changes will propagate.
         *
         * Used by {@link Env#linked}.
         *
         * @static
         * @todo It may be better not to cache package objects themselves,
         * only the index, except if we had to fall back on `conda info` to
         * get the data.
         * @memberof Package
         */
        Package.load = function(fn, reload) {
            // This can get quite expensive. To deal with that:
            // 1. Cache Package objects.
            // 2. Load data from `conda search`'s index.
            // 3. Cache that index.
            // 4. Fall back on `conda info` only if package is not in index
            // (when the package was built/installed locally, for instance)

            if (!_cache.hasOwnProperty(fn) || reload) {
                return index().then(function(search_cache) {
                    var spec = Package.splitFn(fn);
                    var packages = search_cache[spec.name];
                    if (typeof packages === "undefined") {
                        return api('info', {}, fn + '.tar.bz2').then(function(info) {
                            info = info[fn + '.tar.bz2'];
                            var pkg = new Package(fn, info);
                            return pkg;
                        });
                    }

                    var pkgInfo;
                    for (var i = 0; i < packages.length; i++) {
                        var info = packages[i];
                        if (info.build === spec.build && info.version === spec.version) {
                            pkgInfo = info;
                            break;
                        }
                    }

                    var pkg = new Package(fn, info);
                    _cache[fn] = pkg;
                    return pkg;
                });
            }
            else {
                return Promise.resolve(_cache[fn]);
            }
        };

        return Package;
    })();

    /**
     * A Conda configuration file.
     *
     * This object is a thin wrapper that by default contains either the
     * name of the config file or a flag indicating we are using the system
     * config file. If instantiated with neither, this will use whatever
     * Conda picks as the default.
     *
     * @class Config
     */
    var Config = (function() {
        var __warn_result = function(result) {
            if (result.warnings && result.warnings.length) {
                console.log("Warnings for conda config:");
                console.log(result.warnings);
            }
            return result;
        };
        var __merge = function(dest, src) {
            for (var key in src) {
                if (src.hasOwnProperty(key)) {
                    dest[key] = src[key];
                }
            }

            return dest;
        };
        var ALLOWED_KEYS = ['channels', 'disallow', 'create_default_packages',
            'track_features', 'envs_dirs', 'always_yes', 'allow_softlinks', 'changeps1',
            'use_pip', 'binstar_upload', 'binstar_personal', 'show_channel_urls',
            'allow_other_channels', 'ssl_verify'];

        var __check_keys = function(f) {
            return function() {
                var key = arguments[0];
                if (ALLOWED_KEYS.indexOf(key) === -1) {
                    throw new CondaError(
                        "Config.get: key " + key + " not allowed. Key must be one of "
                            + ALLOWED_KEYS.join(', '));
                }
                return f.apply(f, Array.prototype.slice.call(arguments));
            };
        };

        function Config(options) {
            options = defaultOptions(options, {
                system: false,
                file: null
            });
            this.system = options.system;
            this.file = options.file;
            this.options = {};

            if (options.system && options.file !== null) {
                throw new CondaError("Config: at most one of system, file allowed");
            }

            if (options.system) {
                this.options.system = true;
            }
            else if (options.file !== null) {
                this.options.file = options.file;
            }
        }

        /*
         * The path of the config file, as reported by Conda.
         *
         * @memberof Config
         */
        Config.prototype.rcPath = function() {
            var call = api('config', __merge({ get: true }, this.options));
            return call.then(function(result) {
                return result.rc_path;
            });
        };

        /*
         * Get a configuration key's value.
         *
         * @memberof! Config
         * @returns {Object} info
         * @returns info.value - undefined if not set.
         * @returns {boolean} info.set
         */
        Config.prototype.get = __check_keys(function(key) {
            var call = api('config', __merge({ get: key }, this.options));
            return call.then(__warn_result).then(function(result) {
                if (typeof result.get[key] !== "undefined") {
                    return {
                        value: result.get[key],
                        set: true
                    };
                }
                else {
                    return {
                        value: undefined,
                        set: false
                    };
                }
            });
        });

        Config.prototype.getAll = function() {
            var call = api('config', __merge({ get: true }, this.options));
            return call.then(function(result) {
                return result.get;
            });
        };

        // TODO disallow non iterable keys
        Config.prototype.add = __check_keys(function(key, value) {
            var call = api('config', __merge({ add: [key, value], force: true }, this.options));
            return call.then(__warn_result);
        });

        Config.prototype.set = __check_keys(function(key, value) {
            var call = api('config', __merge({ set: [key, value], force: true }, this.options));
            return call.then(__warn_result);
        });

        Config.prototype.remove = __check_keys(function(key, value) {
            var call = api('config', __merge({ remove: [key, value], force: true }, this.options));
            return call.then(__warn_result);
        });

        Config.prototype.removeKey = __check_keys(function(key) {
            var call = api('config', __merge({ removeKey: key, force: true }, this.options));
            return call.then(__warn_result);
        });

        return Config;
    })();

    /**
     * Get info about a Conda install - `conda info --json`.
     *
     * Unlike its command line counterpart, this accepts no parameters.
     *
     * @memberof conda
     * @function
     */
    var info = function() {
        return api('info');
    };

    /**
     * Fetch the package index - `conda search --json`.
     *
     * This is an expensive call - you should favor {@link conda.index}
     * unless you absolutely need the latest data. And even then
     * `conda.index({ reload: true })` would likely be better (as then
     * future callers will get the updated index).
     *
     * @param {Object} [options]
     * @param {string} [options.regex] - a regex to filter package names
     * @param {string} [options.spec] - a package specification to search for
     * @memberof conda
     * @function
     */
    var search = function(options) {
        options = defaultOptions(options, {
            regex: null,
            spec: null,
            useIndexCache: false,
            outdated: false,
            unknown: false
        });

        if (options.regex && options.spec) {
            throw new CondaError("conda.search: only one of regex and spec allowed");
        }

        var positional = [];

        if (options.regex !== null) {
            positional.push(options.regex);
        }
        if (options.spec !== null) {
            positional.push(options.spec);
            options.spec = true;
        }
        else {
            delete options.spec;
        }
        delete options.regex;

        return api('search', options, positional);
    };

    var _search_cache = null;
    /**
     * The package index - `conda search --json`.
     *
     * This method caches the index as it is an expensive call (1-4
     * seconds). Any parameters will be passed through.
     *
     * @param {Object} [options]
     * @param {boolean} [options.reload=false] - reload the index, instead of using the cache.
     * @memberof conda
     * @function
     */
    var index = function(options) {
        options = defaultOptions(options, {
            reload: false
        });

        if (_search_cache === null || options.reload) {
            delete options.reload;
            options.useIndexCache = !options.reload;
            _search_cache = search(options);
        }

        return _search_cache;
    };

    /**
     * `conda run --json`.
     *
     * @memberof conda
     * @function
     */
    var run = function(command) {
        return api('run', {}, [command]);
    };

    /**
     * `conda clean --json`.
     *
     * @memberof conda
     * @function
     */
    var clean = function(options) {
        options = defaultOptions(options, {
            dryRun: false,
            indexCache: false,
            lock: false,
            tarballs: false,
            packages: false
        });

        if (!(options.indexCache || options.lock ||
              options.tarballs || options.packages)) {
            throw new CondaError("conda.clean: at least one of indexCache, " +
                                 "lock, tarballs, or packages required");
        }

        return api('clean', options);
    };

    return {
        clean: clean,
        index: index,
        info: info,
        run: run,
        search: search,
        CondaError: CondaError,
        Config: Config,
        Env: Env,
        Package: Package,
        API_ROOT: '/api',
        API_METHOD: 'RPC'
    };
}
