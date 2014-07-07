// Set up module to run in browser and in Node.js
// Based loosely on https://github.com/umdjs/umd/blob/master/nodeAdapter.js
if (typeof module === 'object' && typeof define !== 'function') {
    // We are in Node.js

    var ChildProcess = require('child_process');
    var Promise = require('promise');

    var api = function(cmdList, method, url, data) {
        return new Promise(function(fulfill, reject) {
            var params = cmdList.concat(['--json']);
            console.log('Running', params)
            var conda = ChildProcess.spawn('conda', params, {});
            var buffer = [];
            conda.stdout.on('data', function(data) {
                buffer.push(data);
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

    if (process.argv.length == 3 && process.argv[2] == '--server') {
        var express = require('express');
        var app = express();
        process.argv = [];
        console.log('running as server')

        var fs = require('fs');
        app.get('/', function(req, res) {
            res.sendfile(__dirname + '/test.html');
        });
        app.get('/conda.js', function(req, res) {
            res.sendfile(__dirname + '/conda.js');
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
        app.listen(8000);
    }

    module.exports = factory(api);
}
else {
    // We are in the browser
    var api = function(cmdList, method, url) {
        var parts = url;
        if (window.conda.DEV_SERVER) {
            parts = cmdList;
        }

        var path = parts.map(encodeURIComponent).join('/');
        return Promise.resolve($.ajax({
            dataType: 'json',
            type: method,
            url: window.conda.API_ROOT + path
        }));
    };

    window.conda = factory(api);
}

function factory(api) {
    var Env = (function() {
        function Env(name, prefix) {
            this.name = name;
            this.prefix = prefix;
        }

        Env.prototype.linked = function() {
            return api(['list', '--prefix', this.prefix], 'get', ['envs', this.name, 'linked']).then(function(fns) {
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

        Env.prototype.install = function(pkg) {
            return api(['install', '--prefix', this.prefix, pkg],
                       'get', ['envs', this.name, 'install', pkg]);
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

    return {
        info: info,
        Env: Env,
        Package: Package,
        API_ROOT: '/api/',
        DEV_SERVER: false
    };
}
