# Walks the full signup + onboarding flow in a phone-sized browser and screenshots each step.
# Usage: python3 scripts/onboarding_screens.py BASE_URL EMAIL CODE_CMD
#   CODE_CMD: shell command that prints the latest 6-digit code for EMAIL (e.g. grep on the server log).
import sys, os, subprocess, time
from playwright.sync_api import sync_playwright
BASE, EMAIL, CODE_CMD = sys.argv[1], sys.argv[2], sys.argv[3]
OUT = os.environ.get('OUT', 'screenshots/onboarding'); os.makedirs(OUT, exist_ok=True)
errors = []
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    c = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True,
                      permissions=['geolocation', 'notifications'], geolocation={'latitude': 6.5244, 'longitude': 3.3792})
    pg = c.new_page(); pg.on('pageerror', lambda e: errors.append(str(e)))
    shot = lambda n: (pg.wait_for_timeout(350), pg.screenshot(path=f'{OUT}/{n}.png'))
    pg.goto(BASE + '/login', wait_until='networkidle'); pg.wait_for_selector('text=Log in'); shot('00-login')
    pg.goto(BASE + '/signup', wait_until='networkidle'); pg.wait_for_selector('text=Create your account')
    pg.fill('input[autocomplete=username]', '0803 123 4567'); pg.wait_for_selector('select[aria-label="Country code"]'); shot('01b-phone-coming-soon')
    pg.fill('input[autocomplete=username]', EMAIL); pg.fill('input[type=password]', 'Connectly-Test-2026'); shot('01-email-password')
    pg.click('button:has-text("Continue")'); pg.wait_for_selector('text=What’s your name?'); pg.fill('input[autocomplete=name]', 'Jimoh Mojeed'); shot('02-full-name')
    pg.click('button:has-text("Continue")'); pg.wait_for_selector('input[type=date]'); pg.fill('input[type=date]', '2015-01-01')
    pg.click('button:has-text("Continue")'); shot('03b-dob-under-13')
    pg.fill('input[type=date]', '1995-06-15'); shot('03-date-of-birth')
    pg.click('button:has-text("Continue")'); pg.wait_for_selector('text=Terms & Privacy'); pg.check('input[type=checkbox]'); shot('04-terms')
    pg.click('button:has-text("Create account")'); pg.wait_for_selector('text=Enter your code'); shot('05-enter-code')
    pg.fill('.codeinput', '000000'); pg.click('button:has-text("Verify")'); pg.wait_for_selector('[role=alert]'); shot('05b-wrong-code')
    time.sleep(2); code = subprocess.check_output(CODE_CMD, shell=True, text=True).strip()
    assert len(code) == 6, 'no code found'
    pg.fill('.codeinput', code); pg.click('button:has-text("Verify")')
    pg.wait_for_selector('text=Signing you in'); pg.screenshot(path=f'{OUT}/06-signing-in.png')
    pg.wait_for_selector('text=Add a profile photo'); shot('07-onboard-photo')
    pg.set_input_files('input[type=file]', '/tmp/av.png'); pg.wait_for_selector('text=Looking good'); shot('07b-photo-uploaded')
    pg.click('button:has-text("Continue")'); pg.wait_for_selector('text=Stay in the loop'); shot('08-onboard-notifications')
    pg.click('button:has-text("Allow notifications")'); pg.wait_for_selector('text=Where are you?', timeout=15000); shot('09-onboard-location')
    pg.click('button:has-text("Allow location")')
    try: pg.wait_for_selector('text=Find people you know', timeout=20000)
    except Exception: shot('09b-location-result'); pg.click('button:has-text("Continue"), button:has-text("Skip")')
    shot('10-onboard-contacts')
    pg.click('button:has-text("feed")'); pg.wait_for_selector('form[aria-label="Create post"]'); shot('11-home-feed')
    pg.goto(BASE + '/settings/profile', wait_until='networkidle'); pg.wait_for_selector('text=Full name'); shot('12-edit-profile-username')
    pg.set_viewport_size({'width': 320, 'height': 640}); pg.goto(BASE + '/', wait_until='networkidle'); pg.wait_for_timeout(600); shot('13-feed-320px')
    c.close(); b.close()
print('page errors:', errors or 'none')
