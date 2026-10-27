// node --test tests/*.test.mjs
// Runs the whole bookmarklet in headless Chrome against a fake open.spotify.com: every request
// is answered by Playwright's router, so nothing reaches Spotify. Uses the installed Chrome
// (playwright-core downloads no browsers); without one the tests are skipped, except on CI.
import { describe, test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const read = (name) => readFileSync(new URL('../src/' + name, import.meta.url), 'utf8');
const sub = (src, from, to) => {
  if (!src.includes(from)) throw new Error('tests are out of date with src/ban.js: no ' + JSON.stringify(from));
  return src.replace(from, () => to);
};
const IDS = ['A', 'B', 'C'].map((c) => c.repeat(22));
// The same inlining as tools/build.py, with three artists and short timeouts.
let CODE = read('ban.js');
CODE = sub(CODE, '/*COMMON*/', read('common.js'));
CODE = sub(CODE, '/*SPOTIFY*/', read('spotify.js'));
CODE = sub(CODE, "/*IDS*/''", "'" + IDS.join('') + "'");
CODE = sub(CODE, "/*IDS_EXTRA*/''", "''");
CODE = sub(CODE, 'SNIFF_MS = 15000', 'SNIFF_MS = 1500');
CODE = sub(CODE, 'NUDGE_MS = 2500', 'NUDGE_MS = 300');
CODE = sub(CODE, 'GRACE_MS = 3000', 'GRACE_MS = 300');

// A stand-in for the web player: fetch stubs, the avatar menu and artist pages with a "⋯" menu.
const PAGE = `<!doctype html><meta charset="utf-8"><body>
<button data-testid="user-widget-link">avatar</button><div id="main"></div>
<script>
window.calls = []; window.writeStatus = 200; window.pf = null; window.menuUser = null; window.banned = new Set();
window.fetch = async (u, init) => {
  u = String(u); calls.push(u);
  if (u.includes('/pathfinder/')) return new Response(JSON.stringify(pf || {}));
  if (u.includes('/v1/me')) return new Response('', { status: 429 });
  if (u.includes('/collection/v2/write')) return new Response('{}', { status: writeStatus });
  return new Response('{}');
};
const menu = (html, onClick) => {
  const m = document.createElement('div');
  m.setAttribute('role', 'menu');
  m.innerHTML = html;
  m.onclick = (e) => { e.stopPropagation(); onClick && onClick(e.target); };
  document.body.appendChild(m);
};
document.querySelector('[data-testid="user-widget-link"]').onclick = (e) => {
  e.stopPropagation();
  if (menuUser) menu('<a href="/user/' + menuUser + '">Профіль</a>');
};
const render = () => {
  const m = /^\\/artist\\/(\\w+)/.exec(location.pathname);
  const main = document.getElementById('main');
  if (!m) { main.innerHTML = ''; return; }
  const id = m[1];
  main.innerHTML = '<div data-testid="action-bar-row"><button data-testid="more-button" aria-label="Більше для ' + id + '">⋯</button>'
    + (banned.has(id) ? '<button data-testid="ban-button">ban</button>' : '') + '</div>';
  main.querySelector('[data-testid="more-button"]').onclick = (e) => {
    e.stopPropagation();
    menu(banned.has(id) ? '<button role="menuitem">Відтворювати цього виконавця</button>'
      : '<button role="menuitem">Додати до черги</button><button role="menuitem">Не відтворювати цього виконавця</button>', (t) => {
      if (/^Не відтворювати/.test(t.textContent)) banned.add(id);
      document.querySelectorAll('[role="menu"]').forEach((x) => x.remove());
      render();
    });
  };
};
window.addEventListener('popstate', render);
document.body.addEventListener('click', (e) => { if (e.target === document.body) document.querySelectorAll('[role="menu"]').forEach((x) => x.remove()); });
</script>`;

let browser = null;
try {
  browser = await chromium.launch({ channel: 'chrome' });
} catch (e) {
  if (process.env.CI) throw e;
  console.log('# Chrome not found, browser tests skipped:', e.message.split('\n')[0]);
}

describe('ban.js in Chrome', { skip: !browser && 'Chrome not found' }, () => {
  let context, page, errors;
  beforeEach(async () => {
    context = await browser.newContext();
    await context.route('**/*', (route) => {
      const host = new URL(route.request().url()).hostname;
      if (host === 'open.spotify.com' || host === 'example.test') route.fulfill({ contentType: 'text/html', body: PAGE });
      else route.abort();
    });
    page = await context.newPage();
    errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('https://open.spotify.com/');
  });
  afterEach(async () => {
    assert.deepEqual(errors, [], 'uncaught errors in the page');
    await context.close();
  });
  after(() => browser && browser.close());

  // The bookmarklet runs like a click on it; its promise is kept in window[name].
  const start = (name = '__run') => page.evaluate(([code, n]) => { window[n] = (0, eval)(code); }, [CODE, name]);
  const finish = (name = '__run') => page.evaluate((n) => window[n], name);
  const run = async () => { await start(); await finish(); };
  // An authenticated request the page itself would make; the hook picks the token up from it.
  const auth = (user) => page.evaluate((u) => {
    fetch('https://spclient.wg.spotify.com/melody/v1/check' + (u ? '?username=' + u : ''), { headers: { authorization: 'Bearer t', 'client-token': 'c' } });
  }, user);
  const pathfinder = () => page.evaluate(() => {
    fetch('https://api-partner.spotify.com/pathfinder/v2/query', { method: 'POST', body: JSON.stringify({ operationName: 'profileAttributes' }) });
  });
  const state = () => page.evaluate(() => ({
    flag: window.__banRuRunning,
    boxes: document.querySelectorAll('#br-box').length,
    text: (document.getElementById('br-st') || {}).innerText,
    keys: Object.keys(localStorage).sort(),
    result: window.__banRuResult || null,
    writes: calls.filter((u) => u.includes('/collection/v2/write')).length,
    path: location.pathname
  }));
  const question = async (text) => {
    await page.waitForFunction((t) => (document.getElementById('br-st') || {}).innerText.includes(t), text, { timeout: 10000 });
    return (await state()).text;
  };
  const choose = (label) => page.getByRole('button', { name: label, exact: true }).click();

  test('fast path: bans the list once per account', async () => {
    await start(); await auth('alice'); await finish();
    let s = await state();
    assert.deepEqual(s.result, { banned: 3, already: 0, missing: 0, failed: 0 });
    assert.match(s.text, /Готово! Заблоковано: 3, вже були: 0/);
    assert.equal(s.flag, false);
    assert.equal(s.writes, 1);

    await start(); await auth('alice'); await finish();
    s = await state();
    assert.deepEqual(s.result, { banned: 0, already: 3, missing: 0, failed: 0 });
    assert.equal(s.writes, 1, 'nothing is sent again for the same account');

    await start(); await auth('bob'); await finish();
    s = await state();
    assert.deepEqual(s.result, { banned: 3, already: 0, missing: 0, failed: 0 }, 'another account does not inherit the cache');
    assert.deepEqual(s.keys, ['banRuDone:alice', 'banRuDone:bob', 'banRuUser']);
  });

  test('username from the signed-in user in a pathfinder answer', async () => {
    await page.evaluate(() => { pf = { data: { me: { profile: { username: 'alice' } } } }; });
    await start(); await auth(); await pathfinder(); await finish();
    const s = await state();
    assert.equal(s.result.banned, 3);
    assert.ok(s.keys.includes('banRuDone:alice'));
  });

  test('username from the avatar menu when pathfinder only names other users', async () => {
    await page.evaluate(() => { pf = { data: { playlistV2: { ownerV2: { data: { username: 'stranger' } } } } }; menuUser = 'carol'; });
    await start(); await auth(); await pathfinder(); await finish();
    const s = await state();
    assert.equal(s.result.banned, 3);
    assert.ok(s.keys.includes('banRuDone:carol'));
    assert.equal(await page.locator('[role="menu"]').count(), 0, 'the avatar menu is closed again');
  });

  test('a second click during a run does not start another one', async () => {
    await start('__a');
    await start('__b'); await finish('__b');
    let s = await state();
    assert.equal(s.boxes, 1);
    assert.equal(s.flag, true, 'the first run is still going');
    await auth('alice'); await finish('__a');
    s = await state();
    assert.equal(s.result.banned, 3);
    assert.equal(s.writes, 1);
  });

  test('outside Spotify: explains, and a second click replaces the box', async () => {
    await page.goto('https://example.test/');
    await run(); await run();
    const s = await state();
    assert.match(s.text, /Спершу відкрий https:\/\/open\.spotify\.com/);
    assert.equal(s.boxes, 1);
    assert.equal(s.flag, false);
  });

  test('a flag left by a run that died does not block the bookmarklet', async () => {
    await page.goto('https://example.test/');
    await page.evaluate(() => { window.__banRuRunning = true; });
    await run();
    const s = await state();
    assert.equal(s.boxes, 1);
    assert.match(s.text, /Спершу відкрий/);
  });

  test('an error inside the run is shown in the box and clears the flag', async () => {
    await page.evaluate(() => { history.pushState = () => { throw new Error('boom <b>'); }; });
    await start(); await auth('alice'); await finish();
    const s = await state();
    assert.match(s.text, /^Помилка: boom <b>\. Онови сторінку/);
    assert.equal(s.flag, false);
    assert.equal(await page.locator('#br-st b').count(), 0, 'the message is escaped');
  });

  test('no username: says so and asks before the slow path', async () => {
    await start(); await auth();
    const text = await question('Резервний спосіб');
    assert.match(text, /^Не вдалося визначити ім'я акаунта/);
    assert.match(text, /3 шт\., приблизно 1 хв/);
    await choose('Зупинитись'); await finish();
    const s = await state();
    assert.match(s.text, /^Зупинено\. Заблоковано: 0/);
    assert.equal(s.flag, false);
    assert.equal(s.path, '/', 'back on the page it started from');
  });

  test('no auth at all: says so', async () => {
    await start();
    assert.match(await question('Резервний спосіб'), /^Не вдалося підхопити автентифікацію/);
    await choose('Зупинитись'); await finish();
  });

  test('cancel on the slow-path question closes the box', async () => {
    await page.evaluate(() => { writeStatus = 400; });
    await start(); await auth('alice');
    assert.match(await question('Резервний спосіб'), /^Швидко заблокувати вдалося не всіх/);
    await choose('Скасувати'); await finish();
    const s = await state();
    assert.equal(s.boxes, 0);
    assert.equal(s.flag, false);
    assert.equal(s.result, null);
  });

  test('slow path bans each artist through its "⋯" menu', async () => {
    await page.evaluate(() => { writeStatus = 400; banned.add('B'.repeat(22)); });
    await start(); await auth('alice');
    await question('Резервний спосіб');
    await choose('Продовжити повільно'); await finish();
    const s = await state();
    assert.deepEqual(s.result, { banned: 2, already: 1, missing: 0, failed: 0 });
    assert.deepEqual(await page.evaluate(() => [...banned].sort()), IDS);
    assert.equal(s.path, '/');
    const store = await page.evaluate(() => JSON.parse(localStorage.getItem('banRuDone:alice')));
    assert.deepEqual(Object.values(store).sort(), ['already', 'banned', 'banned']);
  });
});
