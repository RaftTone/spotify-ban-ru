// node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// src/spotify.js is a plain script inlined into the bookmarklet, so its free variables
// (fetch, wait, log) are passed in here instead of being imported.
const code = readFileSync(new URL('../src/spotify.js', import.meta.url), 'utf8');
const load = ({ fetch = async () => { throw new Error('no fetch'); }, waits = [] } = {}) =>
  new Function('fetch', 'wait', 'log', code + '\nreturn { userFromRequest, userFromResponse, writeChunk };')(
    fetch, async (ms) => { waits.push(ms); }, () => {});

const { userFromRequest, userFromResponse } = load();

test('userFromRequest: username query parameter, URL-decoded', () => {
  assert.equal(userFromRequest('https://spclient.wg.spotify.com/x?market=UA&username=alice'), 'alice');
  assert.equal(userFromRequest('https://x/y?username=a%2Bb&z=1'), 'a+b');
});

test('userFromRequest: username in a JSON body or a spotify:user: URI', () => {
  assert.equal(userFromRequest('https://x/write', '{"username": "bob", "set": "artistban"}'), 'bob');
  assert.equal(userFromRequest('https://x/write', '{"uri":"spotify:user:carol"}'), 'carol');
});

test('userFromRequest: username in the path', () => {
  assert.equal(userFromRequest('https://spclient.wg.spotify.com/user-profile-view/v3/profile/dave?market=UA'), 'dave');
  assert.equal(userFromRequest('https://api.spotify.com/users/erin/playlists'), 'erin');
});

test('userFromRequest: placeholders and missing names give null', () => {
  assert.equal(userFromRequest('https://api.spotify.com/users/me/playlists'), null);
  assert.equal(userFromRequest('https://x/user/v1/thing'), null);
  assert.equal(userFromRequest('https://x/y?username=self'), null);
  assert.equal(userFromRequest('https://api.spotify.com/v1/artists/123'), null);
  assert.equal(userFromRequest(undefined, { not: 'a string' }), null);
});

test('userFromResponse: the signed-in user under data.me', () => {
  const text = JSON.stringify({ data: { me: { profile: { name: 'Alice', username: 'alice' } } } });
  assert.equal(userFromResponse('https://api-partner.spotify.com/pathfinder/v2/query', '{"operationName":"profileAttributes"}', text), 'alice');
});

test('userFromResponse: playlist owners outside data.me are ignored', () => {
  const text = JSON.stringify({ data: { playlistV2: { ownerV2: { data: { username: 'bob' } } } } });
  assert.equal(userFromResponse('https://x/pathfinder/v2/query', '{}', text), null);
});

test('userFromResponse: owners deep inside data.me (library items) are ignored', () => {
  const text = JSON.stringify({ data: { me: { libraryV3: { items: [{ item: { data: { ownerV2: { data: { username: 'bob' } } } } }] } } } });
  assert.equal(userFromResponse('https://x/pathfinder/v2/query', '{}', text), null);
});

test('userFromResponse: data.me is trusted two levels down, not three', () => {
  const at = (me) => userFromResponse('https://x/pathfinder/v2/query', '{}', JSON.stringify({ data: { me } }));
  assert.equal(at({ a: { b: { username: 'two' } } }), 'two');
  assert.equal(at({ a: { b: { c: { username: 'three' } } } }), null);
});

test('userFromResponse: non-JSON answers give null', () => {
  assert.equal(userFromResponse('https://x/pathfinder/v1/query?operationName=x', undefined, '<html>'), null);
});

// writeChunk: a fake fetch that answers with the given statuses in turn.
const statuses = (...list) => {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    const s = list.shift();
    if (s instanceof Error) throw s;
    const [status, retryAfter] = Array.isArray(s) ? s : [s];
    return { ok: status >= 200 && status < 300, status, headers: { get: (h) => (h === 'Retry-After' && retryAfter != null ? String(retryAfter) : null) } };
  };
  return { fetch, calls };
};
const AUTH = { token: 'tok', clientToken: 'ct' };

test('writeChunk: sends the ban for the given account and artists', async () => {
  const f = statuses(200);
  assert.equal(await load(f).writeChunk(['A', 'B'], AUTH, 'alice'), true);
  assert.equal(f.calls.length, 1);
  const { url, init } = f.calls[0];
  assert.match(url, /collection\/v2\/write/);
  assert.equal(init.method, 'POST');
  assert.equal(init.headers.Authorization, 'Bearer tok');
  assert.equal(init.headers['client-token'], 'ct');
  assert.deepEqual(JSON.parse(init.body), { username: 'alice', set: 'artistban', items: [{ uri: 'spotify:artist:A' }, { uri: 'spotify:artist:B' }] });
});

test('writeChunk: retries once after a server error or a network failure', async () => {
  let f = statuses(503, 200);
  assert.equal(await load(f).writeChunk(['A'], AUTH, 'alice'), true);
  assert.equal(f.calls.length, 2);
  f = statuses(new Error('offline'), 200);
  assert.equal(await load(f).writeChunk(['A'], AUTH, 'alice'), true);
  assert.equal(f.calls.length, 2);
});

test('writeChunk: client errors are not retried', async () => {
  for (const s of [400, 401, 403, 404]) {
    const f = statuses(s, 200);
    assert.equal(await load(f).writeChunk(['A'], AUTH, 'alice'), false, 'status ' + s);
    assert.equal(f.calls.length, 1, 'status ' + s);
  }
});

test('writeChunk: gives up after two attempts', async () => {
  const f = statuses(429, 429, 200);
  assert.equal(await load(f).writeChunk(['A'], AUTH, 'alice'), false);
  assert.equal(f.calls.length, 2);
});

test('writeChunk: waits Retry-After seconds, 2 s by default, at most 10 s', async () => {
  const run = async (...list) => { const waits = []; await load({ ...statuses(...list), waits }).writeChunk(['A'], AUTH, 'alice'); return waits[0]; };
  assert.equal(await run([429, 3], 200), 3000);
  assert.equal(await run(429, 200), 2000);
  assert.equal(await run([429, 60], 200), 10000);
});
