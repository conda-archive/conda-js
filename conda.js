// Set up module to run in browser and in Node.js
// Based loosely on https://github.com/umdjs/umd/blob/master/nodeAdapter.js
if ((typeof module === 'object' && typeof define !== 'function') || (window && window.atomRequire)) {
    // We are in Node.js or atom

    if (typeof window !== "undefined" && window.atomRequire) {
        var require = window.atomRequire;
    }

    var ChildProcess = require('child_process');
    var Promise = require('promise');

    // converts a name like useIndexCache to --use-index-cache
    var __convert = function(f) {
        return "--" + f.replace(/([A-Z])/, function(a, b) { return "-" + b.toLocaleLowerCase(); });
    };

    var api = function(command, flags, positional) {
        if (typeof flags === "undefined") { flags = {}; }
        if (typeof positional === "undefined") { positional = []; }

        return new Promise(function(fulfill, reject) {
            var cmdList = [command];

            for (var key in flags) {
                if (flags.hasOwnProperty(key)) {
                    var value = flags[key];
                    if (value !== false) {
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

            try {
                var conda = ChildProcess.spawn('conda', cmdList, {});
                var buffer = [];
                conda.stdout.setEncoding('utf8');
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
            }
            catch (ex) {
                reject({
                    'exception': ex
                })
            }
        });
    };

    // Returns Promise like api(), but this object has additional callbacks
    // for progress bars. Retrieves data via ChildProcess.
    var progressApi = function(cmdList, url, data) {
        var callbacks = [];
        var progressing = true;
        var params = cmdList.concat(['--json']);
        var conda = ChildProcess.spawn('conda', params, {});
        var buffer = [];
        var promise = new Promise(function(fulfill, reject) {
            conda.stdout.on('data', function(data) {
                var rest = data.toString();
                if (rest.indexOf('\0') == -1) {
                    progressing = false;
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
                    var json = JSON.parse(buffer.join(''));
                    buffer = [];
                    promise.progress(json);

                    if (json.finished === true) {
                        progressing = false;
                    }
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
        promise.onProgress = function(f) {
            callbacks.push(f);
        };
        promise.progress = function(data) {
            for (var i = 0; i < callbacks.length; i++) {
                callbacks[i](data);
            }
        };
        return promise;
    };

    module.exports = factory(api, progressApi);
    module.exports.api = api;
}
else {
    // We are in the browser

    var api = function(command, flags, positional) {
        // URL structure: /api/command
        // Flags are GET query string or POST body
        // Positional is in query string or POST body

        // Translation of JS flag camelCase to command line flag
        // dashed-version occurs server-side

        if (typeof flags === "undefined") {
            flags = {};
        }
        if (typeof positional === "undefined") {
            positional = [];
        }

        var data = flags;
        data.positional = positional;

        return Promise.resolve($.ajax({
            data: data,
            dataType: 'json',
            type: 'get',
            url: window.conda.API_ROOT + command
        }));
    };

    // Returns Promise like api(), but this object has additional callbacks
    // for progress bars. Retrieves data via websocket.
    var progressApi = function(cmdList, url, data) {
        var callbacks = [];
        var promise = new Promise(function(fulfill, reject) {
            var path = parse(cmdList, url, data);
            var socket = io();
            socket.emit('api', path);
            socket.on('progress', function(progress) {
                console.log(progress);
                promise.onProgress(progress);
            });
            socket.on('result', function(result) {
                console.log(result);
                socket.disconnect();
                fulfill(result);
            });
        });
        promise.onProgress = function(f) {
            callbacks.push(f);
        };
        promise.progress = function(data) {
            for (var i = 0; i < callbacks.length; i++) {
                callbacks[i](data);
            }
        };
        return promise;
    };

    window.conda = factory(api, progressApi);
}

function factory(api, progressApi) {
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

    var CondaError = (function() {
        function CondaError(message) {
            this.message = message;
        }

        CondaError.prototype.toString = function() {
            return "CondaError: " + this.message;
        };

        return CondaError;
    })();

    var Env = (function() {
        function Env(name, prefix) {
            this.name = name;
            this.prefix = prefix;

            this.isDefault = false;
            this.isRoot = false;
        }

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
                    return pkgs;
                });
            });
        };

        Env.prototype.revisions = function() {
            return api('list', { prefix: this.prefix, revisions: true });
        };

        Env.prototype.install = function(options) {
            options = defaultOptions(options, {
                progress: false,
                packages: []
            });

            if (options.packages.length === 0) {
                throw new CondaError("Env.install: must specify at least one package");
            }

            var packages = options.packages;
            delete options.packages;

            options.quiet = !options.progress;
            delete options.progress;
            options.prefix = this.prefix;

            return api('install', options, packages);
        };

        Env.prototype.update = function(options) {
            options = defaultOptions(options, {
                packages: [],
                dryRun: false,
                unknown: false,
                noDeps: false,
                useIndexCache: false,
                useLocal: false,
                noPin: false,
                all: false
            });

            if (options.packages.length === 0 && !options.all) {
                throw new CondaError("Env.update: must specify packages to update or all");
            }

            var packages = options.packages;
            delete options.packages;

            options.prefix = this.prefix;

            return api('update', options, packages);
        };

        Env.prototype.remove = function(pkg) {
            return api('remove', { prefix: this.prefix }, [pkg]);
        };

        Env.prototype.clone = function(options) {
            var options = nameOrPrefixOptions("Env.clone", options, {});
            options.clone = this.prefix;

            return api('create', options);
        };

        Env.prototype.removeEnv = function() {
            return api('remove', { all: true, prefix: this.prefix });
        };

        Env.create = function(options) {
            var options = nameOrPrefixOptions("Env.create", options, {
                packages: []
            });

            var packages = options.packages;
            delete options.packages;

            if (packages.length === 0) {
                throw new CondaError("Env.create: at least one package required");
            }

            return api('create', options, packages);
        };

        Env.getEnvs = function() {
            return info().then(function(info) {
                var envs = [new Env('root', info.default_prefix)];

                var prefixes = info.envs;
                for (var i = 0; i < prefixes.length; i++) {
                    var prefix = prefixes[i];
                    var name = prefix.split('/'); // TODO Windows?
                    name = name[name.length - 1];
                    envs.push(new Env(name, prefix));
                }

                envs.forEach(function(env) {
                    env.isDefault = env.prefix == info.default_prefix;
                    env.isRoot = env.prefix == info.root_prefix;
                });
                return envs;
            });
        };
        return Env;
    })();

    var Package = (function() {
        function Package(fn, info) {
            this.fn = fn;
            this.info = info;
        }

        Package.load = function(fn) {
            return api('info', {}, fn + '.tar.bz2').then(function(info) {
                info = info[fn + '.tar.bz2'];
                var pkg = new Package(fn, info);
                return pkg;
            });
        };

        return Package;
    })();

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

        Config.prototype.rcPath = function() {
            var call = api('config', __merge({ get: true }, this.options));
            return call.then(function(result) {
                return result.rc_path;
            });
        };

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
            return call.then(_warn_result);
        });

        Config.prototype.set = __check_keys(function(key, value) {
            var call = api('config', __merge({ set: [key, value], force: true }, this.options));
            return call.then(_warn_result);
        });

        Config.prototype.remove = __check_keys(function(key, value) {
            var call = api('config', __merge({ remove: [key, value], force: true }, this.options));
            return call.then(_warn_result);
        });

        Config.prototype.removeKey = __check_keys(function(key) {
            var call = api('config', __merge({ removeKey: key, force: true }, this.options));
            return call.then(_warn_result);
        });

        return Config;
    })();

    var info = function() {
        return api('info');
    };

    var search = function(options) {
        options = defaultOptions(options, {
            regex: null,
            spec: null
        });

        if (options.regex && options.spec) {
            throw new CondaError("conda.search: only one of regex and spec allowed");
        }

        var positional = [];

        if (options.regex !== null) {
            positional.push(regex);
        }
        if (options.spec !== null) {
            positional.push(spec);
            options.spec = true;
        }
        else {
            delete options.spec;
        }
        delete options.regex;

        return api('search', options, positional);
    };

    var launch = function(command) {
        return api('launch', {}, [command]);
    };

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
        info: info,
        launch: launch,
        search: search,
        CondaError: CondaError,
        Config: Config,
        Env: Env,
        Package: Package,
        API_ROOT: '/api/'
    };
}
