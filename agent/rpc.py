"""
Flask Blueprint to handle RPC conda-js API calls.
"""
import json
import flask

from .common import parse, run

conda_js = flask.Blueprint('conda_js', __name__)


@conda_js.route('/<subcommand>', methods=['GET', 'POST'])
def api_condajs(subcommand):
    if flask.request.method == 'GET':
        flags = flask.request.args.copy()
    else:
        flags = json.loads(flask.request.data.decode('utf-8'))

    positional = []
    if 'positional' in flags:
        positional = flags['positional']
        del flags['positional']

    cmdList = parse(subcommand, flags, positional)
    return run(cmdList)
