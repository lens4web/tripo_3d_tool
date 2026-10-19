const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createApp, allowedDownloadUrl } = require('./server');

async function serve(t, app) {
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
    t.after(() => { app.locals.dispose(); return new Promise(resolve => server.close(resolve)); });
    return `http://127.0.0.1:${server.address().port}`;
}
async function connect(origin, apiKey = 'test-key', headers = {}) {
    const response = await fetch(`${origin}/api/session`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ apiKey }) });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).data.connected, true);
    const cookie = response.headers.get('set-cookie');
    if (cookie.startsWith('__Host-')) {
        assert.match(cookie, /; Secure(?:;|$)/);
        assert.match(cookie, /; Path=\//);
        assert.doesNotMatch(cookie, /; Domain=/i);
    }
    return { Origin: headers.Origin || origin, ...headers, Cookie: cookie.split(';')[0] };
}

function localRequest(url, headers = {}) {
    return new Promise((resolve, reject) => {
        http.get(url, { headers }, res => {
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
            res.on('error', reject);
        }).on('error', reject);
    });
}

test('API proxy preserves V3 JSON and multipart bodies and strips site credentials', async t => {
    const upstream = http.createServer((req, res) => {
        const chunks = [];
        req.on('data', chunk => chunks.push(chunk));
        req.on('end', () => {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ path: req.url, method: req.method, headers: req.headers, body: Buffer.concat(chunks).toString() }));
        });
    });
    await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => upstream.close(resolve)));
    const origin = await serve(t, createApp({ apiBase: `http://127.0.0.1:${upstream.address().port}/v3` }));
    const key = await connect(origin);
    const body = JSON.stringify({ input: 'file_token', model: 'default' });
    const response = await fetch(`${origin}/api/v3/generation/image-to-multiview`, {
        method: 'POST', headers: { ...key, 'Content-Type': 'application/json', Authorization: 'Basic site-password', Cookie: key.Cookie + '; private=private-cookie' }, body
    });
    const result = await response.json();
    assert.equal(result.path, '/v3/generation/image-to-multiview');
    assert.equal(result.method, 'POST');
    assert.equal(result.body, body);
    assert.equal(result.headers.authorization, 'Bearer test-key');
    assert.equal(result.headers.cookie, undefined);
    assert.equal(result.headers['x-tripo-key'], undefined);
    const form = new FormData();
    form.append('file', new Blob(['image-bytes'], { type: 'image/png' }), 'image.png');
    const upload = await (await fetch(`${origin}/api/v3/files`, { method: 'POST', headers: key, body: form })).json();
    assert.match(upload.headers['content-type'], /^multipart\/form-data; boundary=/);
    assert.match(upload.body, /image-bytes/);
    assert.match(upload.body, /filename="image.png"/);
    const query = await (await fetch(`${origin}/api/v3/tasks/test-id`, { headers: key })).json();
    assert.equal(query.path, '/v3/tasks/test-id');
    assert.equal(query.method, 'GET');
    const second = await connect(origin, 'another-key');
    const secondQuery = await (await fetch(`${origin}/api/v3/tasks/test-id`, { headers: second })).json();
    assert.equal(secondQuery.headers.authorization, 'Bearer another-key');
    assert.equal((await (await fetch(`${origin}/api/v3/tasks/test-id`, { headers: key })).json()).headers.authorization, 'Bearer test-key');
});

test('only public assets are served with restrictive headers', async t => {
    const origin = await serve(t, createApp());
    for (const asset of ['/', '/styles.css', '/app.js', '/pipeline.js', '/healthz']) {
        assert.equal((await fetch(origin + asset)).status, 200);
    }
    for (const asset of ['/data.json', '/.env', '/package.json', '/server.js', '/.git/config']) {
        assert.equal((await fetch(origin + asset)).status, 404);
    }
    const headers = (await fetch(origin)).headers;
    assert.equal(headers.get('x-powered-by'), null);
    assert.equal(headers.get('x-content-type-options'), 'nosniff');
    assert.equal(headers.get('referrer-policy'), 'no-referrer');
    assert.equal(headers.get('cache-control'), 'no-store');
    assert.match(headers.get('content-security-policy'), /script-src 'self'/);
    assert.match(headers.get('content-security-policy'), /frame-ancestors 'none'/);
    assert.doesNotMatch(headers.get('content-security-policy'), /unsafe-inline|upgrade-insecure-requests/);
});

