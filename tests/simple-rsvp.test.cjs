const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = file => fs.readFileSync(path.join(__dirname, '../src/WeddingInvitation', file), 'utf8');

test('RSVP collects only family name, response and attending count', () => {
    const page = read('Components/RsvpPanel.razor');
    assert.match(page, /for="family-name">Family name/);
    assert.match(page, /id="rsvp-status"/);
    assert.match(page, /id="attending-count"/);
    assert.doesNotMatch(page, /PrimaryContactName|\.Members|member-list|contact-name/);
    assert.match(page, /_form.Status == "Accepted" \? _form.AttendingCount : 0/);
    assert.match(page, /RequestId = _requestId/);
    assert.match(page, /_household.LastUpdated/);
});

test('removed member editor has no remaining presentation styles', () => {
    assert.doesNotMatch(read('wwwroot/css/app.css') + read('wwwroot/css/original-blazor.css'), /member-row|member-list/);
});
