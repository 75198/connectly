# Profile hub screenshots (light + dark, 390x844) with seeded demo account "alice". Usage: python3 scripts/hub_screens.py BASE OUTDIR PREFIX
import sys, os
from playwright.sync_api import sync_playwright
BASE, OUT, PRE = sys.argv[1], sys.argv[2], sys.argv[3]; os.makedirs(OUT, exist_ok=True)
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    c = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    pg = c.new_page(); pg.set_default_timeout(30000)
    pg.goto(BASE + '/login'); pg.fill('input[autocomplete=username]', 'alice'); pg.fill('input[type=password]', 'Connectly123!'); pg.click('button:has-text("Log in")'); pg.wait_for_selector('.bottomnav')
    for theme in ['light', 'dark']:
        pg.evaluate("(t) => fetch('/api/me/settings', { method: 'PATCH', headers: { 'X-Connectly-CSRF': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ theme_pref: t }) })", theme)
        for path, n in [('/me', 'profile-hub'), ('/', 'home'), ('/search', 'search')] + ([('/settings/text-size', 'text-size')] if PRE == 'after' else []):
            pg.goto(BASE + path, wait_until='networkidle'); pg.wait_for_timeout(900); pg.screenshot(path=f'{OUT}/{PRE}-{n}-{theme}.png')
    b.close()
