'use strict';
(function () {
    const I = TripoI18n;
    const root = document.documentElement;
    const read = key => { try { return localStorage.getItem(key); } catch { return null; } };
    const save = (key, value) => { try { localStorage.setItem(key, value); } catch {} };
    const urlLanguage = new URL(location.href).searchParams.get('lang');
    const storedLanguage = read('tripo_language');
    let languageMode = I.languages.includes(urlLanguage) ? urlLanguage : I.languages.includes(storedLanguage) ? storedLanguage : 'auto';
    let themeMode = ['light', 'dark'].includes(read('tripo_theme')) ? read('tripo_theme') : 'auto';
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const effectiveLanguage = () => languageMode === 'auto' ? I.detectLanguage(navigator.languages || [navigator.language]) : languageMode;
    function applyTheme() {
        root.dataset.theme = themeMode === 'auto' ? (media.matches ? 'dark' : 'light') : themeMode;
        const meta = document.querySelector('meta[name="theme-color"]');
        if (meta) meta.content = root.dataset.theme === 'dark' ? '#101c19' : '#f5f6f6';
    }
    root.lang = effectiveLanguage();
    applyTheme();
    media.addEventListener('change', () => { if (themeMode === 'auto') applyTheme(); });
    function applyLanguage(notify = true) {
        const language = effectiveLanguage();
        root.lang = language;
        document.querySelectorAll('[data-i18n]').forEach(node => {
            let values = {};
            try { values = JSON.parse(node.dataset.i18nValues || '{}'); } catch {}
            values = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value && typeof value === 'object' && value.key ? I.translate(language, value.key) : value]));
            node.textContent = (node.dataset.i18nPrefix || '') + I.translate(language, node.dataset.i18n, values);
        });
        for (const attribute of ['aria-label', 'alt', 'placeholder', 'content']) {
            document.querySelectorAll(`[data-i18n-${attribute}]`).forEach(node => {
                node.setAttribute(attribute, I.translate(language, node.getAttribute(`data-i18n-${attribute}`)));
            });
        }
        const canonical = document.querySelector('link[rel="canonical"]');
        const pageUrl = `https://tripo3d.lens4web.com/?lang=${language}`;
        if (canonical) canonical.href = pageUrl;
        const ogUrl = document.querySelector('meta[property="og:url"]');
        if (ogUrl) ogUrl.content = pageUrl;
        const ogLocale = document.querySelector('meta[property="og:locale"]');
        if (ogLocale) ogLocale.content = I.locales[language];
        const selector = document.getElementById('languageSelect');
        if (selector) selector.value = languageMode;
        if (notify) document.dispatchEvent(new Event('tripo-language-change'));
    }
    function initialize() {
        applyLanguage(false);
        const languageSelect = document.getElementById('languageSelect');
        const themeSelect = document.getElementById('themeSelect');
        themeSelect.value = themeMode;
        languageSelect.addEventListener('change', () => {
            languageMode = languageSelect.value;
            save('tripo_language', languageMode);
            const url = new URL(location.href);
            if (languageMode === 'auto') url.searchParams.delete('lang');
            else url.searchParams.set('lang', languageMode);
            history.replaceState(null, '', url);
            applyLanguage();
        });
        themeSelect.addEventListener('change', () => {
            themeMode = themeSelect.value;
            save('tripo_theme', themeMode);
            applyTheme();
        });
        window.addEventListener('languagechange', () => { if (languageMode === 'auto') applyLanguage(); });
    }
    document.addEventListener('DOMContentLoaded', initialize);
})();
