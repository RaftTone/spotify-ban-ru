(async () => {
  const IDS = /*IDS*/[];
  const KEY = 'banRuDone';
  if (!location.hostname.endsWith('open.spotify.com')) {
    alert('Спершу відкрий https://open.spotify.com і зайди в свій акаунт, потім натисни закладку ще раз.');
    return;
  }
  if (window.__banRuRunning) return;
  window.__banRuRunning = true;

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const store = (() => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; } })();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) {} };

  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;right:16px;bottom:96px;z-index:2147483647;width:300px;padding:14px 16px;background:#181818;color:#fff;border:1px solid #1db954;border-radius:10px;font:14px/1.4 system-ui,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.6)';
  box.innerHTML = '<b>Бан російських виконавців</b><div id="br-st" style="margin:8px 0;color:#b3b3b3"></div><div style="height:6px;background:#333;border-radius:3px;overflow:hidden"><div id="br-bar" style="height:100%;width:0;background:#1db954"></div></div><button id="br-stop" style="margin-top:10px;padding:6px 14px;border:0;border-radius:16px;background:#fff;color:#000;font-weight:700;cursor:pointer">Зупинити</button>';
  document.body.appendChild(box);
  const st = box.querySelector('#br-st');
  const bar = box.querySelector('#br-bar');
  const stopBtn = box.querySelector('#br-stop');
  let stop = false;
  stopBtn.onclick = () => { if (stop || stopBtn.dataset.done) { box.remove(); window.__banRuRunning = false; } stop = true; stopBtn.textContent = 'Зупиняю...'; };

  const BAN_RE = /не відтворювати|не воспроизводить|don.?t play|nicht abspielen|no reproducir|ne pas écouter|nie odtwarzaj/i;
  const barOf = () => document.querySelector('[data-testid="action-bar-row"]');
  const moreOf = () => barOf() && barOf().querySelector('[data-testid="more-button"]');
  const isBanned = () => !!(barOf() && barOf().querySelector('[data-testid="ban-button"]'));

  const waitFor = async (fn, ms) => { const t = Date.now(); while (Date.now() - t < ms) { const v = fn(); if (v) return v; await wait(250); } return null; };

  const go = async (id) => {
    const prev = moreOf() && moreOf().getAttribute('aria-label');
    history.pushState({}, '', '/artist/' + id);
    window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
    await wait(700);
    const t = Date.now();
    return waitFor(() => {
      const m = moreOf();
      if (!m) return null;
      return m.getAttribute('aria-label') !== prev || Date.now() - t > 5000 ? m : null;
    }, 12000);
  };

  const ban = async (id) => {
    const more = await go(id);
    if (!more) return 'missing';
    await wait(900);
    if (isBanned()) return 'already';
    moreOf().click();
    await wait(700);
    const items = [...document.querySelectorAll('[role="menu"] [role="menuitem"], #context-menu li button')];
    const item = items.find((e) => BAN_RE.test(e.innerText)) || items[1];
    if (!item) { document.body.click(); return 'failed'; }
    item.click();
    const ok = await waitFor(isBanned, 4000);
    if (!ok) document.body.click();
    return ok ? 'banned' : 'failed';
  };

  const startPath = location.pathname + location.search;
  const counts = { banned: 0, already: 0, missing: 0, failed: 0, skipped: 0 };
  let n = 0;
  for (const id of IDS) {
    if (stop) break;
    n++;
    bar.style.width = Math.round((n / IDS.length) * 100) + '%';
    if (store[id] === 'banned' || store[id] === 'already') { counts.skipped++; continue; }
    st.textContent = 'Артист ' + n + ' з ' + IDS.length + '...';
    let r;
    try { r = await ban(id); } catch (e) { r = 'failed'; }
    counts[r]++;
    if (r === 'banned' || r === 'already') { store[id] = r; save(); }
    await wait(1200 + Math.random() * 900);
  }

  history.pushState({}, '', startPath);
  window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
  st.innerHTML = (stop ? 'Зупинено. ' : 'Готово! ') + 'Заблоковано нових: <b>' + counts.banned + '</b>, вже були: ' + counts.already + ', пропущено: ' + counts.skipped + (counts.missing + counts.failed ? ', не вдалось: ' + (counts.missing + counts.failed) : '') + '.';
  stopBtn.textContent = 'Закрити';
  stopBtn.dataset.done = '1';
  stop = false;
  stopBtn.onclick = () => { box.remove(); window.__banRuRunning = false; };
  window.__banRuResult = counts;
})();
