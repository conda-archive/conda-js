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

    // if (process.argv.length == 3 && process.argv[2] == '--server') {
    //     var express = require('express');
    //     var app = express();
    //     process.argv = [];
    //     console.log('running as server')

    //     var _url = null;
    //     var intercept = function(cmdList, method, url, data) {
    //         console.log('Setting up /api/' + url.join('/'));
    //         _url = '/api/' + url.join('/');
    //     };

    //     var intercepted = factory(intercept);
    //     var normal = factory(api);
    //     for (var name in intercepted) {
    //         var thing = intercepted[name];
    //         if (typeof thing === 'function') {
    //             thing();
    //             (function(url, name) {
    //                 app.get(url, function(req, res) {
    //                     normal[name]().then(function(data) {
    //                         res.send(data);
    //                     });
    //                 });
    //             })(_url, name);
    //         }
    //     }

    //     var fs = require('fs');
    //     app.get('/', function(req, res) {
    //         res.sendfile(__dirname + '/test.html');
    //     });
    //     app.get('/conda.js', function(req, res) {
    //         res.sendfile(__dirname + '/conda.js');
    //     });
    //     app.listen(8000);
    // }

    module.exports = factory(api);
}
else {
    // We are in the browser
    var api = function(cmdList, method, url, data) {
        return Promise.resolve($.ajax({
            data: JSON.stringify(data),
            dataType: 'json',
            type: method,
            url: window.conda.API_ROOT + url.join('/')
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
            return api(['list', '--prefix', this.prefix],
                       'get', ['envs', this.name, 'linked']);
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
                    var name = prefix.split('/'); // Windows?
                    name = name[name.length - 1];
                    envs.push(new Env(name, prefix));
                }
                return envs;
            });
        };
        return Env;
    })();

    var Package = (function() {
        function Package() {
        }

        return Package;
    });

    var info = function() {
        return api(['info'], 'get', ['info']);
    };

    return {
        info: info,
        Env: Env,
        API_ROOT: '/api/'
    };
}
