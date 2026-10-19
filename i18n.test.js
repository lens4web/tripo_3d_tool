const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const I = require('./i18n');
const { requestLanguage, renderPage, sitemap } = require('./site');

test('all six languages contain every message and preserve interpolation fields', () => {
    for (const [key, row] of Object.entries(I.rows)) {
        assert.equal(row.length, I.languages.length, key);
        const placeholders = text => [...text.matchAll(/\{([a-zA-Z]+)\}/g)].map(match => match[1]).sort();
        for (const value of row) {
            assert.ok(value.trim(), key);
            assert.deepEqual(placeholders(value), placeholders(row[0]), key);
        }
    }
    const html = fs.readFileSync('index.html', 'utf8');
    for (const match of html.matchAll(/data-i18n(?:-(?:aria-label|alt|placeholder|content))?="([^"]+)"/g)) {
        assert.ok(I.rows[match[1]], match[1]);
    }
    assert.equal(I.detectLanguage(['it-IT', 'ru-RU', 'en']), 'ru');
    assert.equal(I.detectLanguage(['pt-BR']), 'en');
    assert.equal(I.detectLanguage(['zh-Hans-CN']), 'zh');
    assert.equal(requestLanguage(undefined, 'en;q=0.2,ru-RU;q=0.9'), 'ru');
    assert.equal(requestLanguage('fr', 'ru'), 'fr');
    assert.match(I.localizeError('ru', 'Source image is required'), /Нужно изображение/);
});

test('language pages are rendered for crawlers with metadata and real site URLs', () => {
    for (const language of I.languages) {
        const { html } = renderPage(language);
        assert.ok(html.includes(`<html lang="${language}">`));
        assert.ok(html.includes(I.translate(language, 'headline')));
        assert.ok(html.includes(`href="https://tripo3d.lens4web.com/?lang=${language}"`));
        assert.ok(html.includes('property="og:image"'));
        assert.ok(html.includes('https://lens4web.com/'));
        assert.ok(!html.includes('__STRUCTURED_DATA__'));
        const schema = JSON.parse(html.match(/id="structuredData">([^<]+)<\/script>/)[1]);
        const application = schema['@graph'].find(item => item['@type'] === 'WebApplication');
        assert.equal(application.inLanguage, language);
        assert.ok(application.description);
        assert.equal((html.match(/hreflang=/g) || []).length, 7);
    }
    assert.equal(requestLanguage('<script>alert(1)</script>', ''), 'en');
    assert.equal((sitemap().match(/<url>/g) || []).length, 7);
});

function preferences({ languages = ['ru-RU'], dark = true, stored = {}, query = '' } = {}) {
    const listeners = {};
    const mediaListeners = {};
    const storage = new Map(Object.entries(stored));
    const controls = {
        languageSelect: { value: '', addEventListener: (event, fn) => { listeners.language = fn; } },
        themeSelect: { value: '', addEventListener: (event, fn) => { listeners.theme = fn; } }
    };
    const root = { lang: 'en', dataset: {} };
    const media = { matches: dark, addEventListener: (event, fn) => { mediaListeners[event] = fn; } };
    let init;
    let url = `https://tripo3d.lens4web.com/${query}`;
    const context = {
        TripoI18n: I, URL, Event,
        document: { documentElement: root, querySelector: () => null, querySelectorAll: () => [],
            getElementById: id => controls[id], dispatchEvent: () => {},
            addEventListener: (event, fn) => { if (event === 'DOMContentLoaded') init = fn; } },
        localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
        window: { matchMedia: () => media, addEventListener: () => {} },
        navigator: { languages }, location: { href: url }, history: { replaceState: (_, __, value) => { url = value.href; } }
    };
    vm.runInNewContext(fs.readFileSync('preferences.js', 'utf8'), context);
    init();
    return { root, media, mediaListeners, storage, controls, listeners, url: () => url };
}

test('language and theme follow browser/system automatically, with persistent manual overrides', () => {
    const page = preferences();
    assert.equal(page.root.lang, 'ru');
    assert.equal(page.root.dataset.theme, 'dark');
    assert.equal(page.controls.languageSelect.value, 'auto');
    assert.equal(page.controls.themeSelect.value, 'auto');
    page.media.matches = false;
    page.mediaListeners.change();
    assert.equal(page.root.dataset.theme, 'light');
    page.controls.themeSelect.value = 'dark';
    page.listeners.theme();
    assert.equal(page.storage.get('tripo_theme'), 'dark');
    page.mediaListeners.change();
    assert.equal(page.root.dataset.theme, 'dark');
    page.controls.languageSelect.value = 'es';
    page.listeners.language();
    assert.equal(page.root.lang, 'es');
    assert.match(page.url(), /lang=es/);
    page.controls.languageSelect.value = 'auto';
    page.listeners.language();
    assert.equal(page.root.lang, 'ru');
    assert.doesNotMatch(page.url(), /lang=/);
    assert.deepEqual([...page.storage.keys()].sort(), ['tripo_language', 'tripo_theme']);
    const explicit = preferences({ query: '?lang=fr', stored: { tripo_language: 'de' } });
    assert.equal(explicit.root.lang, 'fr');
});
