# Round 5b screenshots (light + dark) of redesigned screens. Needs a local DB seeded with SEED_DEMO=1.
# Usage: python3 scripts/round5b_screens.py BASE photo1.jpg photo2.jpg photo3.jpg
import sys, os
from playwright.sync_api import sync_playwright
BASE = sys.argv[1]; PH = sys.argv[2:]
OUT = 'screenshots/round5'; os.makedirs(OUT, exist_ok=True)
errors = []
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    def ctx(user):
        c = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
        pg = c.new_page(); pg.set_default_timeout(30000); pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.goto(BASE + '/login'); pg.fill('input[autocomplete=username]', user); pg.fill('input[type=password]', 'Connectly123!'); pg.click('button:has-text("Log in")'); pg.wait_for_selector('.bottomnav')
        return c, pg
    def up(pg, path, fields, files):
        return pg.evaluate("""async ([path, fields, files]) => { const fd = new FormData(); for (const [k, v] of Object.entries(fields)) fd.append(k, v);
          for (const [k, b64, type] of files) { const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); fd.append(k, new Blob([bin], { type }), 'f.jpg'); }
          const r = await fetch('/api' + path, { method: 'POST', headers: { 'X-Connectly-CSRF': '1' }, body: fd }); return [r.status, await r.json()]; }""", [path, fields, files])
    import base64
    img = [base64.b64encode(open(f, 'rb').read()).decode() for f in PH]
    cb, pb = ctx('bob')
    pb.evaluate("() => fetch('/api/users/alice/follow', { method: 'PUT', headers: { 'X-Connectly-CSRF': '1' } })")
    up(pb, '/posts', {'body': 'Pool day with the squad! Who is coming next weekend?', 'feeling': 'happy', 'location_tag': 'Lekki, Lagos'}, [['image', img[0], 'image/jpeg']])
    up(pb, '/stories', {'caption': 'Sunday vibes'}, [['image', img[1], 'image/jpeg']])
    ca, pa = ctx('alice')
    pa.evaluate("() => fetch('/api/users/bob/follow', { method: 'PUT', headers: { 'X-Connectly-CSRF': '1' } })")
    up(pa, '/posts', {'body': 'Selfie time with the best people 😄', 'feeling': 'loved'}, [['image', img[2], 'image/jpeg']])
    up(pa, '/posts', {'body': 'Draft: ideas for the weekend meetup', 'as_draft': '1'}, [])
    up(pa, '/stories', {'caption': 'Hello!'}, [['image', img[0], 'image/jpeg']])
    st, pp = up(pa, '/posts', {'body': 'Comment and react to this one'}, [])
    pb.evaluate("async (id) => { const H = { 'X-Connectly-CSRF': '1', 'Content-Type': 'application/json' }; await fetch(`/api/posts/${id}/like`, { method: 'PUT', headers: H, body: JSON.stringify({ reaction: 'love' }) }); await fetch(`/api/posts/${id}/comments`, { method: 'POST', headers: H, body: JSON.stringify({ body: 'Love this!' }) }); }", pp['id'])
    for theme in ['light', 'dark']:
        pa.evaluate("(t) => fetch('/api/me/settings', { method: 'PATCH', headers: { 'X-Connectly-CSRF': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ theme_pref: t }) })", theme)
        shot = lambda n, w=900: (pa.wait_for_timeout(w), pa.screenshot(path=f'{OUT}/{n}-{theme}.png'))
        go = lambda path: pa.goto(BASE + path, wait_until='networkidle')
        go('/'); pa.wait_for_selector('.post'); shot('10-home')
        pa.click('.fakeinput'); pa.wait_for_selector('.composerform'); pa.fill('.composerform textarea', 'Golden hour in Lagos'); pa.click('button.optbtn:has-text("Feeling")'); pa.wait_for_timeout(300); pa.click('.feelgrid .chip >> nth=0'); shot('11-composer')
        pa.keyboard.press('Escape'); go('/')
        pa.locator('.post').first.locator('button[aria-label="Post options"]').click(); shot('12-post-menu', 500)
        pa.click('.menu button:has-text("Delete post")'); shot('13-delete-confirm', 600)
        go('/'); pa.locator('.post').nth(1).locator('.reactmore').click(); shot('14-reactions', 600)
        go('/me/drafts'); shot('15-drafts')
        go('/notifications'); shot('16-notifications')
        go('/search'); shot('17-search')
        go('/u/alice'); shot('18-profile')
        go('/market'); shot('19-marketplace')
        go('/settings'); shot('20-settings-appearance')
    pa.evaluate("() => fetch('/api/me/settings', { method: 'PATCH', headers: { 'X-Connectly-CSRF': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ theme_pref: 'light' }) })")
    pa.goto(BASE + '/', wait_until='networkidle'); pa.click('.fakeinput'); pa.click('button.optbtn:has-text("Camera")'); pa.wait_for_selector('.studiomenu'); pa.wait_for_timeout(500); pa.screenshot(path=f'{OUT}/21-studio-menu.png')
    pa.set_input_files('.studiomenu input[type=file]', PH[2]); pa.wait_for_selector('.editor'); pa.wait_for_timeout(800); pa.screenshot(path=f'{OUT}/22-editor-filters.png')
    pa.click('.edtabs button:has-text("Adjust")'); pa.wait_for_timeout(300); pa.screenshot(path=f'{OUT}/23-editor-adjust.png')
    pa.click('.edtabs button:has-text("Stickers")'); pa.click('.stickergrid button >> nth=2'); pa.click('.edtabs button:has-text("Text")'); pa.fill('.edpanel input', 'Weekend!'); pa.click('.edpanel button:has-text("Add")'); pa.wait_for_timeout(300); pa.screenshot(path=f'{OUT}/24-editor-text-stickers.png')
    pa.click('.studiohead button[aria-label=Back]'); pa.click('button.studiobig:has-text("Avatar")'); pa.wait_for_selector('.avatarmaker'); pa.wait_for_timeout(400); pa.screenshot(path=f'{OUT}/25-avatar-maker.png')
    pa.goto(BASE + '/', wait_until='networkidle'); pa.click('.story >> nth=1'); pa.wait_for_selector('.storyview img'); pa.wait_for_timeout(1200); pa.screenshot(path=f'{OUT}/26-story-viewer.png')
    b.close()
print('errors:', errors)
