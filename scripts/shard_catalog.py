#!/usr/bin/env python3
"""Split a large album catalog into browser-friendly static shards."""
import argparse, hashlib, json, shutil
from pathlib import Path

def main():
    p=argparse.ArgumentParser()
    p.add_argument('--input',default='data/catalog-expanded.json')
    p.add_argument('--out-dir',default='data/catalog')
    p.add_argument('--shard-size',type=int,default=1000)
    args=p.parse_args()
    raw=json.loads(Path(args.input).read_text(encoding='utf-8'))
    albums=raw if isinstance(raw,list) else raw.get('albums',[])
    out=Path(args.out_dir)
    if out.exists(): shutil.rmtree(out)
    out.mkdir(parents=True,exist_ok=True)
    # Give every album a stable public lookup id, then hash-order the catalog so
    # adjacent shards stay musically mixed rather than clustering by artist/year.
    for a in albums:
        raw_key=(str(a.get('artist','')).strip().lower()+'\0'+str(a.get('title','')).strip().lower()).encode('utf-8')
        a['lookup_id']=hashlib.sha1(raw_key).hexdigest()[:12]
    albums=sorted(albums,key=lambda a:a['lookup_id'])
    shards=[]; lookup_index={}
    for i in range(0,len(albums),args.shard_size):
        chunk=albums[i:i+args.shard_size]
        name=f'shard-{i//args.shard_size:03d}.json'
        (out/name).write_text(json.dumps({'albums':chunk},ensure_ascii=False,separators=(',',':')),encoding='utf-8')
        for a in chunk: lookup_index[a['lookup_id']]=name
        shards.append({'file':name,'count':len(chunk)})
    manifest={
      'version':2,'total_albums':len(albums),'shard_size':args.shard_size,
      'lookup_index':'lookup.json','shards':shards
    }
    (out/'manifest.json').write_text(json.dumps(manifest,separators=(',',':')),encoding='utf-8')
    (out/'lookup.json').write_text(json.dumps(lookup_index,separators=(',',':')),encoding='utf-8')
    print(f'Wrote {len(albums):,} albums across {len(shards)} shards.')

if __name__=='__main__': main()
