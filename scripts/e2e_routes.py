# Automated route check: fails (exit 1) if any route overflows horizontally (scrollWidth > clientWidth) at 320/375/390/430,
# or throws page errors / console errors. Also screenshots every route at 390 (light + dark).
# Usage: python3 scripts/e2e_routes.py BASE [SHOTDIR]   (needs the seeded demo account alice; never run against production data)
import sys, os, re, json
from playwright.sync_api import sync_playwright
BASE = sys.argv[1]; SHOTS = sys.argv[2] if len(sys.argv) > 2 else None
ROUTES = ['/', '/search', '/compose', '/reels', '/reels/new', '/messages', '/notifications', '/friends', '/me', '/me/posts', '/me/streak', '/me/coins', '/me/insights',
  '/settings', '/settings/profile', '/settings/plans', '/settings/subscription', '/settings/privacy-center', '/settings/text-size', '/settings/region', '/settings/notifications', '/settings/language', '/settings/security',
  '/settings/sessions', '/settings/logins', '/settings/blocked', '/settings/close-friends', '/settings/follow-requests', '/settings/muted', '/settings/restricted', '/settings/messaging', '/settings/sounds', '/settings/verification', '/settings/account', '/settings/deactivate',
  '/u/bob', '/u/bob/followers', '/tag/connectly', '/challenges', '/events', '/events/new', '/memories', '/market', '/market/new', '/live/new', '/create/photo', '/admin', '/assistant']
IGNORE = re.compile(r'favicon|net::ERR_ABORTED|Failed to load resource.*(404|401)|ResizeObserver|archive\.org|Permissions policy|camera|microphone|NotAllowedError', re.I)
fails = []
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'])
    lc = b.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True); lp = lc.new_page(); lp.goto(BASE + '/login'); lp.fill('input[autocomplete=username]', 'alice'); lp.fill('input[type=password]', 'Connectly123!'); lp.click('button:has-text("Log in")'); lp.wait_for_selector('.bottomnav', timeout=30000)
    state = lc.storage_state(); lc.close()
    for w in [320, 375, 390, 430]:
        c = b.new_context(viewport={'width': w, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True, storage_state=state)
        pg = c.new_page(); pg.set_default_timeout(20000); errs = []
        pg.on('pageerror', lambda e: errs.append('pageerror: ' + str(e)[:200]))
        pg.on('console', lambda m: m.type == 'error' and not IGNORE.search(m.text) and errs.append('console: ' + m.text[:200]))
        themes = ['light', 'dark'] if (SHOTS and w == 390) else ['light']
        pg.goto(BASE + '/settings', wait_until='domcontentloaded')
        for theme in themes:
            pg.evaluate("(t) => fetch('/api/me/settings', { method: 'PATCH', headers: { 'X-Connectly-CSRF': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ theme_pref: t }) })", theme)
            for r in ROUTES:
                errs.clear()
                try: pg.goto(BASE + r, wait_until='networkidle', timeout=20000)
                except Exception: pass
                pg.wait_for_timeout(700)
                m = pg.evaluate("() => { const d = document.scrollingElement; const W = document.documentElement.clientWidth; const body = document.body.innerText.trim(); const blank = [...document.querySelectorAll('.card')].filter(e => e.offsetHeight > 0 && !e.innerText.trim() && !e.querySelector('img,video,iframe,canvas,svg,input,textarea,select')).length; return { sw: d.scrollWidth, W, blank, empty: body.length < 3 }; }")
                if m['sw'] > m['W']: fails.append(f'{w} {r} overflow {m["sw"]}>{m["W"]}')
                if m['blank']: fails.append(f'{w} {r} {m["blank"]} blank card(s)')
                if m['empty']: fails.append(f'{w} {r} blank page')
                for e in errs: fails.append(f'{w} {r} {e}')
                if SHOTS and w == 390: os.makedirs(SHOTS, exist_ok=True); pg.screenshot(path=f'{SHOTS}/{(r.strip("/") or "home").replace("/", "_")}-{theme}.png')
        c.close()
    b.close()
for f in sorted(set(fails)): print('FAIL', f)
print(f'{len(set(fails))} problem(s) across {len(ROUTES)} routes x 4 widths')
sys.exit(1 if fails else 0)
