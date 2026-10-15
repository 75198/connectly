# Round 5 mobile screenshots (hero, welcome, reels feed, reel upload). Needs a local DB seeded with SEED_DEMO=1.
# Usage: python3 scripts/round5_screens.py [BASE] [video1.mp4 video2.mp4]
import sys, os
from playwright.sync_api import sync_playwright
BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:3000'
VIDS = sys.argv[2:] or ['web/public/media/hero.mp4']
OUT = 'screenshots/round5'; os.makedirs(OUT, exist_ok=True)
errors = []
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox', '--autoplay-policy=no-user-gesture-required'])
    c = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    pg = c.new_page(); pg.set_default_timeout(60000)
    pg.on('pageerror', lambda e: errors.append(str(e)))
    shot = lambda n, w=900: (pg.wait_for_timeout(w), pg.screenshot(path=f'{OUT}/{n}.png'))
    pg.goto(BASE + '/', wait_until='networkidle'); pg.wait_for_selector('.hero'); shot('01-hero', 2500)
    pg.click('text=Create account'); pg.wait_for_selector('.flowtitle'); shot('02-signup-first-screen')
    pg.goto(BASE + '/login', wait_until='networkidle'); pg.fill('input[autocomplete=username]', 'alice'); pg.fill('input[type=password]', 'Connectly123!'); pg.click('button:has-text("Log in")')
    pg.wait_for_selector('.bottomnav'); shot('03-home-with-reels-entry')
    for i, v in enumerate(VIDS):
        pg.goto(BASE + '/reels/new', wait_until='networkidle'); pg.set_input_files('input[type=file]', v); pg.fill('textarea', ['Friday night with the crew', 'Pool day!'][i % 2])
        if i == 0: shot('04-reel-upload', 1500)
        pg.click('button:has-text("Share reel")'); pg.wait_for_selector('.reel video', timeout=120000)
    pg.goto(BASE + '/reels', wait_until='networkidle'); pg.wait_for_selector('.reel video'); shot('05-reels-feed', 3000)
    pg.goto(BASE + '/compose', wait_until='networkidle'); shot('06-create-menu')
    pg.evaluate("() => sessionStorage.setItem('cx-show-welcome', '1')"); pg.goto(BASE + '/', wait_until='networkidle'); pg.wait_for_selector('.welcome'); shot('07-welcome', 2200)
    b.close()
print('errors:', errors)
