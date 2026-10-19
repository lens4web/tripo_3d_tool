'use strict';

const express = require('express');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const { Readable, Transform, pipeline } = require('node:stream');
const path = require('node:path');
const crypto = require('node:crypto');
const { allowedResultUrl } = require('./pipeline');
const { SITE_ORIGIN, requestLanguage, renderPage, sitemap } = require('./site');

function createApp(options = {}) {
    const production = options.production ?? process.env.NODE_ENV === 'production';
    const publicOrigin = options.publicOrigin ?? process.env.PUBLIC_ORIGIN;
    if (production && (!publicOrigin || !/^https:\/\//.test(publicOrigin))) {
        throw new Error('Production requires PUBLIC_ORIGIN=https://your-subdomain.example.com');
    }
    const expectedOrigin = publicOrigin ? new URL(publicOrigin).origin : null;
    const apiBase = options.apiBase ?? (production ? 'https://openapi.tripo3d.ai/v3' : process.env.TRIPO_API_BASE || 'https://openapi.tripo3d.ai/v3');
    const app = express();
    const sessions = new Map();
    const cookieName = production ? '__Host-tripo_session' : 'tripo_session';
    const now = options.now ?? Date.now;
    function currentSession(req) {
        const token = (req.get('cookie') || '').split(';').map(part => part.trim())
            .find(part => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
        if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
        const session = sessions.get(token);
        if (!session) return null;
        return { token, ...session };
    }
    function setSessionCookie(res, token) {
        res.set('Set-Cookie', `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict${production ? '; Secure' : ''}${token ? '' : '; Max-Age=0'}`);
    }
    app.disable('x-powered-by');
    // Only the local nginx reverse proxy may supply the client IP/protocol.
    if (production) app.set('trust proxy', 'loopback');
    app.use(helmet({
        contentSecurityPolicy: { directives: {
            defaultSrc: ["'self'"], scriptSrc: ["'self'", 'https://pulse.lens4web.com/app-script'], styleSrc: ["'self'"],
            imgSrc: ["'self'", 'blob:', 'data:'], connectSrc: ["'self'", 'https://pulse.lens4web.com'],
            objectSrc: ["'none'"], frameAncestors: ["'none'"],
            formAction: ["'self'"], baseUri: ["'none'"],
            upgradeInsecureRequests: production ? [] : null
        } },
        referrerPolicy: { policy: 'no-referrer' },
        strictTransportSecurity: production ? { maxAge: 31536000 } : false
    }));
    app.use((req, res, next) => {
        res.set('Cache-Control', 'no-store');
        res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
        const hostname = req.hostname;
        const validHost = production
            ? hostname === new URL(expectedOrigin).hostname || ['127.0.0.1', 'localhost', '[::1]'].includes(hostname)
            : ['127.0.0.1', 'localhost', '[::1]'].includes(hostname);
        if (!validHost) return res.status(403).json({ code: -1, message: 'Unrecognized host' });
        next();
    });
    app.get('/healthz', (req, res) => res.json({ status: 'ok' }));
    app.use('/api', (req, res, next) => {
        const origin = req.get('origin');
        const allowedOrigin = expectedOrigin || `${req.protocol}://${req.get('host')}`;
        if ((origin && origin !== allowedOrigin) || (!['GET', 'HEAD'].includes(req.method) && origin !== allowedOrigin) || req.get('sec-fetch-site') === 'cross-site') {
            return res.status(403).json({ code: -1, message: 'Cross-site requests are not allowed' });
        }
        next();
    });
    const limitOptions = { standardHeaders: 'draft-8', legacyHeaders: false,
        message: { code: -1, message: 'Too many requests; please wait and try again' } };
    app.use('/api', rateLimit({ ...limitOptions, windowMs: 60000, limit: options.requestLimit ?? 180 }));
    app.get('/api/session', (req, res) => res.json({ code: 0, data: { connected: !!currentSession(req) } }));
    app.post('/api/session', rateLimit({ ...limitOptions, windowMs: 900000, limit: 20 }),
        express.json({ limit: '1kb', inflate: false }), (req, res) => {
            const apiKey = typeof req.body?.apiKey === 'string' ? req.body.apiKey.trim() : '';
            if (!apiKey || apiKey.length > 256 || !/^[\x21-\x7E]+$/.test(apiKey)) {
                return res.status(400).json({ code: -1, message: 'Enter a valid API key format' });
            }
            const previous = currentSession(req);
            if (!previous && sessions.size >= 500) return res.status(503).json({ code: -1, message: 'Session capacity reached; try again later' });
            if (previous) sessions.delete(previous.token);
            const token = crypto.randomBytes(32).toString('hex');
            sessions.set(token, { apiKey, createdAt: now() });
            setSessionCookie(res, token);
            res.json({ code: 0, data: { connected: true } });
        });
    app.delete('/api/session', (req, res) => {
        const session = currentSession(req);
        if (session) sessions.delete(session.token);
        setSessionCookie(res, '');
        res.json({ code: 0, data: { connected: false } });
    });
    app.locals.dispose = () => { sessions.clear(); };
    app.use('/api', (req, res, next) => {
        const session = currentSession(req);
        if (!session) return res.status(401).json({ code: -1, message: 'Session expired; apply your API key again' });
        req.tripoSession = session;
        next();
    });
    const generationLimit = rateLimit({ ...limitOptions, windowMs: 300000, limit: 25 });
    app.use('/api/v3', (req, res, next) => {
        const isQuery = req.method === 'GET' && /^\/tasks\/[a-zA-Z0-9_-]{1,100}$/.test(req.path);
        const isCreate = req.method === 'POST' && [
            '/files', '/generation/image-to-image', '/generation/image-to-multiview',
            '/generation/image-to-model', '/generation/multiview-to-model',
            '/models/convert', '/models/texture',
            '/animations/rig-check', '/animations/rig', '/animations/retarget',
            '/mesh/uv', '/mesh/decimate'
        ].includes(req.path);
        if (!isQuery && !isCreate) return res.status(404).json({ code: -1, message: 'Unsupported API route' });
        if (isCreate) {
            const type = req.get('content-type') || '';
            const expected = req.path === '/files' ? /^multipart\/form-data;.*boundary=/i : /^application\/json(?:;|$)/i;
            if (!expected.test(type)) return res.status(415).json({ code: -1, message: 'Unsupported content type' });
            return generationLimit(req, res, next);
        }
        next();
    });
    app.use('/api/v3', (req, res, next) => {
        if (req.method !== 'POST') return next();
        express.raw({ type: () => true, limit: req.path === '/files' ? '21mb' : '1mb', inflate: false })(req, res, next);
    });
    app.use('/api/v3', async (req, res) => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 120000);
        res.on('close', () => controller.abort());
        try {
            const headers = { Authorization: `Bearer ${req.tripoSession.apiKey}` };
            if (req.method === 'POST') headers['Content-Type'] = req.get('content-type');
            // Never forward site login credentials, cookies, or arbitrary client headers.
            const upstream = await fetch(`${apiBase}${req.url}`, {
                method: req.method, headers, redirect: 'error',
                body: req.method === 'POST' ? req.body : undefined, signal: controller.signal
            });
            res.status(upstream.status).type('application/json');
            if (!upstream.body) return res.end();
            pipeline(Readable.fromWeb(upstream.body), byteLimiter(2 * 1024 * 1024), res, error => {
                clearTimeout(timeout);
                if (error && !res.destroyed) res.destroy();
            });
        } catch {
            if (!res.headersSent && !res.destroyed) res.status(502).json({ code: -1, message: 'Tripo API is temporarily unavailable' });
        } finally {
            if (res.writableEnded || res.destroyed) clearTimeout(timeout);
        }
    });
    let activeDownloads = 0;
    app.get('/api/download', async (req, res) => {
        let url = allowedResultUrl(req.query.url);
        if (!url) return res.status(400).send('Unsupported download URL');
        if (activeDownloads >= 6) return res.status(503).send('Downloads are busy; please try again shortly');
        activeDownloads++;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 180000);
        res.on('close', () => controller.abort());
        let released = false;
        const release = () => {
            if (released) return;
            released = true;
            activeDownloads--;
            clearTimeout(timeout);
        };
        res.on('close', release);
        try {
            let upstream;
            for (let redirect = 0; redirect <= 3; redirect++) {
                upstream = await fetch(url, { redirect: 'manual', signal: controller.signal });
                if (![301, 302, 303, 307, 308].includes(upstream.status)) break;
                await upstream.body?.cancel();
                const location = upstream.headers.get('location');
                url = location && allowedResultUrl(new URL(location, url).href);
                if (!url) return res.status(502).send('Unsupported download redirect');
                if (redirect === 3) return res.status(502).send('Too many download redirects');
            }
            const maximum = 150 * 1024 * 1024;
            if (!upstream.ok || !upstream.body) return res.status(502).send('Download unavailable');
            if (Number(upstream.headers.get('content-length')) > maximum) {
                await upstream.body.cancel();
                return res.status(413).send('Download exceeds 150 MB');
            }
            const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
            // Do not serve executable HTML/SVG/JS from the app origin.
            res.type(/^image\/(png|jpeg|webp)(;|$)/i.test(contentType) ? contentType : 'application/octet-stream');
            res.set('Content-Disposition', 'attachment');
            pipeline(Readable.fromWeb(upstream.body), byteLimiter(maximum), res, error => {
                release();
                if (error && !res.destroyed) res.destroy();
            });
        } catch {
            if (!res.headersSent && !res.destroyed) res.status(502).send('Download unavailable');
        } finally {
            if (res.writableEnded || res.destroyed) release();
        }
    });
    app.get(['/', '/index.html'], (req, res) => {
        const language = requestLanguage(req.query.lang, req.get('accept-language'));
        const page = renderPage(language);
        const csp = res.get('Content-Security-Policy');
        res.set('Content-Security-Policy', csp.replace("script-src 'self'", `script-src 'self' 'sha256-${page.scriptHash}'`));
        res.set('Content-Language', language).vary('Accept-Language').type('html').send(page.html);
    });
    app.get('/robots.txt', (req, res) => res.type('text').send(`User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: ${SITE_ORIGIN}/sitemap.xml\n`));
    app.get('/sitemap.xml', (req, res) => res.type('application/xml').send(sitemap()));
    const assets = ['icon.svg', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'social-card.png'];
    for (const filename of ['styles.css', 'pipeline.js', 'app.js', 'i18n.js', 'preferences.js', 'favicon.ico', 'site.webmanifest', ...assets.map(name => `assets/${name}`)]) {
        app.get(`/${filename}`, (req, res) => {
            res.sendFile(path.join(__dirname, filename));
        });
    }
    app.use((req, res) => res.status(404).json({ code: -1, message: 'Not found' }));
    app.use((error, req, res, next) => {
        if (res.headersSent) return next(error);
        const status = error.type === 'entity.too.large' ? 413 : error.status === 415 ? 415 : error.status === 400 ? 400 : 500;
        res.status(status).json({ code: -1, message: status === 413 ? 'Request exceeds size limit' : status === 415 ? 'Unsupported content encoding' : status === 400 ? 'Invalid JSON request' : 'Request could not be processed' });
    });
    return app;
}

function byteLimiter(maximum) {
    let bytes = 0;
    return new Transform({
        transform(chunk, encoding, callback) {
            bytes += chunk.length;
            callback(bytes > maximum ? new Error('Response exceeds size limit') : null, chunk);
        }
    });
}

if (require.main === module) {
    const host = process.env.HOST || '127.0.0.1';
    if (host !== '127.0.0.1') throw new Error('HOST must be 127.0.0.1; expose the app through nginx');
    const port = Number(process.env.PORT || 3000);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
    const server = createApp().listen(port, host, () => console.log(`Tripo workspace: http://${host}:${port}`));
    server.requestTimeout = 120000;
    server.headersTimeout = 15000;
    for (const signal of ['SIGTERM', 'SIGINT']) {
        process.once(signal, () => {
            server.close(() => process.exit(0));
            setTimeout(() => process.exit(1), 10000).unref();
        });
    }
}
module.exports = { createApp, allowedDownloadUrl: allowedResultUrl };
