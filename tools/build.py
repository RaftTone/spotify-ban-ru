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
PAGES_URL = 'https://rafttone.github.io/spotify-ban-ru'
LOADER = ("(async()=>{try{const r=await fetch('%s/ban.js',{cache:'no-cache'});"
          "if(!r.ok)throw new Error('HTTP '+r.status);const c=await r.text();"
          "await new(Object.getPrototypeOf(async function(){}).constructor)(c)()}"
          "catch(e){alert('Не вдалося запустити скрипт: '+e.message+'\\nСпробуй автономну версію закладки на сторінці.')}})()") % PAGES_URL


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
    foreign, e3 = read_list(ROOT / 'lists' / 'foreign.txt')
    errors = e1 + e2 + e3
    for sid in foreign:
        if sid in block:
            errors.append('%s є і в blocklist, і в foreign (%s); лишіть в одному' % (sid, foreign[sid]))
        if sid in allow:
            errors.append('%s є і в foreign, і в allowlist (%s); приберіть з foreign' % (sid, foreign[sid]))
    for sid in allow:
        if sid in block:
            errors.append('%s є і в blocklist, і в allowlist (%s); приберіть з blocklist' % (sid, allow[sid]))
    if errors:
        print('\n'.join(errors))
        sys.exit(1)
    ids = list(block)
    print('OK: %d у blocklist, %d у foreign, %d у allowlist' % (len(ids), len(foreign), len(allow)))
    if '--check' in sys.argv:
        return

    src = (ROOT / 'src' / 'ban.js').read_text(encoding='utf-8')
    src = src.replace('/*COMMON*/', (ROOT / 'src' / 'common.js').read_text(encoding='utf-8'))
    src = src.replace("/*IDS*/''", "'" + ''.join(ids) + "'")
    src = src.replace("/*IDS_EXTRA*/''", "'" + ''.join(foreign) + "'")
    out = ROOT / 'site'
    (out / 'ban.js').write_text(src, encoding='utf-8')
    bookmarklet = 'javascript:' + urllib.parse.quote(src, safe="()!*'~")
    cfg = json.loads((ROOT / 'config.json').read_text(encoding='utf-8')) if (ROOT / 'config.json').exists() else {}
    submit_url = cfg.get('submit_url', '')
    page = (out / 'index.template.html').read_text(encoding='utf-8')
    extra_note = extra_faq = ''
    if foreign:
        extra_note = ('<p class="lead">Закладка спитає, кого банити: <b>лише російську музику</b> (%d) або ще й <b>закордонних артистів, які виступали в Росії після 24.02.2022</b> (+%d). Кожен запис у другому списку має дату виступу й посилання на джерело.</p>' % (len(ids), len(foreign)))
        extra_faq = '<p><b>Чому окремий список закордонних?</b> Це артисти не з російської сцени, тому вони не входять у основний список. Кожен запис у <a href="lists/foreign.txt">lists/foreign.txt</a> має підтверджений виступ у Росії після 24.02.2022 (дата, місто, джерело). Банити їх чи ні, вирішуєш ти, коли натискаєш закладку.</p>'
    page = page.replace('{{EXTRA_NOTE}}', extra_note).replace('{{EXTRA_FAQ}}', extra_faq)
    page = (page.replace('{{COUNT_EXTRA}}', str(len(foreign)))
                .replace('{{COUNT}}', str(len(ids)))
                .replace('{{SUBMIT_URL}}', json.dumps(submit_url))
                .replace('{{REPO}}', REPO_URL)
                .replace('{{LOADER_RAW}}', LOADER.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;'))
                .replace('{{LOADER}}', ('javascript:' + urllib.parse.quote(LOADER, safe="()!*'~")).replace('&', '&amp;').replace('"', '&quot;'))
                .replace('{{BOOKMARKLET}}', bookmarklet.replace('&', '&amp;').replace('"', '&quot;')))
    (out / 'index.html').write_text(page, encoding='utf-8')
    print('site/index.html зібрано, закладка %d символів' % len(bookmarklet))


if __name__ == '__main__':
    main()
