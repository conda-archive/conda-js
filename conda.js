// Set up module to run in browser and in Node.js
// Based loosely on https://github.com/umdjs/umd/blob/master/nodeAdapter.js
if ((typeof module === 'object' && typeof define !== 'function') || window.atomRequire) {
    // We are in Node.js or atom

    if (window.atomRequire) {
        var require = window.atomRequire;
    }

    var ChildProcess = require('child_process');
    var Promise = require('promise');

    var api = function(cmdList, method, url, data) {
        return new Promise(function(fulfill, reject) {
            var params = cmdList.concat(['--json']);
            var conda = ChildProcess.spawn('conda', params, {});
            var buffer = [];
            conda.stdout.on('data', function(data) {
                buffer.push(data.toString());
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

    if (process.argv.length == 3 && process.argv[2] == '--server') {
        var express = require('express');
        var app = express();
        var http = require('http').Server(app);
        var io = require('socket.io')(http);

        process.argv = [];
        console.log('running as server')

        var fs = require('fs');
        app.get('/', function(req, res) {
            res.sendfile(__dirname + '/test.html');
        });
        app.get('/conda.js', function(req, res) {
            res.sendfile(__dirname + '/conda.js');
        });
        app.get('/test.js', function(req, res) {
            res.sendfile(__dirname + '/test.js');
        });
        app.get('/api/*', function(req, res) {
            var path = req.path.slice(5);
            var parts = path.split('/');
            parts = parts.map(decodeURIComponent);
            console.log('Handling', parts);
            api(parts).then(function(data) {
                res.send(JSON.stringify(data));
            });
        });

        io.on('connection', function(socket) {
            console.log('connected')
            socket.on('api', function(data) {
                var path = data.path;
                var parts = path.split('/').map(decodeURIComponent);

                var progress = progressApi(parts)
                progress.onProgress(function(progress) {
                    socket.emit('progress', progress);
                });
                progress.done(function(data) {
                    socket.emit('result', data);
                });
            })
        });

        http.listen(8000);
    }

    module.exports = factory(api, progressApi);
}
else {
    // We are in the browser
    var parse = function(cmdList, url, data) {
        var parts = url;
        if (window.conda.DEV_SERVER) {
            parts = cmdList;
        }

        if (typeof data === "undefined") {
            data = {};
        }

        var path = parts.map(encodeURIComponent).join('/');
        return {
            data: data,
            path: path
        }
    };

    var api = function(cmdList, method, url, data) {
        var path = parse(cmdList, url, data);
        return Promise.resolve($.ajax({
            data: path.data,
            dataType: 'json',
            type: method,
            url: window.conda.API_ROOT + path.path
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
                console.log(progress)
                promise.onProgress(progress);
            });
            socket.on('result', function(result) {
                console.log(result)
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
    var Env = (function() {
        function Env(name, prefix) {
            this.name = name;
            this.prefix = prefix;

            this.isDefault = false;
            this.isRoot = false;
        }

        Env.prototype.linked = function(simple) {
            if (typeof simple === "undefined") {
                simple = false;
            }
            var cmdList = ['list', '--prefix', this.prefix];
            var path = ['envs', this.name, 'linked'];
            return api(cmdList, 'get', path).then(function(fns) {
                if (simple) {
                    return fns;
                }
                var promises = [];
                for (var i = 0; i < fns.length; i++) {
                    promises.push(Package.load(fns[i]));
                }

                return Promise.all(promises).then(function(pkgs) {
                    return pkgs;
                })
            });
        };

        Env.prototype.revisions = function() {
            return api(['list', '--prefix', this.prefix, '--revisions'],
                       'get', ['envs', this.name, 'revisions']);
        };

        Env.prototype.install = function(pkg, options) {
            if (typeof options === "undefined") {
                options = { progress: false };
            }
            if (typeof options.progress === "undefined") {
                options.progress = false;
            }

            var cmdList = ['install', '--prefix', this.prefix, pkg];
            var path = ['envs', this.name, 'install', pkg];
            var data = {};
            if (!options.progress) {
                cmdList.push('--quiet');
                data.quiet = true;

                return api(cmdList, 'get', path, data);
            }
            else {
                return progressApi(cmdList, path, data);
            }
        };

        Env.prototype.remove = function(pkg) {
            return api(['remove', '--prefix', this.prefix, pkg],
                       'get', ['envs', this.name, 'install', pkg]);
        };

        Env.create = function(name) {
        };

        Env.getEnvs = function() {
            return info().then(function(info) {
                var envs = [new Env('root', info['default_prefix'])];
                var prefixes = info['envs'];
                for (var i = 0; i < prefixes.length; i++) {
                    var prefix = prefixes[i];
                    var name = prefix.split('/'); // TODO Windows?
                    name = name[name.length - 1];
                    envs.push(new Env(name, prefix));
                }

                // envs.each(function(env) {
                //     env.isDefault = env.prefix == info['default_prefix'];
                //     env.isRoot = env.prefix == info['root_prefix'];
                // });
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
            return api(['info', fn + '.tar.bz2'], 'get', ['info', fn + '.tar.bz2']).then(function(info) {
                info = info[fn + '.tar.bz2'];
                var pkg = new Package(fn, info);
                return pkg;
            });
        };

        return Package;
    })();

    var info = function() {
        return api(['info'], 'get', ['info']);
    };

    var search = function(regex) {
        var cmdList = ['search'];
        if (typeof regex !== 'undefined' && regex !== null) {
            cmdList.push(regex);
        }
        return api(cmdList, 'get', cmdList);
    };

    var launch = function(command) {
        return api(['launch', command], 'get', ['launch', command]);
    };

    return {
        info: info,
        launch: launch,
        search: search,
        Env: Env,
        Package: Package,
        API_ROOT: '/api/',
        DEV_SERVER: false
    };
}
