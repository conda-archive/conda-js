var express = require('express');
var bodyParser = require('body-parser');
var http = require('http');
var app = express();
var sockjs = require('sockjs');
var conda = require('./conda');

process.argv = [];
console.log('running as server');

app.use(bodyParser.json());
app.get('/', function(req, res) {
    res.sendfile(__dirname + '/test.html');
});
app.get('/conda.js', function(req, res) {
    res.sendfile(__dirname + '/conda.js');
});
app.get('/test.browser.js', function(req, res) {
    res.sendfile(__dirname + '/test.browser.js');
});
app.get('/mocha.js', function(req, res) {
    res.sendfile(__dirname + '/node_modules/mocha/mocha.js');
});
app.get('/mocha.css', function(req, res) {
    res.sendfile(__dirname + '/node_modules/mocha/mocha.css');
});

var __handle = function(subcommand, flags) {
    var positional = [];
    if (typeof flags.positional !== "undefined") {
        positional = flags.positional;
        delete flags.positional;
    }

    console.log('Handling', subcommand, flags, positional);
    return conda.api(subcommand, flags, positional);
};
app.get('/api/:subcommand', function(req, res) {
    __handle(req.params.subcommand, req.query).then(function(data) {
        res.send(JSON.stringify(data));
    });
});
app.post('/api/:subcommand', function(req, res) {
    __handle(req.params.subcommand, req.body).then(function(data) {
        res.send(JSON.stringify(data));
    });
});

var sockjs_server = sockjs.createServer({ sockjs_url: 'http://cdn.sockjs.org/sockjs-0.3.js' });

sockjs_server.on('connection', function(socket) {
    console.log('connected');
    socket.on('data', function(data) {
        data = JSON.parse(data);
        var subcommand = data.subcommand;
        var flags = data.flags;
        var positional = data.positional;

        console.log('Handling progress', subcommand, flags, positional);
        var progress = conda.progressApi(subcommand, flags, positional);
        progress.progress(function(progress) {
            socket.write(JSON.stringify({ 'progress': progress }));
        });
        progress.done(function(data) {
            socket.write(JSON.stringify({ 'progress': data }));
            socket.close();
        });
    });
});

var server = http.Server(app);
sockjs_server.installHandlers(server, { prefix: '/api_ws' });
server.listen(8000);
