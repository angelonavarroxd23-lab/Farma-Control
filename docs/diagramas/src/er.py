import re, subprocess, html
sql = open('/home/claude/work/FarmaControl/database/FarmaControl_Database.sql', encoding='utf8').read()
tables = {}
for m in re.finditer(r'CREATE TABLE dbo\.(\w+)\s*\((.*?)\n\);', sql, re.S):
    name, body = m.group(1), m.group(2)
    cols, pk, fks, uq = [], [], [], []
    fks = [(a,b) for a,b,_ in re.findall(r'FOREIGN KEY \((\w+)\)\s+REFERENCES dbo\.(\w+)\((\w+)\)', body)]
    for line in body.split('\n'):
        l = line.strip().rstrip(',')
        if not l or l.startswith('--'): continue
        fk = re.match(r'CONSTRAINT \w+ FOREIGN KEY \((\w+)\)\s+REFERENCES dbo\.(\w+)\((\w+)\)', l)
        if 'FOREIGN KEY' in l: continue
        if l.startswith('CONSTRAINT'):
            u = re.match(r'CONSTRAINT \w+ UNIQUE \((.*?)\)', l)
            if u: uq += [c.strip() for c in u.group(1).split(',')]
            continue
        c = re.match(r'(\w+)\s+([A-Z]+(?:\(\d+(?:,\d+)?\))?)(.*)', l)
        if c:
            cn, ct, rest = c.groups(); null = 'NULL' if re.search(r'\bNULL\b', rest) and 'NOT NULL' not in rest else 'NOT NULL'
            if 'PRIMARY KEY' in rest: pk.append(cn)
            if re.search(r'\bUNIQUE\b', rest): uq.append(cn)
            cols.append((cn, ct, null))
    tables[name] = dict(cols=cols, pk=pk, fks=fks, uq=uq)
import json; json.dump(tables, open('tablas.json', 'w'), indent=1, ensure_ascii=False)
print({k: (len(v['cols']), v['pk'], len(v['fks'])) for k, v in tables.items()})
