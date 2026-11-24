"""Run a command with .env loaded; never echo credentials."""
import os
import sys
from pathlib import Path
root=Path(__file__).resolve().parents[1]
if (root/'.env').exists():
    for line in (root/'.env').read_text().splitlines():
        if line.strip() and not line.startswith('#'):
            key,value=line.split('=',1)
            os.environ.setdefault(key,value)
os.execvp(sys.argv[1],sys.argv[1:])
