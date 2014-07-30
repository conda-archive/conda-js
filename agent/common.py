import re
import sys

try:
    from cStringIO import StringIO
except ImportError:
    try:
        from StringIO import StringIO
    except ImportError:
        from io import StringIO

_convert_re = re.compile('([A-Z])')
def convert(key):
    return "--" + _convert_re.sub(lambda match: '-' + match.group(0).lower(), key)

def parse(subcommand, flags, positional):
    cmdList = ['conda', subcommand, '--json']

    for key, value in flags.items():
        try:
            value = {
                'true': True,
                'false': False,
                'null': None
            }[value]
        except (KeyError, TypeError):
            pass

        if value is not False and value is not None:
            cmdList.append(convert(key))
            if isinstance(value, (list, tuple)):
                cmdList.extend(map(str, value))
            elif value is not True:
                cmdList.append(str(value))

    if isinstance(positional, str):
        cmdList.append(positional)
    else:
        cmdList.extend(positional)

    return [str(x) for x in cmdList]

def run(cmdList):
    # Avoid subprocess overhead
    # TODO: benchmark vs subprocess

    if '--dummy' in sys.argv:
        print(cmdList)
        return ''

    from conda import cli
    stdout = StringIO()
    old = sys.stdout
    sys.stdout = stdout
    sys.argv = cmdList
    try:
        cli.main()
    except SystemExit:
        pass
    sys.stdout = old
    stdout.seek(0)
    return stdout.read()
