const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const webRoot = path.join(__dirname, '../src/WeddingInvitation/wwwroot');
const html = fs.readFileSync(path.join(webRoot, 'index.html'), 'utf8');
const expected = ['css/app.css', 'css/original.css', 'css/original-blazor.css'];
const links = [...html.matchAll(/<link\b[^>]*>/gi)]
    .filter(match => /\brel="stylesheet"/i.test(match[0]))
    .map(match => /\bhref="([^"]+)"/i.exec(match[0])?.[1]);
const localLinks = links.filter(href => !/^https:\/\//i.test(href || ''));

test('local stylesheets reference the web root in cascade order, not repository directories', () => {
    assert.deepEqual(localLinks, expected);
    for (const href of localLinks) {
        const file = path.join(webRoot, href);
        assert.ok(fs.statSync(file).isFile(), href);
        assert.ok(fs.statSync(file).size > 0, href + ' must not be empty');
    }
});

for (const base of ['/', '/Our-wedding/']) {
    test('stylesheet URLs resolve under the deployment base ' + base, () => {
        assert.equal((html.match(/<base href="\/" \/>/g) || []).length, 1);
        const published = html.replace('<base href="/" />', `<base href="${base}" />`);
        const baseHref = /<base href="([^"]+)"/.exec(published)[1];
        const site = new URL(baseHref, 'https://piranavie.github.io/');
        assert.equal(localLinks.length, expected.length);
        localLinks.forEach((href, index) => {
            const resolved = new URL(href, site);
            assert.equal(resolved.origin, site.origin);
            assert.equal(resolved.pathname, base + expected[index]);
        });
    });
}
