"""Перегляд пропозицій від людей перед додаванням у список.

    python3 tools/review.py submissions.jsonl            таблиця для перегляду
    python3 tools/review.py submissions.jsonl --approve ID [ID ...]   дописати в lists/blocklist.txt

Для кожного ID показує ім'я, країну з MusicBrainz, скільки людей його пропонували
і чи він уже в списках. Українських артистів (UA) і тих, кого пропонують підозріло
багато разів за короткий час, перевіряйте вручну.
"""
import collections
import json
import pathlib
import re
import sys
import time
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
UA = {'User-Agent': 'spotify-ban-ru-review/0.1 (https://github.com/RaftTone/spotify-ban-ru)'}


def ids_in(path):
    out = set()
    for raw in path.read_text(encoding='utf-8').splitlines():
        m = re.match(r'^([A-Za-z0-9]{22})\s*#', raw.strip())
        if m:
            out.add(m.group(1))
    return out


def get_json(url):
    try:
        return json.load(urllib.request.urlopen(urllib.request.Request(url, headers={**UA, 'Accept': 'application/json'}), timeout=30))
    except Exception:
        return None


def artist_name(sid):
    try:
        s = urllib.request.urlopen(urllib.request.Request('https://open.spotify.com/embed/artist/' + sid, headers={'User-Agent': 'Mozilla/5.0'}), timeout=30).read().decode('utf-8')
        m = re.search(r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', s, re.S)
        d = json.loads(m.group(1))
        return d['props']['pageProps']['state']['data']['entity']['name']
    except Exception:
        return '?'


def mb_country(sid):
    url = 'https://musicbrainz.org/ws/2/url?resource=' + urllib.parse.quote('https://open.spotify.com/artist/' + sid, safe='') + '&inc=artist-rels&fmt=json'
    d = get_json(url)
    time.sleep(1.1)
    for rel in (d or {}).get('relations', []):
        a = rel.get('artist')
        if a:
            return a.get('country') or '', a.get('name')
    return '', ''


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return
    subs = [json.loads(l) for l in pathlib.Path(sys.argv[1]).read_text(encoding='utf-8').splitlines() if l.strip()]
    if '--approve' in sys.argv:
        approve = [a for a in sys.argv[sys.argv.index('--approve') + 1:] if re.fullmatch(r'[A-Za-z0-9]{22}', a)]
        have = ids_in(ROOT / 'lists' / 'blocklist.txt')
        add = [a for a in approve if a not in have]
        with open(ROOT / 'lists' / 'blocklist.txt', 'a', encoding='utf-8') as f:
            for a in add:
                f.write('%s # %s\n' % (a, artist_name(a)))
        print('додано:', len(add))
        return
    count = collections.Counter()
    notes = collections.defaultdict(list)
    for s in subs:
        for i in s['ids']:
            count[i] += 1
            if s.get('note'):
                notes[i].append(s['note'])
    block, allow = ids_in(ROOT / 'lists' / 'blocklist.txt'), ids_in(ROOT / 'lists' / 'allowlist.txt')
    print('%-24s %-28s %-4s %-3s %s' % ('ID', 'Ім\'я', 'MB', 'x', 'статус / нотатки'))
    for sid, n in count.most_common():
        status = 'ВЖЕ В СПИСКУ' if sid in block else ('В ALLOWLIST' if sid in allow else '')
        country, _ = ('', '') if status else mb_country(sid)
        warn = 'УВАГА: UA' if country == 'UA' else ''
        print('%-24s %-28s %-4s %-3d %s %s %s' % (sid, artist_name(sid)[:28], country or '-', n, status, warn, ' | '.join(notes[sid])[:80]))


if __name__ == '__main__':
    main()
