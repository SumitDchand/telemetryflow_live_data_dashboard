"""Initialize an empty database. Existing schemas are deliberately left intact."""
import os
from pathlib import Path
import psycopg
with psycopg.connect(os.environ['DATABASE_URL']) as connection:
    exists=connection.execute("SELECT to_regclass('public.machines')").fetchone()[0]
    if exists: print('Database is already initialized.')
    else:
        for path in sorted((Path(__file__).resolve().parents[1]/'database').glob('*.sql')):
            connection.execute(path.read_text())
        print('Schema, indexes, and seed data initialized.')
