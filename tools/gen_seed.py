"""docs/catalog.json → supabase/seed.sql

Standard: legt nur fehlende Läden/Produkte an – Änderungen aus dem Admin (Namen, Preise, Bilder)
bleiben beim erneuten Ausführen erhalten.
  python3 tools/gen_seed.py               → supabase/seed.sql
  python3 tools/gen_seed.py --overwrite   → überschreibt alle Produkte mit catalog.json (Ausgabe nach stdout)
"""
import json, sys, pathlib
root = pathlib.Path(__file__).parent.parent
c = json.load(open(root / 'docs/catalog.json'))
overwrite = '--overwrite' in sys.argv
q = lambda v: 'null' if v is None else ("'" + str(v).replace("'", "''") + "'" if isinstance(v, str) else ('true' if v is True else 'false' if v is False else str(v)))
cols = ['id', 'shop', 'code', 'category', 'kind', 'name', 'image', 'has_mini', 'has_piece', 'mini_price_kg', 'mini_weight_g', 'piece_price_min', 'piece_price_max', 'sort', 'coming_soon', 'veggie']
dbcols = ['shop_id' if k == 'shop' else k for k in cols]
L = ['-- Produkte (generiert aus docs/catalog.json mit tools/gen_seed.py).',
     '-- ' + ('Überschreibt alle Produkte mit dem Stand aus catalog.json!' if overwrite
              else 'Legt nur fehlende Produkte an – im Admin geänderte bleiben unverändert.'),
     'begin;',
     'insert into shops (id,name,sort) values',
     ',\n'.join(f"({q(s['id'])},{q(s['name'])},{s['sort']})" for s in c['shops']) + '\non conflict (id) do update set name=excluded.name, sort=excluded.sort;',
     f"insert into products ({','.join(dbcols)}) values",
     ',\n'.join('(' + ','.join(q(p[k]) for k in cols) + ')' for p in c['products'])]
L.append('on conflict (id) do update set ' + ', '.join(f'{k}=excluded.{k}' for k in dbcols[1:]) + ';' if overwrite else 'on conflict (id) do nothing;')
L.append('commit;')
out = '\n'.join(L) + '\n'
if overwrite: sys.stdout.write(out)
else: open(root / 'supabase/seed.sql', 'w').write(out)
