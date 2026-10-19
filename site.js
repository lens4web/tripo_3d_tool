'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const I = require('./i18n');
const SITE_ORIGIN = 'https://tripo3d.lens4web.com';
const template = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
function requestLanguage(query, header = '') {
    if (I.languages.includes(query)) return query;
    const candidates = header.split(',').map(value => {
        const [tag, quality] = value.trim().split(';q=');
        return { tag, quality: quality === undefined ? 1 : Number(quality) };
    }).filter(item => item.quality > 0).sort((a, b) => b.quality - a.quality);
    return I.detectLanguage(candidates.map(item => item.tag));
}
function renderPage(language) {
    const t = (key, values) => I.translate(language, key, values);
    let html = template.replace('<html lang="en">', `<html lang="${language}">`);
    html = html.replace(/<([a-z][a-z0-9]*)\b([^>]*\bdata-i18n="([^"]+)"[^>]*)>([^<]*)<\/\1>/gi,
        (whole, tag, attrs, key) => {
            const prefix = attrs.match(/data-i18n-prefix="([^"]*)"/)?.[1] || '';
            return `<${tag}${attrs}>${escapeHtml(prefix + t(key))}</${tag}>`;
        });
    for (const attribute of ['aria-label', 'alt', 'placeholder', 'content']) {
        const regex = new RegExp(`<[^>]+data-i18n-${attribute}="([^"]+)"[^>]*>`, 'g');
        html = html.replace(regex, (whole, key) => whole.replace(new RegExp(`(${attribute}=")[^"]*(")`), `$1${escapeHtml(t(key))}$2`));
    }
    const pageUrl = `${SITE_ORIGIN}/?lang=${language}`;
    html = html.replace(/(<link rel="canonical" href=")[^"]+/, `$1${pageUrl}`)
        .replace(/(<meta property="og:url" content=")[^"]+/, `$1${pageUrl}`)
        .replace(/(<meta property="og:locale" content=")[^"]+/, `$1${I.locales[language]}`);
    const structured = JSON.stringify({
        '@context': 'https://schema.org', '@graph': [
            { '@type': 'WebSite', '@id': `${SITE_ORIGIN}/#website`, name: 'Tripo 3D Tool by Lens4web', url: `${SITE_ORIGIN}/`, publisher: { '@id': 'https://lens4web.com/#organization' } },
            { '@type': 'Organization', '@id': 'https://lens4web.com/#organization', name: 'Lens4web', url: 'https://lens4web.com/' },
            { '@type': 'WebApplication', '@id': `${SITE_ORIGIN}/#app`, name: 'Tripo 3D Tool', url: pageUrl, description: t('seoDescription'), inLanguage: language, applicationCategory: 'MultimediaApplication', operatingSystem: 'Web browser', author: { '@id': 'https://lens4web.com/#organization' }, image: `${SITE_ORIGIN}/assets/social-card.png` }
        ]
    }).replace(/</g, '\\u003c');
    html = html.replace('__STRUCTURED_DATA__', structured);
    const scriptHash = crypto.createHash('sha256').update(structured).digest('base64');
    return { html, scriptHash };
}
function sitemap() {
    return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${SITE_ORIGIN}/</loc></url>${I.languages.map(language => `<url><loc>${SITE_ORIGIN}/?lang=${language}</loc></url>`).join('')}</urlset>`;
}
module.exports = { SITE_ORIGIN, requestLanguage, renderPage, sitemap };
