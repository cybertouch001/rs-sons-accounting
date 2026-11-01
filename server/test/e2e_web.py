
import asyncio, json, os, subprocess, sys, time, tempfile, socket
from playwright.async_api import async_playwright
SRV = '/home/user/work/rs-sons-v2/server'
OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/rs-shots'
os.makedirs(OUT, exist_ok=True)
def free_port():
    s = socket.socket(); s.bind(('127.0.0.1', 0)); p = s.getsockname()[1]; s.close(); return p
async def main():
    port = free_port(); data = tempfile.mkdtemp(prefix='rsweb-')
    env = dict(os.environ, PORT=str(port), DATA_DIR=data, ADMIN_PASSWORD='Start#Pass2026')
    log = open(os.path.join(data, 'server.log'), 'w')
    proc = subprocess.Popen(['node', 'server.js'], cwd=SRV, env=env, stdout=log, stderr=log, start_new_session=True)
    base = f'http://127.0.0.1:{port}'
    errors = []
    try:
        for _ in range(50):
            try:
                import urllib.request; urllib.request.urlopen(base + '/api/health', timeout=1); break
            except Exception: time.sleep(0.1)
        async with async_playwright() as pw:
            b = await pw.chromium.launch()
            ctx = await b.new_context(viewport={'width': 1366, 'height': 820})
            page = await ctx.new_page()
            page.on('console', lambda m: errors.append(('console', m.type, m.text)) if m.type in ('error',) else None)
            page.on('pageerror', lambda e: errors.append(('pageerror', str(e))))
            page.on('dialog', lambda d: asyncio.ensure_future(d.accept()))
            await page.goto(base + '/app/')
            await page.wait_for_selector('#loginForm', state='visible')
            await page.fill('#lu', 'admin'); await page.fill('#lp', 'Start#Pass2026'); await page.click('#loginForm button[type=submit]')
            await page.wait_for_selector('#f_n1')
            await page.fill('#f_n1', 'Kashi#Ganga2026'); await page.fill('#f_n2', 'Kashi#Ganga2026'); await page.click('#modalBox [data-a=ok]')
            try:
                await page.wait_for_selector('#cdemo', state='visible', timeout=8000)
            except Exception as ex:
                await page.screenshot(path=f'{OUT}/fail.png'); print('ERRORS', errors); print(await page.inner_text('body')); raise
            await page.screenshot(path=f'{OUT}/web-02-companies.png')
            await page.click('#cdemo')
            await page.wait_for_selector('#app:not(.hidden)', timeout=120000)
            await page.wait_for_timeout(1500)
            await page.screenshot(path=f'{OUT}/web-03-dashboard.png')
            for name in ['itr', 'gstr2b', 'bankImport', 'recurring', 'dueDates', 'users']:
                await page.evaluate(f"go('{name}', {{}})"); await page.wait_for_timeout(1200)
                await page.screenshot(path=f'{OUT}/web-{name}.png')
            await page.evaluate("go('report', {r:'profitLoss'})"); await page.wait_for_timeout(1000); await page.screenshot(path=f'{OUT}/web-pl.png')
            # phone
            ph = await b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
            p2 = await ph.new_page(); p2.on('pageerror', lambda e: errors.append(('pageerror-phone', str(e))))
            await p2.goto(base + '/app/'); await p2.wait_for_selector('#loginForm', state='visible')
            await p2.screenshot(path=f'{OUT}/phone-01-login.png')
            await b.close()
    finally:
        os.killpg(proc.pid, 15)
    print(json.dumps(errors, indent=1)[:4000])
    print(open(os.path.join(data, 'server.log')).read()[-3000:])
asyncio.run(main())
