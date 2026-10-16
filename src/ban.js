(async () => {
  const IDS_CORE = (/*IDS*/'').match(/.{22}/g) || [];
  const IDS_EXTRA = (/*IDS_EXTRA*/'').match(/.{22}/g) || []; // foreign artists who performed in Russia since 24.02.2022
  let IDS = IDS_CORE;
  /*COMMON*/
  const log = (...a) => { try { console.log('[banRu]', ...a); } catch (e) {} };

  const KEY = 'banRuDone';
  const USER_KEY = 'banRuUser';
  const WRITE_URL = 'https://spclient.wg.spotify.com/collection/v2/write?market=from_token';
  const FAST_CHUNK = 50;
  const SNIFF_MS = 15000; // how long to wait for the page to make an authenticated request
  const NUDGE_MS = 2500;  // if nothing yet, navigate to make the page fire requests
  const GRACE_MS = 3000;  // after auth is seen, keep listening for the username

  if (window.__banRuRunning) return;
  window.__banRuRunning = true;
  const ui = makeUI({ title: 'Бан російських виконавців', accent: '#1db954', bg: '#181818', muted: '#b3b3b3', font: 'system-ui,sans-serif', flag: '__banRuRunning' });
  if (!location.hostname.endsWith('open.spotify.com')) {
    ui.finish('Спершу відкрий <b>https://open.spotify.com</b> і зайди в свій акаунт, потім натисни закладку ще раз.');
    return;
  }
  const { store, save } = makeStore(KEY);

  // Two lists: Russian music only, or also foreign artists who performed in Russia since Feb 2022.
  // window.__banMode = 'ru' | 'all' skips the question.
  if (IDS_EXTRA.length) {
    let mode = window.__banMode;
    if (mode !== 'ru' && mode !== 'all') {
      mode = await ui.choose('Кого банимо?', [
        { value: 'ru', label: 'Лише російську музику (' + IDS_CORE.length + ')' },
        { value: 'all', label: '+ закордонних, що виступали в Росії з лютого 2022 (разом ' + (IDS_CORE.length + IDS_EXTRA.length) + ')' }
      ]);
    }
    if (!mode) return;
    if (mode === 'all') IDS = IDS_CORE.concat(IDS_EXTRA);
  }

  // ---------- auth: borrow the page's own Authorization + client-token ----------
  // Spotify's token endpoints are bot-protected, so instead of minting a token we watch the
  // requests the page itself makes (fetch and XHR) for a valid header pair, then restore everything.
  const hook = (onRequest) => {
    const XP = XMLHttpRequest.prototype;
    const orig = { fetch: window.fetch, open: XP.open, setHeader: XP.setRequestHeader, send: XP.send };
    const seen = { fetch: 0, xhr: 0 };
    window.fetch = function (input, init) {
      seen.fetch++;
      try {
        const h = new Headers((init && init.headers) || (input && input.headers) || {});
        onRequest(typeof input === 'string' ? input : (input && input.url) || '', h.get('authorization'), h.get('client-token'), init && init.body);
      } catch (e) {}
      return orig.fetch.apply(this, arguments);
    };
    XP.open = function (method, url) { this.__br = { url, h: {} }; return orig.open.apply(this, arguments); };
    XP.setRequestHeader = function (k, v) { try { this.__br.h[String(k).toLowerCase()] = v; } catch (e) {} return orig.setHeader.apply(this, arguments); };
    XP.send = function (body) {
      seen.xhr++;
      try { onRequest(this.__br.url, this.__br.h.authorization, this.__br.h['client-token'], body); } catch (e) {}
      return orig.send.apply(this, arguments);
    };
    const restore = () => { window.fetch = orig.fetch; XP.open = orig.open; XP.setRequestHeader = orig.setHeader; XP.send = orig.send; };
    return { seen, restore };
  };

  const NAME = '[A-Za-z0-9._~%-]';
  const USER_PATH_RE = new RegExp('/(?:users?|profile|user-profile-view/v3/profile)/(' + NAME + '{2,})(?:[/?]|$)');
  const userFromRequest = (url, body) => {
    url = String(url || '');
    const m = new RegExp('[?&]username=([^&#]+)').exec(url)
      || (typeof body === 'string' && (/"username"\s*:\s*"([^"]+)"/.exec(body) || new RegExp('spotify:user:(' + NAME + '+)').exec(body)))
      || USER_PATH_RE.exec(url.replace(/^https?:\/\/[^/]+/, ''));
    return m && !/^(me|self|v\d+)$/i.test(m[1]) ? decodeURIComponent(m[1]) : null;
  };

  const sniff = () => new Promise((resolve) => {
    let auth = null, user = null, settled = false, h;
    const finish = () => {
      if (settled) return;
      settled = true;
      h.restore();
      log('sniff: fetch', h.seen.fetch, 'xhr', h.seen.xhr, 'auth', !!auth);
      resolve(auth && { token: auth.token, clientToken: auth.clientToken, username: user });
    };
    h = hook((url, authHeader, clientToken, body) => {
      if (authHeader && clientToken && !auth && /^Bearer\s+/i.test(authHeader)) {
        auth = { token: authHeader.replace(/^Bearer\s+/i, ''), clientToken };
        setTimeout(finish, GRACE_MS);
      }
      user = userFromRequest(url, body) || user;
      if (auth && user) finish();
    });
    setTimeout(() => { if (!auth && !settled) { log('no auth yet, nudging page'); navigate('/artist/' + IDS[0]); } }, NUDGE_MS);
    setTimeout(finish, SNIFF_MS);
  });

  // ---------- username ----------
  const usernameFromStorage = () => {
    const re = new RegExp('spotify:user:(' + NAME + '{2,})');
    for (const area of [localStorage, sessionStorage]) {
      try {
        for (let i = 0; i < area.length; i++) {
          const m = re.exec(area.getItem(area.key(i)) || '');
          if (m && !/^(spotify|me)$/i.test(m[1])) return decodeURIComponent(m[1]);
        }
      } catch (e) {}
    }
    return null;
  };
  const usernameFromDom = () => {
    const a = document.querySelector('a[href^="/user/"]');
    const m = a && /^\/user\/([^/?#]+)/.exec(a.getAttribute('href'));
    return m ? decodeURIComponent(m[1]) : null;
  };
  // /v1/me is rate-limited (429), so it is the last resort and tried once.
  const usernameFromApi = async (token) => {
    const r = await fetch('https://api.spotify.com/v1/me', { headers: { Authorization: 'Bearer ' + token } });
    if (!r.ok) { log('v1/me status', r.status); return null; }
    return (await r.json()).id;
  };
  // Fresh sources first; the cache is only a fallback so a different account never inherits an old name.
  const findUsername = async (fromRequests, token) => {
    let name = fromRequests || usernameFromStorage() || usernameFromDom();
    if (!name) { try { name = localStorage.getItem(USER_KEY); } catch (e) {} }
    if (!name) name = await usernameFromApi(token);
    if (name) { try { localStorage.setItem(USER_KEY, name); } catch (e) {} }
    return name;
  };

  // ---------- fast path: the same write Spotify's own "Don't play this artist" button makes ----------
  const writeChunk = async (ids, auth, username) => {
    const headers = { Authorization: 'Bearer ' + auth.token, 'Content-Type': 'application/json', 'client-token': auth.clientToken };
    const body = JSON.stringify({ username, set: 'artistban', items: ids.map((id) => ({ uri: 'spotify:artist:' + id })) });
    for (let attempt = 0; attempt < 2; attempt++) {
      let r = null;
      try { r = await fetch(WRITE_URL, { method: 'POST', headers, body }); } catch (e) { log('write threw', e && e.message); }
      if (r && r.ok) return true;
      const status = r ? r.status : 0;
      log('write status', status);
      if (status && status !== 429 && status < 500) return false; // not transient
      await wait(Math.min((r && parseInt(r.headers.get('Retry-After'), 10)) || 2, 10) * 1000);
    }
    return false;
  };

  // ---------- slow path: drive the real UI (fallback) ----------
  const BAN_RE = /не відтворювати|не воспроизводить|don.?t play|nicht abspielen|no reproducir|ne pas écouter|nie odtwarzaj/i;
  const UNBAN_RE = /^(відтворювати|воспроизводить|play (this|songs)|wiedergeben|reproducir|jouer|odtwarzaj)/i;
  const barOf = () => document.querySelector('[data-testid="action-bar-row"]');
  const moreOf = () => barOf() && barOf().querySelector('[data-testid="more-button"]');
  const isBanned = () => !!(barOf() && barOf().querySelector('[data-testid="ban-button"]'));

  const go = async (id) => {
    const prev = moreOf() && moreOf().getAttribute('aria-label');
    navigate('/artist/' + id);
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
  let finished = 0;
  const advance = (k) => { finished += k; ui.bar.style.width = (todo.length ? Math.round((finished / todo.length) * 100) : 100) + '%'; };

  let auth = null, username = null;
  try {
    ui.st.textContent = 'Чекаю на автентифікацію сторінки...';
    const sniffed = await sniff();
    if (!sniffed) throw new Error('no auth captured in time');
    username = await findUsername(sniffed.username, sniffed.token);
    if (!username) throw new Error('no username');
    auth = sniffed;
    log('auth ok, username:', username);
  } catch (e) { log('auth failed:', e && e.message); }

  const slowQueue = [];
  if (auth) {
    for (let i = 0; i < todo.length && !ui.stop; i += FAST_CHUNK) {
      const chunk = todo.slice(i, i + FAST_CHUNK);
      ui.st.textContent = 'Швидкий бан: ' + Math.min(i + FAST_CHUNK, todo.length) + ' з ' + todo.length + '...';
      if (await writeChunk(chunk, auth, username)) {
        chunk.forEach((id) => { store[id] = 'banned'; counts.banned++; });
        save();
        advance(chunk.length);
      } else {
        slowQueue.push(...chunk);
      }
      await wait(300);
    }
  } else {
    slowQueue.push(...todo);
  }

  for (let n = 1; n <= slowQueue.length && !ui.stop; n++) {
    const id = slowQueue[n - 1];
    ui.st.textContent = 'Резервний спосіб (' + n + ' з ' + slowQueue.length + '). Лишилось приблизно ' + Math.ceil((slowQueue.length - n) * 4 / 60) + ' хв. Вкладку не закривай.';
    let r;
    try { r = await slowBan(id); } catch (e) { r = 'failed'; }
    counts[r]++;
    if (r === 'banned' || r === 'already') { store[id] = r; save(); }
    advance(1);
    await wait(500 + Math.random() * 500);
  }

  navigate(startPath);
  ui.bar.style.width = '100%';
  ui.finish((ui.stop ? 'Зупинено. ' : 'Готово! ') + 'Заблоковано: <b>' + counts.banned + '</b>, вже були: ' + counts.already + (counts.missing + counts.failed ? ', не вдалось: ' + (counts.missing + counts.failed) : '') + '.');
  window.__banRuResult = counts;
})();
