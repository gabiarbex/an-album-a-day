#!/usr/bin/env python3
"""Build a verified, diverse album catalog from MusicBrainz release groups.

Examples:
  python scripts/build_catalog.py --target 100000 --output data/catalog-expanded.json
  python scripts/build_catalog.py --target 100000 --seeds private/lastfm_artist_seeds.json

This script is intentionally opt-in: large public-catalog downloads take time.
MusicBrainz requires a descriptive User-Agent and at most one request per second.
No personal listening data is written to the public output.
"""
import argparse
import json
import random
import time
import urllib.parse
import urllib.request
from pathlib import Path

API = "https://musicbrainz.org/ws/2/release-group/"
SEARCHES = [
    'primarytype:album AND country:US', 'primarytype:album AND country:GB',
    'primarytype:album AND country:BR', 'primarytype:album AND country:JP',
    'primarytype:album AND country:FR', 'primarytype:album AND country:DE',
    'primarytype:album AND country:CA', 'primarytype:album AND country:AU',
    'primarytype:album AND country:ES', 'primarytype:album AND country:IT',
    'primarytype:album AND country:SE', 'primarytype:album AND country:MX',
    'primarytype:album AND country:AR', 'primarytype:album AND country:KR',
    'primarytype:album AND country:IN', 'primarytype:album AND country:ZA',
    'primarytype:album AND country:NG', 'primarytype:album AND country:PT',
    'primarytype:album AND country:NL', 'primarytype:album AND country:PL',
]
# Lucene queries over the full catalog, not a user's personal taste.
GENRES = ['jazz','hip hop','metal','ambient','folk','punk','soul','electronic',
          'experimental','classical','reggae','indie rock','bossa nova','funk',
          'post-rock','shoegaze','synthpop','house','techno','country',
          'afrobeat','salsa','flamenco','gospel','bluegrass','disco']
QUERIES = [f'primarytype:album AND tag:"{g}"' for g in GENRES] + [
    'primarytype:album AND firstreleasedate:[1950 TO 1959]',
    'primarytype:album AND firstreleasedate:[1960 TO 1969]',
    'primarytype:album AND firstreleasedate:[1970 TO 1979]',
    'primarytype:album AND firstreleasedate:[1980 TO 1989]',
    'primarytype:album AND firstreleasedate:[1990 TO 1999]',
    'primarytype:album AND firstreleasedate:[2000 TO 2009]',
    'primarytype:album AND firstreleasedate:[2010 TO 2019]',
    'primarytype:album AND firstreleasedate:[2020 TO 2029]',
] + SEARCHES

def fetch(query, offset, agent):
    params = urllib.parse.urlencode({'query': query, 'fmt':'json', 'limit':100, 'offset':offset})
    req = urllib.request.Request(API+'?'+params, headers={'User-Agent':agent, 'Accept':'application/json'})
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=35) as response:
                return json.load(response)
        except Exception as exc:
            if attempt == 4:
                print('Skipping request after retries:', exc)
                return {}
            time.sleep(min(60, 3 * (2 ** attempt)))
    return {}

def convert(group):
    credits = group.get('artist-credit') or []
    artist = ''.join(c if isinstance(c,str) else c.get('name','') for c in credits).strip()
    title = (group.get('title') or '').strip()
    mbid = group.get('id')
    if not (artist and title and mbid): return None
    tags = sorted(group.get('tags',[]),key=lambda x:x.get('count',0),reverse=True)
    return {
      'id': 'mb:'+mbid, 'artist':artist, 'title':title,
      'year': (group.get('first-release-date') or '')[:4],
      'moods':[], 'energy_level':None, 'comfort_vs_exploration':None,
      'length_min':None,
      'genres':[t['name'] for t in tags[:6] if t.get('name')],
      'metadata': {
        'musicbrainz_id':mbid,
        'cover_art': 'https://coverartarchive.org/release-group/'+mbid+'/front-500',
        'sources': 'https://open.spotify.com/search/'+urllib.parse.quote(artist+' '+title)
      }
    }

def main():
    p=argparse.ArgumentParser()
    p.add_argument('--target',type=int,default=100000)
    p.add_argument('--output',default='data/catalog-expanded.json')
    p.add_argument('--checkpoint',default='data/catalog-checkpoint.json')
    p.add_argument('--user-agent',default='AnAlbumADay/0.1 (contact: replace-with-your-email@example.com)')
    args=p.parse_args()
    if 'replace-with-your-email' in args.user_agent:
        p.error('Supply a real contact address in --user-agent, required for respectful MusicBrainz access.')
    out=Path(args.output); out.parent.mkdir(parents=True,exist_ok=True)
    cp=Path(args.checkpoint); cp.parent.mkdir(parents=True,exist_ok=True)
    if cp.exists():
        saved=json.loads(cp.read_text(encoding='utf-8'))
        albums=saved.get('albums',{}); progress=saved.get('progress',{})
    else:
        albums={};progress={}
    queries=QUERIES[:]
    random.Random(42).shuffle(queries)
    for q in queries:
        offset=progress.get(q,0)
        while len(albums)<args.target and offset<10000:
            data=fetch(q,offset,args.user_agent)
            groups=data.get('release-groups') or []
            if not groups: break
            for group in groups:
                item=convert(group)
                if item: albums[item['id']]=item
            offset+=len(groups)
            progress[q]=offset
            cp.write_text(json.dumps({'albums':albums,'progress':progress},ensure_ascii=False),encoding='utf-8')
            print(f'{len(albums):,}/{args.target:,} verified release-group IDs; {q[:45]} offset {offset}',flush=True)
            if len(groups)<100: break
            time.sleep(1.2)
        if len(albums)>=args.target: break
    catalog={'albums':list(albums.values())[:args.target]}
    out.write_text(json.dumps(catalog,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    print(f'Wrote {len(catalog["albums"]):,} albums to {out}')
    if len(albums)<args.target:
        print('Target not reached. Re-run to resume or broaden the query pool.')

if __name__=='__main__': main()
