"""
Flask Blueprint to handle RESTful conda-js API calls.
"""
import json
import flask

from . import common

try:
    import urllib.parse as urllib
except ImportError:
    import urllib

def parse(subcommand, flags, positional=None):
    if positional is None:
        if 'q' in flags:
            positional = flags['q']
            del flags['q']
        else:
            positional = []
    return common.parse(subcommand, flags, positional)

conda_js = flask.Blueprint('conda_js', __name__)

def get_flags():
    if flask.request.method == 'GET':
        flags = flask.request.args.copy()
    else:
        flags = json.loads(flask.request.data.decode('utf-8'))
    result = {}
    for key, value in flags.items():
        if key.endswith('[]'):
            key = key[:-2]
            if key not in result:
                result[key] = []
            result[key].append(value)
        else:
            result[key] = value
    return result

@conda_js.route('/env/prefix/<prefix>',
                methods=['GET', 'POST', 'DELETE'])
@conda_js.route('/env/name/<name>',
                methods=['GET', 'POST', 'DELETE'])
@conda_js.route('/env/prefix/<prefix>/<package>',
                methods=['POST', 'PUT', 'DELETE'])
@conda_js.route('/env/name/<name>/<package>',
                methods=['POST', 'PUT', 'DELETE'])
def api_env(prefix=None, name=None, package=None):
    flags = get_flags()
    if prefix:
        flags['prefix'] = urllib.unquote(prefix)
    elif name:
        flags['name'] = name

    subcommand = ''
    positional = []

    if package:
        subcommand = {
            'POST': 'install',
            'PUT': 'update',
            'DELETE': 'remove'
        }[flask.request.method]
        positional = [package]
    else:
        subcommand = {
            'POST': 'create',
            'GET': 'list',
            'DELETE': 'remove'
        }[flask.request.method]
        if 'q' in flags:
            positional = flags['q']
            del flags['q']

    cmdList = parse(subcommand, flags, positional)
    return common.run(cmdList)

@conda_js.route('/env/prefix/<prefix>/<package>/run')
@conda_js.route('/env/name/<name>/<package>/run')
def api_run(package, prefix=None, name=None):
    flags = get_flags()
    if prefix:
        flags['prefix'] = urllib.unquote(prefix)
    elif name:
        flags['name'] = name

    cmdList = parse('run', flags, [package])
    return common.run(cmdList)

@conda_js.route('/config',
                methods=['GET'])
@conda_js.route('/config/<key>',
                methods=['GET', 'PUT', 'DELETE'])
@conda_js.route('/config/<key>/<value>',
                methods=['PUT', 'DELETE'])
def api_config(key=None, value=None):
    flags = get_flags()

    if not (key or value):
        flags['get'] = True
    elif key and not value:
        if flask.request.method == 'GET':
            flags['get'] = key
        elif flask.request.method == 'PUT':
            flags['set'] = [key, flags['value']]
            del flags['value']
        elif flask.request.method == 'DELETE':
            flags['removeKey'] = key
    elif key and value:
        if flask.request.method == 'PUT':
            flags['add'] = [key, value]
        elif flask.request.method == 'DELETE':
            flags['remove'] = [key, value]

    cmdList = parse('config', flags)
    return common.run(cmdList)

@conda_js.route('/<subcommand>',
                methods=['GET', 'POST', 'PUT', 'DELETE'])
def api_subcommand(subcommand):
    flags = get_flags()
    cmdList = parse(subcommand, flags)
    return common.run(cmdList)
