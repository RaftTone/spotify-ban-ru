"""Збирає закладку і сторінку з lists/*.txt і src/ban.js.

    python3 tools/build.py          зібрати у site/
    python3 tools/build.py --check  лише перевірити списки (для CI та PR)
"""
import json
import pathlib
import re
import sys
import urllib.parse

ROOT = pathlib.Path(__file__).resolve().parent.parent
ID_RE = re.compile(r'^[A-Za-z0-9]{22}$')
REPO_URL = 'https://github.com/RaftTone/spotify-ban-ru'


def read_list(path):
    entries, errors = {}, []
    for n, raw in enumerate(path.read_text(encoding='utf-8').splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith('#'):
            continue
        sid, _, name = line.partition('#')
        sid, name = sid.strip(), name.strip()
        if not ID_RE.match(sid):
            errors.append('%s:%d: некоректний ID «%s» (потрібно 22 символи a-z A-Z 0-9)' % (path.name, n, sid))
            continue
        if sid in entries:
            errors.append('%s:%d: дубль %s (%s)' % (path.name, n, sid, name))
            continue
        entries[sid] = name
    return entries, errors


def main():
    block, e1 = read_list(ROOT / 'lists' / 'blocklist.txt')
    allow, e2 = read_list(ROOT / 'lists' / 'allowlist.txt')
    errors = e1 + e2
    for sid in allow:
        if sid in block:
            errors.append('%s є і в blocklist, і в allowlist (%s); приберіть з blocklist' % (sid, allow[sid]))
    if errors:
        print('\n'.join(errors))
        sys.exit(1)
    ids = list(block)
    print('OK: %d у blocklist, %d у allowlist' % (len(ids), len(allow)))
    if '--check' in sys.argv:
        return

    src = (ROOT / 'src' / 'ban.js').read_text(encoding='utf-8').replace('/*IDS*/[]', json.dumps(ids))
    out = ROOT / 'site'
    (out / 'ban.js').write_text(src, encoding='utf-8')
    bookmarklet = 'javascript:' + urllib.parse.quote(src, safe="()!*'~")
    page = (out / 'index.template.html').read_text(encoding='utf-8')
    page = (page.replace('{{COUNT}}', str(len(ids)))
                .replace('{{REPO}}', REPO_URL)
                .replace('{{BOOKMARKLET}}', bookmarklet.replace('&', '&amp;').replace('"', '&quot;')))
    (out / 'index.html').write_text(page, encoding='utf-8')
    print('site/index.html зібрано, закладка %d символів' % len(bookmarklet))


if __name__ == '__main__':
    main()
