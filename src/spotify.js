// Spotify-specific helpers with no DOM access, kept apart so tests/spotify.test.mjs can load them.
// tools/build.py inlines it into ban.js, which provides log() and wait().
const WRITE_URL = 'https://spclient.wg.spotify.com/collection/v2/write?market=from_token';

const NAME = '[A-Za-z0-9._~%-]';
const USER_PATH_RE = new RegExp('/(?:users?|profile|user-profile-view/v3/profile)/(' + NAME + '{2,})(?:[/?]|$)');
const userFromRequest = (url, body) => {
  url = String(url || '');
  const m = new RegExp('[?&]username=([^&#]+)').exec(url)
    || (typeof body === 'string' && (/"username"\s*:\s*"([^"]+)"/.exec(body) || new RegExp('spotify:user:(' + NAME + '+)').exec(body)))
    || USER_PATH_RE.exec(url.replace(/^https?:\/\/[^/]+/, ''));
  return m && !/^(me|self|v\d+)$/i.test(m[1]) ? decodeURIComponent(m[1]) : null;
};

// The web player no longer puts the username in requests; its GraphQL answers carry it under
// data.me. Other users (playlist owners) appear elsewhere in the same answers, and deep inside
// data.me (library items), so only the first levels of data.me are trusted.
const userFromResponse = (url, body, text) => {
  let me = null, op = '';
  try { op = JSON.parse(body).operationName; } catch (e) { op = (/[?&]operationName=([^&]+)/.exec(url) || [])[1] || ''; }
  try { me = JSON.parse(text).data.me; } catch (e) {}
  const find = (o, depth) => {
    if (!o || typeof o !== 'object' || depth > 2) return null;
    if (typeof o.username === 'string' && o.username) return o.username;
    for (const k in o) { const v = find(o[k], depth + 1); if (v) return v; }
    return null;
  };
  const name = find(me, 0);
  if (name) log('username from pathfinder', op);
  else if (text.includes('"username"')) log('pathfinder', op, 'has a username outside data.me');
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
