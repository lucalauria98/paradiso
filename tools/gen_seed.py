import json
c=json.load(open(__import__('pathlib').Path(__file__).parent.parent/'docs/catalog.json'))
q=lambda v:'null' if v is None else ("'"+str(v).replace("'","''")+"'" if isinstance(v,str) else ('true' if v is True else 'false' if v is False else str(v)))
L=['-- Produkte (generiert aus docs/catalog.json). Erneut ausführen = aktualisieren.','begin;']
L.append('insert into shops (id,name,sort) values')
L.append(',\n'.join(f"({q(s['id'])},{q(s['name'])},{s['sort']})" for s in c['shops'])+'\non conflict (id) do update set name=excluded.name, sort=excluded.sort;')
cols=['id','shop','code','category','name','image','unit','price_min','price_max','est_weight_g','sort','coming_soon']
L.append('insert into products (id,shop_id,code,category,name,image,unit,price_min,price_max,est_weight_g,sort,coming_soon) values')
L.append(',\n'.join('('+','.join(q(p[k]) for k in cols)+')' for p in c['products']))
L.append('on conflict (id) do update set shop_id=excluded.shop_id, code=excluded.code, category=excluded.category, name=excluded.name, image=excluded.image, unit=excluded.unit, price_min=excluded.price_min, price_max=excluded.price_max, est_weight_g=excluded.est_weight_g, sort=excluded.sort, coming_soon=excluded.coming_soon;')
L.append('commit;')
open(__import__('pathlib').Path(__file__).parent.parent/'supabase/seed.sql','w').write('\n'.join(L)+'\n')
