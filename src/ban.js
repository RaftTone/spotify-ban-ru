(async () => {
  const IDS = (/*IDS*/'').match(/.{22}/g) || [];
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
  box.innerHTML = '<b>Бан російських виконавців</b><div id="br-st" style="margin:8px 0;color:#b3b3b3">Запуск...</div><div style="height:6px;background:#333;border-radius:3px;overflow:hidden"><div id="br-bar" style="height:100%;width:0;background:#1db954"></div></div><button id="br-stop" style="margin-top:10px;padding:6px 14px;border:0;border-radius:16px;background:#fff;color:#000;font-weight:700;cursor:pointer">Зупинити</button>';
  document.body.appendChild(box);
  const st = box.querySelector('#br-st');
  const bar = box.querySelector('#br-bar');
  const stopBtn = box.querySelector('#br-stop');
  let stop = false;
  let done = false;
  stopBtn.onclick = () => { if (done) { box.remove(); window.__banRuRunning = false; return; } stop = true; stopBtn.textContent = 'Зупиняю...'; };

  // ---------- fast path: direct API call, same as Spotify's own "Don't play this artist" button ----------
  const WRITE_URL = 'https://spclient.wg.spotify.com/collection/v2/write?market=from_token';
  const FAST_CHUNK = 50;

  const getToken = async () => {
    const r = await fetch('https://open.spotify.com/get_access_token?reason=transport&productType=web_player', { credentials: 'include' });
    if (!r.ok) throw new Error('token HTTP ' + r.status);
    return (await r.json()).accessToken;
  };

  const getUsername = async (token) => {
    const r = await fetch('https://api.spotify.com/v1/me', { headers: { Authorization: 'Bearer ' + token } });
    if (!r.ok) throw new Error('me HTTP ' + r.status);
    return (await r.json()).id;
  };

  const guessClientToken = () => {
    for (const k of ['client-token', 'clientToken']) {
      try {
        const v = localStorage.getItem(k);
        if (!v) continue;
        try { const j = JSON.parse(v); if (j && j.token) return j.token; } catch (e) {}
        return v;
      } catch (e) {}
    }
    return null;
  };

  const fastBanChunk = async (ids, token, username) => {
    const headers = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
    const ct = guessClientToken();
    if (ct) headers['client-token'] = ct;
    let r;
    try {
      r = await fetch(WRITE_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify({ username, set: 'artistban', items: ids.map((id) => ({ uri: 'spotify:artist:' + id })) })
      });
    } catch (e) { return false; }
    return r.ok;
  };

  // ---------- slow path: drive the real UI (unchanged, proven fallback) ----------
  const BAN_RE = /не відтворювати|не воспроизводить|don.?t play|nicht abspielen|no reproducir|ne pas écouter|nie odtwarzaj/i;
  const UNBAN_RE = /^(відтворювати|воспроизводить|play (this|songs)|wiedergeben|reproducir|jouer|odtwarzaj)/i;
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

  const slowBan = async (id) => {
    const more = await go(id);
    if (!more) return 'missing';
    await wait(900);
    if (isBanned()) return 'already';
    moreOf().click();
    await wait(700);
    const items = [...document.querySelectorAll('[role="menu"] [role="menuitem"], #context-menu li button')];
    if (items.some((e) => UNBAN_RE.test(e.innerText.trim()))) { document.body.click(); return 'already'; }
    const item = items.find((e) => BAN_RE.test(e.innerText)) || items[1];
    if (!item) { document.body.click(); return 'failed'; }
    item.click();
    const ok = await waitFor(isBanned, 4000);
    if (!ok) document.body.click();
    return ok ? 'banned' : 'failed';
  };

  // ---------- run ----------
  const startPath = location.pathname + location.search;
  const todo = IDS.filter((id) => store[id] !== 'banned' && store[id] !== 'already');
  const counts = { banned: 0, already: IDS.length - todo.length, missing: 0, failed: 0 };

  let token = null;
  let username = null;
  try {
    token = await getToken();
    username = await getUsername(token);
  } catch (e) { token = null; }

  const slowQueue = [];
  if (token && username) {
    for (let i = 0; i < todo.length; i += FAST_CHUNK) {
      if (stop) break;
      const chunk = todo.slice(i, i + FAST_CHUNK);
      bar.style.width = Math.round((Math.min(i + FAST_CHUNK, todo.length) / todo.length) * 50) + '%';
      st.textContent = 'Швидкий бан: ' + Math.min(i + FAST_CHUNK, todo.length) + ' з ' + todo.length + '...';
      const ok = await fastBanChunk(chunk, token, username);
      if (ok) {
        chunk.forEach((id) => { store[id] = 'banned'; counts.banned++; });
        save();
      } else {
        slowQueue.push(...chunk);
      }
      await wait(300);
    }
  } else {
    slowQueue.push(...todo);
  }

  let n = 0;
  for (const id of slowQueue) {
    if (stop) break;
    n++;
    bar.style.width = (50 + Math.round((n / slowQueue.length) * 50)) + '%';
    const left = slowQueue.length - n;
    st.textContent = 'Резервний спосіб (' + n + ' з ' + slowQueue.length + '). Лишилось приблизно ' + Math.ceil(left * 4 / 60) + ' хв. Вкладку не закривай.';
    let r;
    try { r = await slowBan(id); } catch (e) { r = 'failed'; }
    counts[r]++;
    if (r === 'banned' || r === 'already') { store[id] = r; save(); }
    await wait(500 + Math.random() * 500);
  }

  history.pushState({}, '', startPath);
  window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
  bar.style.width = '100%';
  st.innerHTML = (stop ? 'Зупинено. ' : 'Готово! ') + 'Заблоковано: <b>' + counts.banned + '</b>, вже були: ' + counts.already + (counts.missing + counts.failed ? ', не вдалось: ' + (counts.missing + counts.failed) : '') + '.';
  stopBtn.textContent = 'Закрити';
  done = true;
  window.__banRuResult = counts;
})();
