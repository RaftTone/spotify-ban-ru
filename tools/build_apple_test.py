"""Збирає тестову сторінку для Apple Music: одна перетягувана закладка з 5 виконавцями.

    python3 -I tools/build_apple_test.py [--dry]    -> ~/Downloads/apple-music-test.html
"""
import pathlib
import sys
import urllib.parse

ROOT = pathlib.Path(__file__).resolve().parent.parent
IDS = '380174444,1383284912,837847154,278959467,1323091554'  # Земфіра, The Limba, Скриптонит, Yanix, ROCKET
dry = '--dry' in sys.argv
def strip(name):
    lines = (ROOT / 'src' / name).read_text(encoding='utf-8').splitlines()
    return ''.join(l.lstrip() + '\n' for l in lines if not l.lstrip().startswith('//'))


code = strip('apple.js').replace('/*COMMON*/', strip('common.js')).replace('/*IDS*/', IDS)
if dry:
    code = 'window.__appleDry=true;' + code
href = 'javascript:' + urllib.parse.quote(code, safe="!~*'()")
html = f'''<!doctype html><html lang="uk"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Тест Apple Music</title>
<body style="font:18px/1.5 -apple-system,system-ui,sans-serif;max-width:560px;margin:40px auto;padding:0 20px;color:#222">
<h2>Тест для Apple Music</h2>
<p><b>Крок 1.</b> Перетягни цю кнопку мишкою на панель закладок браузера (угорі під адресним рядком; якщо панелі нема, натисни Cmd+Shift+B на Mac або Ctrl+Shift+B на Windows):</p>
<p><a href="{href}" style="display:inline-block;padding:14px 22px;background:#fa2d48;color:#fff;text-decoration:none;border-radius:12px;font-weight:700;cursor:grab">Тест Apple Music</a></p>
<p><b>Крок 2.</b> Відкрий <a href="https://music.apple.com" target="_blank">music.apple.com</a> і увійди у свій акаунт Apple Music.</p>
<p><b>Крок 3.</b> Натисни закладку «Тест Apple Music» один раз. У куточку екрана з'явиться вікно. Нічого не натискай і не перемикай вкладку приблизно хвилину.</p>
<p><b>Крок 4.</b> Коли вікно напише <b>ПРАЦЮЄ</b> або <b>НЕ ПРАЦЮЄ</b>, напиши мені, що саме. Якщо НЕ ПРАЦЮЄ, ще натисни «Скопіювати деталі» і встав мені текст.</p>
<p style="color:#888;font-size:15px">Тест позначає 5 виконавців кнопкою «Suggest Less» («Пропонувати менше»). Це можна скасувати.</p>
</body></html>'''
out = pathlib.Path.home() / 'Downloads' / 'apple-music-test.html'
out.write_text(html, encoding='utf-8')
print(out, len(href), 'chars in bookmarklet', '(dry)' if dry else '')
