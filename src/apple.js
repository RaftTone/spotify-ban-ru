(async () => {
  const IDS = ('/*IDS*/').split(',').filter(Boolean);
  const KEY = 'banRuAppleDone';
  const DRY = !!window.__appleDry;
  if (location.hostname !== 'music.apple.com') {
    alert('Спершу відкрий https://music.apple.com, зайди в свій акаунт Apple Music, потім натисни закладку ще раз.');
    return;
  }
  if (window.__banRuAppleRunning) return;
  window.__banRuAppleRunning = true;

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const store = (() => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; } })();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) {} };
  const sf = (location.pathname.match(/^\/([a-z]{2})\//) || [, 'us'])[1];

  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;right:16px;bottom:96px;z-index:2147483647;width:300px;padding:14px 16px;background:#1c1c1e;color:#fff;border:1px solid #fa2d48;border-radius:10px;font:14px/1.4 -apple-system,system-ui,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.6)';
  box.innerHTML = '<b>Менше російських виконавців</b><div id="br-st" style="margin:8px 0;color:#aaa"></div><div style="height:6px;background:#333;border-radius:3px;overflow:hidden"><div id="br-bar" style="height:100%;width:0;background:#fa2d48"></div></div><button id="br-stop" style="margin-top:10px;padding:6px 14px;border:0;border-radius:16px;background:#fff;color:#000;font-weight:700;cursor:pointer">Зупинити</button>';
  document.body.appendChild(box);
  const st = box.querySelector('#br-st');
  const bar = box.querySelector('#br-bar');
  const stopBtn = box.querySelector('#br-stop');
  let stop = false;
  stopBtn.onclick = () => { if (stop || stopBtn.dataset.done) { box.remove(); window.__banRuAppleRunning = false; } stop = true; stopBtn.textContent = 'Зупиняю...'; };

  // «Suggest Less» / «Пропонувати менше» і зворотний пункт «Undo Suggest Less» / «Відмінити "Пропонувати менше"»
  const UNDO_RE = /undo suggest|відмін|отмен/i;
  const LESS_RE = /suggest less|пропонувати менше|предлагать меньше|weniger vorschlagen|sugerir menos|suggérer moins|rzadziej/i;

  const walk = (root, fn) => root.querySelectorAll('*').forEach((e) => { if (e.shadowRoot) walk(e.shadowRoot, fn); fn(e); });
  const menuItems = () => {
    let out = [...document.querySelectorAll('li.contextual-menu-item, [role="menuitem"]')];
    if (!out.length) walk(document, (e) => { if (e.matches && e.matches('li.contextual-menu-item, [role="menuitem"]')) out.push(e); });
    return out;
  };
  const labelOf = (e) => (e.innerText || '').trim().split('\n')[0];
  const triggers = () => {
    const out = [...document.querySelectorAll('button.contextual-menu__trigger')];
    if (!out.length) walk(document, (e) => { if (e.matches && e.matches('button.contextual-menu__trigger')) out.push(e); });
    return out;
  };
  // «⋯» артиста = перша кнопка меню на сторінці, найвище й найправіше (шапка), до списку пісень
  const headerTrigger = () => {
    const c = triggers().map((b) => ({ b, r: b.getBoundingClientRect() })).filter((x) => x.r.width > 0 && x.r.top < 120);
    c.sort((a, b) => b.r.left - a.r.left);
    return c.length ? c[0].b : null;
  };
  const waitFor = async (fn, ms) => { const t = Date.now(); while (Date.now() - t < ms) { const v = fn(); if (v) return v; await wait(250); } return null; };
  const closeMenu = () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); document.body.click(); };
  const openMenu = async () => {
    const t = headerTrigger();
    if (!t) return null;
    t.click();
    await wait(500);
    return waitFor(() => (menuItems().length ? menuItems() : null), 3000);
  };

  const go = async (id) => {
    const target = '/' + sf + '/artist/' + id;
    const prevTitle = document.title;
    history.pushState({}, '', target);
    window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
    await wait(900);
    const ok = await waitFor(() => (document.title !== prevTitle && headerTrigger()) || null, 8000);
    if (!ok && location.pathname !== target) return null;
    return ok;
  };

  const seenLabels = new Set();
  const ban = async (id) => {
    const t = await go(id);
    if (!t) return 'missing';
    await wait(900);
    let items = await openMenu();
    if (!items) return 'failed';
    items.forEach((e) => seenLabels.add(labelOf(e)));
    if (items.some((e) => UNDO_RE.test(labelOf(e)))) { closeMenu(); return 'already'; }
    const item = items.find((e) => LESS_RE.test(labelOf(e)));
    if (!item) { closeMenu(); return 'noitem'; }
    if (DRY) { closeMenu(); return 'dry'; }
    (item.querySelector('button') || item).click();
    await wait(1200);
    items = await openMenu();
    const done = !!items && items.some((e) => UNDO_RE.test(labelOf(e)));
    closeMenu();
    return done ? 'banned' : 'failed';
  };

  if (document.hidden) { st.textContent = 'Вкладка у фоні. Поверніться на неї, і перевірка почнеться сама.'; await waitFor(() => !document.hidden, 600000); }
  const startPath = location.pathname + location.search;
  const counts = { banned: 0, already: 0, missing: 0, failed: 0, skipped: 0, noitem: 0, dry: 0 };
  let n = 0;
  for (const id of IDS) {
    if (stop) break;
    n++;
    bar.style.width = Math.round((n / IDS.length) * 100) + '%';
    if (store[id] === 'banned' || store[id] === 'already') { counts.skipped++; continue; }
    const left = IDS.length - n;
    st.textContent = 'Артист ' + n + ' з ' + IDS.length + '. Лишилось приблизно ' + Math.ceil(left * 6 / 60) + ' хв. Вкладку не закривай.';
    let r;
    try { r = await ban(id); } catch (e) { r = 'failed'; }
    counts[r]++;
    if (r === 'banned' || r === 'already') { store[id] = r; save(); }
    if (r === 'noitem' && counts.noitem >= 3 && !counts.banned && !counts.already) break;
    await wait(600 + Math.random() * 600);
  }

  history.pushState({}, '', startPath);
  window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
  const okN = counts.banned + counts.already;
  const bad = counts.missing + counts.failed + counts.noitem;
  const diag = () => JSON.stringify({ counts, labels: [...seenLabels], ua: navigator.userAgent, url: startPath, hidden: document.hidden, total: IDS.length }, null, 1);
  let verdict;
  if (DRY && counts.dry && !bad) verdict = '<b style="color:#4cd964;font-size:18px">✅ Меню відкривається</b><br>Знайдено пункт для ' + counts.dry + ' виконавців.';
  else if (stop && !okN) verdict = '<b style="color:#ff6b6b;font-size:18px">Зупинено</b>';
  else if (okN && !bad) verdict = '<b style="color:#4cd964;font-size:18px">✅ ПРАЦЮЄ</b><br>Позначено виконавців: ' + okN + '.';
  else if (okN) verdict = '<b style="color:#ffcc00;font-size:18px">⚠️ ПРАЦЮЄ ЧАСТКОВО</b><br>Вийшло: ' + okN + ', не вийшло: ' + bad + '.';
  else if (counts.noitem) verdict = '<b style="color:#ff6b6b;font-size:18px">❌ НЕ ПРАЦЮЄ</b><br>У меню виконавця нема пункту «Suggest Less» («Пропонувати менше»). Потрібен акаунт Apple Music з підпискою.';
  else if (counts.missing) verdict = '<b style="color:#ff6b6b;font-size:18px">❌ НЕ ПРАЦЮЄ</b><br>Сторінки виконавців не відкрилися. Не перемикайте вкладку, поки йде перевірка, і спробуйте ще раз.';
  else verdict = '<b style="color:#ff6b6b;font-size:18px">❌ НЕ ПРАЦЮЄ</b><br>Кнопка натискалась, але виконавець не позначився.';
  st.innerHTML = verdict + (DRY ? '<br><i>(пробний режим, нічого не натискалось)</i>' : '');
  const cp = document.createElement('button');
  cp.textContent = 'Скопіювати деталі';
  cp.style.cssText = 'margin:10px 8px 0 0;padding:6px 14px;border:0;border-radius:16px;background:#fa2d48;color:#fff;font-weight:700;cursor:pointer';
  cp.onclick = async () => { try { await navigator.clipboard.writeText(diag()); cp.textContent = 'Скопійовано ✓'; } catch (e) { window.prompt('Скопіюйте (Cmd/Ctrl+C):', diag()); } };
  stopBtn.before(cp);
  stopBtn.textContent = 'Закрити';
  stopBtn.dataset.done = '1';
  stop = false;
  stopBtn.onclick = () => { box.remove(); window.__banRuAppleRunning = false; };
  window.__banRuAppleResult = counts;
  window.__banRuAppleLabels = [...seenLabels];
})();
