# Checks Home (and a few pages) for horizontal overflow at common phone widths. Usage: python3 scripts/overflow_check.py BASE [OUTDIR]
import sys, os
from playwright.sync_api import sync_playwright
BASE = sys.argv[1]; OUT = sys.argv[2] if len(sys.argv) > 2 else None
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    for w in [320, 375, 390, 430]:
        c = b.new_context(viewport={'width': w, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
        pg = c.new_page(); pg.set_default_timeout(30000)
        pg.goto(BASE + '/login'); pg.fill('input[autocomplete=username]', 'alice'); pg.fill('input[type=password]', 'Connectly123!'); pg.click('button:has-text("Log in")'); pg.wait_for_selector('.bottomnav')
        for path in ['/', '/reels', '/search', '/me']:
            pg.goto(BASE + path, wait_until='networkidle'); pg.wait_for_timeout(800)
            r = pg.evaluate("""() => { const W = document.documentElement.clientWidth; const bad = [...document.querySelectorAll('body *')].filter(e => { const r = e.getBoundingClientRect(); return r.width && (r.right > W + 1 || r.left < -1) && getComputedStyle(e).position !== 'fixed'; }).slice(0, 4).map(e => e.tagName + '.' + (e.className && e.className.baseVal === undefined ? e.className : '') + ' ' + Math.round(e.getBoundingClientRect().right));
              const tb = document.querySelector('.topbar'); return { sw: document.scrollingElement.scrollWidth, W, bad, topbar: tb ? Math.round(tb.scrollWidth) : null }; }""")
            print(w, path, 'scrollWidth', r['sw'], 'viewport', r['W'], 'topbar', r['topbar'], 'OVER' if r['sw'] > r['W'] or (r['topbar'] or 0) > r['W'] else 'ok', r['bad'] if r['bad'] else '')
            if OUT and path == '/': os.makedirs(OUT, exist_ok=True); pg.screenshot(path=f'{OUT}/home-{w}.png')
        c.close()
    b.close()
