#!/usr/bin/env python3
"""Turn a private Last.fm CSV export into a taste graph.

The raw CSV never needs to enter the public repository.

For every seed artist in the export, this script:
1) resolves a MusicBrainz artist MBID,
2) asks ListenBrainz for up to N similar artists,
3) stores only a compact taste graph for downstream catalog expansion.

Usage:
  python scripts/mesh_lastfm.py \
    --lastfm-csv /path/to/lastfm.csv \
    --output private/taste_graph.json

CSV format expected from Last.fm export:
  artist, album, track, timestamp
(no header is fine; header rows are auto-detected)
"""

import argparse
import csv
import json
import math
import time
import urllib.parse
import urllib.request
from collections import Counter
from pathlib import Path

MB_ARTIST_SEARCH = "https://musicbrainz.org/ws/2/artist/"
LB_RADIO = "https://api.listenbrainz.org/1/lb-radio/artist/{mbid}"

def get_json(url, agent, min_delay=1.1, retries=5):
    req=urllib.request.Request(url,headers={'User-Agent':agent,'Accept':'application/json'})
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req,timeout=35) as r:
                payload=json.load(r)
            time.sleep(min_delay)
            return payload
        except Exception as exc:
            if attempt==retries-1:
                print("request failed:", url, exc)
                return {}
            time.sleep(min(60, 3*(2**attempt)))
    return {}

def read_artist_counts(path):
    counts=Counter()
    with open(path, newline='', encoding='utf-8-sig') as f:
        rows=csv.reader(f)
        for row in rows:
            if not row:
                continue
            artist=(row[0] or '').strip()
            if not artist:
                continue
            if artist.lower() in {'artist','artist name'}:
                continue
            counts[artist]+=1
    return counts

def norm(s):
    return ' '.join(str(s or '').casefold().split())

def resolve_artist(name, agent):
    q=urllib.parse.quote(f'artist:"{name}"')
    data=get_json(f'{MB_ARTIST_SEARCH}?query={q}&fmt=json&limit=8',agent)
    artists=data.get('artists') or []
    if not artists:
        return None
    exact=[a for a in artists if norm(a.get('name'))==norm(name) or norm(a.get('sort-name'))==norm(name)]
    pool=exact or artists
    pool.sort(key=lambda a:int(a.get('score') or 0),reverse=True)
    a=pool[0]
    return {
      'name':a.get('name') or name,
      'mbid':a.get('id'),
      'country':a.get('country'),
      'disambiguation':a.get('disambiguation') or ''
    }

def similar_artists(mbid, agent, limit=5, mode='easy'):
    params=urllib.parse.urlencode({
      'mode':mode,
      'max_similar_artists':limit,
      'max_recordings_per_artist':1
    })
    data=get_json(LB_RADIO.format(mbid=mbid)+'?'+params,agent,min_delay=.25)
    # Current ListenBrainz radio response is a list/dict of recordings with
    # similar_artist_mbid + similar_artist_name. Parse defensively.
    candidates=[]
    if isinstance(data,list):
        rows=data
    elif isinstance(data,dict):
        rows=data.get('payload') or data.get('recordings') or data.get('results') or []
        if isinstance(rows,dict):
            rows=rows.get('recordings') or rows.get('results') or []
    else:
        rows=[]
    seen=set()
    for row in rows:
        if not isinstance(row,dict):
            continue
        mid=row.get('similar_artist_mbid') or row.get('artist_mbid')
        name=row.get('similar_artist_name') or row.get('artist_name')
        if not mid or mid==mbid or mid in seen:
            continue
        seen.add(mid)
        candidates.append({'mbid':mid,'name':name or ''})
        if len(candidates)>=limit:
            break
    return candidates

def main():
    p=argparse.ArgumentParser()
    p.add_argument('--lastfm-csv',required=True)
    p.add_argument('--output',default='private/taste_graph.json')
    p.add_argument('--checkpoint',default='private/taste_graph.checkpoint.json')
    p.add_argument('--neighbors',type=int,default=5)
    p.add_argument('--max-seeds',type=int,default=0,help='0 = every unique artist in the export')
    p.add_argument('--mode',choices=['easy','medium','hard'],default='easy')
    p.add_argument('--user-agent',default='AnAlbumADay/0.2 (https://github.com/gabiarbex/an-album-a-day)')
    args=p.parse_args()

    counts=read_artist_counts(args.lastfm_csv)
    ranked=counts.most_common(args.max_seeds or None)
    out=Path(args.output); out.parent.mkdir(parents=True,exist_ok=True)
    cp=Path(args.checkpoint); cp.parent.mkdir(parents=True,exist_ok=True)

    if cp.exists():
        state=json.loads(cp.read_text(encoding='utf-8'))
    else:
        state={'artists':{},'failed':[]}

    for idx,(artist,plays) in enumerate(ranked,1):
        if artist in state['artists']:
            continue
        resolved=resolve_artist(artist,args.user_agent)
        if not resolved or not resolved.get('mbid'):
            state['failed'].append(artist)
            cp.write_text(json.dumps(state,ensure_ascii=False),encoding='utf-8')
            continue
        neighbors=similar_artists(resolved['mbid'],args.user_agent,args.neighbors,args.mode)
        # log-compressed weight prevents one hyper-listened artist from dominating.
        weight=round(math.log1p(plays)/math.log1p(max(counts.values())),6)
        state['artists'][artist]={
          'seed':resolved,
          'weight':weight,
          'neighbors':neighbors
        }
        cp.write_text(json.dumps(state,ensure_ascii=False),encoding='utf-8')
        print(f'[{idx}/{len(ranked)}] {artist}: {len(neighbors)} neighbors',flush=True)

    graph={
      'meta':{
        'seed_artist_count':len(state['artists']),
        'neighbors_per_artist':args.neighbors,
        'weighting':'log-compressed Last.fm play count',
        'privacy':'raw scrobbles, tracks and timestamps omitted'
      },
      'artists':state['artists']
    }
    out.write_text(json.dumps(graph,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    print(f'Wrote taste graph to {out}')

if __name__=='__main__':
    main()