test('API rejects absent keys, unapproved routes, cross-site requests and oversized bodies', async t => {
    const origin = await serve(t, createApp());
    assert.equal((await fetch(`${origin}/api/v3/tasks/id`)).status, 401);
    const key = await connect(origin);
    assert.equal((await fetch(`${origin}/api/v3/account/balance`, { headers: key })).status, 404);
    assert.equal((await fetch(`${origin}/api/v3/tasks/id`, { headers: { ...key, Origin: 'https://evil.test' } })).status, 403);
    assert.equal((await fetch(`${origin}/api/download?url=bad`, { headers: { ...key, 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
    assert.equal((await fetch(`${origin}/api/v3/models/convert`, { method: 'POST', headers: key, body: 'not-json' })).status, 415);
    assert.equal((await fetch(`${origin}/api/v3/models/convert`, { method: 'POST', headers: { ...key, 'Content-Type': 'application/json' }, body: 'x'.repeat(1024 * 1024 + 1) })).status, 413);
    assert.equal((await localRequest(origin, { Host: 'attacker.test' })).status, 403);
});

test('production requires HTTPS origin and accepts same-origin requests behind local nginx', async t => {
    assert.throws(() => createApp({ production: true, publicOrigin: undefined }), /PUBLIC_ORIGIN/);
    assert.throws(() => createApp({ production: true, publicOrigin: 'http://example.com' }), /PUBLIC_ORIGIN/);
    const origin = await serve(t, createApp({ production: true, publicOrigin: 'https://tripo.example.com' }));
    const headers = { Host: 'tripo.example.com', Origin: 'https://tripo.example.com', 'X-Forwarded-Proto': 'https' };
    const response = await fetch(origin, { headers });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('strict-transport-security'), /max-age=31536000/);
    assert.match(response.headers.get('content-security-policy'), /upgrade-insecure-requests/);
    const key = await connect(origin, 'test-key', headers);
    assert.equal((await fetch(`${origin}/api/download?url=bad`, { headers: key })).status, 400);
});

test('download allowlist rejects SSRF and executable payloads are forced to attachment', async t => {
    const origin = await serve(t, createApp());
    const key = await connect(origin);
    for (const url of ['http://127.0.0.1/private', 'https://cdn.tripo3d.ai.evil.test/a', 'https://user:pass@cdn.tripo3d.ai/a', 'https://cdn.tripo3d.ai:444/a']) {
        assert.equal(allowedDownloadUrl(url), null);
        assert.equal((await fetch(`${origin}/api/download?url=${encodeURIComponent(url)}`, { headers: key })).status, 400);
    }
    assert.ok(allowedDownloadUrl('https://tripo-data.rg1.data.tripo3d.com/model.jpeg?Signature=abc'));
    const originalFetch = global.fetch;
    try {
        let calls = 0;
        global.fetch = async () => {
            calls++;
            return new Response('', { status: 302, headers: { Location: 'http://127.0.0.1/private' } });
        };
        const target = `${origin}/api/download?url=${encodeURIComponent('https://cdn.tripo3d.ai/model.glb')}`;
        assert.equal((await localRequest(target, key)).status, 502);
        assert.equal(calls, 1);
        global.fetch = async () => new Response('<script>evil()</script>', { headers: { 'Content-Type': 'text/html' } });
        const download = await localRequest(target, key);
        assert.equal(download.status, 200);
        assert.equal(download.headers['content-type'], 'application/octet-stream');
        assert.equal(download.headers['content-disposition'], 'attachment');
        global.fetch = async () => new Response('large-file', { headers: { 'Content-Length': String(151 * 1024 * 1024) } });
        assert.equal((await localRequest(target, key)).status, 413);
    } finally { global.fetch = originalFetch; }
});

test('excess requests are rate-limited', async t => {
    const origin = await serve(t, createApp({ requestLimit: 2 }));
    const key = await connect(origin);
    assert.equal((await fetch(`${origin}/api/download?url=bad`, { headers: key })).status, 400);
    const response = await fetch(`${origin}/api/download?url=bad`, { headers: key });
    assert.equal(response.status, 429);
    assert.ok(response.headers.get('ratelimit'));
});


test('sessions store keys only server-side and revoke them on disconnect', async t => {
    const origin = await serve(t, createApp());
    const response = await fetch(`${origin}/api/session`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ apiKey: 'private-key' }) });
    const cookie = response.headers.get('set-cookie');
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    assert.doesNotMatch(cookie, /private-key/);
    assert.doesNotMatch(await response.text(), /private-key/);
    const headers = { Cookie: cookie.split(';')[0], Origin: origin };
    assert.equal((await (await fetch(`${origin}/api/session`, { headers })).json()).data.connected, true);
    assert.equal((await fetch(`${origin}/api/session`, { method: 'DELETE', headers })).status, 200);
    assert.equal((await (await fetch(`${origin}/api/session`, { headers })).json()).data.connected, false);
    assert.equal((await fetch(`${origin}/api/download?url=bad`, { headers })).status, 401);
    assert.equal((await fetch(`${origin}/api/session`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"apiKey":"key"}' })).status, 403);
});

test('sessions persist without timer expiry until user revokes them, and production cookies are Secure', async t => {
    let clock = 0;
    const origin = await serve(t, createApp({ now: () => clock }));
    const key = await connect(origin);
    // Advancing time should not expire the session
    clock += 100 * 24 * 60 * 60 * 1000;
    assert.equal((await (await fetch(`${origin}/api/session`, { headers: key })).json()).data.connected, true);
    // User can disconnect and revoke at any time
    assert.equal((await fetch(`${origin}/api/session`, { method: 'DELETE', headers: { ...key, Origin: origin } })).status, 200);
    assert.equal((await (await fetch(`${origin}/api/session`, { headers: key })).json()).data.connected, false);

    const prod = await serve(t, createApp({ production: true, publicOrigin: 'https://tripo3d.lens4web.com', now: () => clock }));
    const headers = { Origin: 'https://tripo3d.lens4web.com', 'X-Forwarded-Proto': 'https' };
    const secure = await connect(prod, 'secure-key', headers);
    assert.match(secure.Cookie, /^__Host-tripo_session=/);
    for (let i = 0; i < 5; i++) {
        clock += 50 * 60 * 1000;
        const state = await (await fetch(`${prod}/api/session`, { headers: secure })).json();
        assert.equal(state.data.connected, true);
    }
});

test('public SEO assets and localized HTML are available without an API key', async t => {
    const crypto = require('node:crypto');
    const origin = await serve(t, createApp());
    for (const asset of ['/favicon.ico', '/assets/icon.svg', '/assets/social-card.png', '/assets/apple-touch-icon.png', '/site.webmanifest', '/robots.txt', '/sitemap.xml', '/i18n.js', '/preferences.js']) {
        assert.equal((await fetch(origin + asset)).status, 200, asset);
    }
    const response = await fetch(`${origin}/?lang=ru`);
    const html = await response.text();
    assert.equal(response.headers.get('content-language'), 'ru');
    assert.match(html, /Подарите персонажу объём/);
    const structured = html.match(/id="structuredData">([^<]+)<\/script>/)[1];
    const hash = crypto.createHash('sha256').update(structured).digest('base64');
    assert.ok(response.headers.get('content-security-policy').includes(`'sha256-${hash}'`));
    assert.match(await (await fetch(`${origin}/robots.txt`)).text(), /Disallow: \/api\//);
    const automatic = await fetch(origin, { headers: { 'Accept-Language': 'de-DE,de;q=0.9' } });
    assert.equal(automatic.headers.get('content-language'), 'de');
});
