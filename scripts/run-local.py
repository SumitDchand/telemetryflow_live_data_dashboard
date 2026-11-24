"""Load the private .env without printing values, then launch one service."""
import os
import sys
from pathlib import Path
root=Path(__file__).resolve().parents[1]
for line in (root/'.env').read_text().splitlines():
    if line.strip() and not line.startswith('#'):
        key,value=line.split('=',1)
        os.environ.setdefault(key,value)
service=sys.argv[1]
commands={'backend':['node',str(root/'backend/src/server.js')], 'ingestion':[str(root/'.venv/bin/python'),str(root/'ingestion/main.py')]}
os.execvp(commands[service][0], commands[service])
