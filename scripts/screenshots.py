# Usage: python3 scripts/screenshots.py [BASE_URL]  -> screenshots/*.png
import sys, os
from playwright.sync_api import sync_playwright
BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:3000'
os.makedirs('screenshots', exist_ok=True)
errors = []
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    for tag, vp, mobile in [('mobile', {'width': 390, 'height': 844}, True), ('desktop', {'width': 1280, 'height': 800}, False)]:
        c = b.new_context(viewport=vp, device_scale_factor=2 if mobile else 1, is_mobile=mobile, has_touch=mobile, color_scheme='light')
        pg = c.new_page()
        pg.on('console', lambda m: m.type == 'error' and errors.append(f'{tag}: {m.text}'))
        pg.on('pageerror', lambda e: errors.append(f'{tag}: {e}'))
        pg.goto(BASE + '/', wait_until='networkidle')
        pg.wait_for_selector('text=Log in')
        pg.screenshot(path=f'screenshots/{tag}-login.png')
        pg.fill('input[autocomplete=username]', 'alice'); pg.fill('input[type=password]', 'Connectly123!')
        pg.click('button:has-text("Log in")')
        pg.wait_for_selector('form[aria-label="Create post"]'); pg.wait_for_timeout(800)
        pg.locator('button:has-text("comment")').first.click() if pg.locator('button:has-text("1 comment")').count() else None
        pg.wait_for_timeout(500)
        pg.screenshot(path=f'screenshots/{tag}-feed.png')
        pg.goto(BASE + '/compose', wait_until='networkidle'); pg.wait_for_selector('textarea')
        pg.fill('textarea', 'Drafting a new post from the composer…')
        pg.screenshot(path=f'screenshots/{tag}-composer.png')
        pg.goto(BASE + '/u/alice', wait_until='networkidle'); pg.wait_for_selector('h1'); pg.wait_for_timeout(600)
        pg.screenshot(path=f'screenshots/{tag}-profile.png')
        if not mobile:
            pg.emulate_media(color_scheme='dark'); pg.evaluate("localStorage.setItem('cx-theme','dark')"); pg.reload(wait_until='networkidle'); pg.wait_for_timeout(600)
            pg.screenshot(path=f'screenshots/{tag}-profile-dark.png')
        c.close()
    b.close()
print('console errors:', errors or 'none')
