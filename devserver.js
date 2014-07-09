var express = require('express');
var bodyParser = require('body-parser');
var app = express();
var http = require('http').Server(app);
var io = require('socket.io')(http);
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
app.get('/test.js', function(req, res) {
    res.sendfile(__dirname + '/test.js');
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

io.on('connection', function(socket) {
    console.log('connected');
    socket.on('api', function(data) {
        var subcommand = data.subcommand;
        var flags = data.flags;
        var positional = data.positional;

        console.log('Handling progress', subcommand, flags, positional);
        var progress = conda.progressApi(subcommand, flags, positional);
        progress.onProgress(function(progress) {
            socket.emit('progress', progress);
        });
        progress.done(function(data) {
            socket.emit('result', data);
            socket.disconnect();
        });
    });
    socket.on('disconnect', function(data) {
        socket.disconnect();
    });
});

io.on('disconnect', function() {
    console.log('disconnected');
});

http.listen(8000);
