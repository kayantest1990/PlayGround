#!/usr/bin/env bash
# Capture desktop + mobile screenshots of the exact $CAPTURE_URL into $CAPTURE_DIR.
# Exit 75 = temporary navigation/browser infrastructure failure (retryable).
# Exit 1  = script usage or rendering defect.
# Leaves the app server running; screenshots go outside the source tree.
# Every command is timed with /usr/bin/time -p.
set -euo pipefail
# NOTE: cd is a shell builtin and cannot be wrapped by /usr/bin/time; all external commands below are timed.
cd "$(dirname "$0")"
/usr/bin/time -p test -n "${CAPTURE_URL:?Set CAPTURE_URL to the exact preview URL.}"
/usr/bin/time -p test -n "${CAPTURE_DIR:?Set CAPTURE_DIR to the screenshot output directory.}"
/usr/bin/time -p mkdir -p "$CAPTURE_DIR"
HELPER="${RUNNER_TEMP:-/tmp}/shoes-capture-helper.cjs"
/usr/bin/time -p tee "$HELPER" > /dev/null <<'NODE_EOF'
const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');

const home = process.env.HOME || '/home/runner';
const runtime = path.join(home, '.local/share/omgithub-playwright');
const requirePlaywright = createRequire(path.join(runtime, 'package.json'));
const { chromium } = requirePlaywright('playwright');

const url = process.env.CAPTURE_URL;
const output = process.env.CAPTURE_DIR;
if (!url || !output) { console.error('Set CAPTURE_URL and CAPTURE_DIR.'); process.exit(1); }
fs.mkdirSync(output, { recursive: true });

let config;
try {
  const cfgPath = path.join(runtime, process.platform === 'darwin' ? 'metal.json' : 'linux.json');
  config = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
} catch (err) { console.error('Cannot read playwright config: ' + err.message); process.exit(1); }

if (process.platform === 'linux') {
  try {
    process.env.DISPLAY = process.env.DISPLAY || (':' + fs.readFileSync(path.join(runtime, 'display'), 'utf8').trim());
  } catch (err) { console.error('Cannot read display file: ' + err.message); process.exit(75); }
}

const transient = (err) => { const e = err instanceof Error ? err : new Error(String(err)); e.exitCode = 75; throw e; };
const TRANSIENT_HTTP = new Set([408, 429, 500, 502, 503, 504]);

(async () => {
  let browser;
  try {
    browser = await chromium.launch({ ...config.browser.launchOptions, timeout: 30000 }).catch(transient);
    for (const [name, width, height] of [['desktop', 1440, 900], ['mobile', 390, 844]]) {
      const page = await browser.newPage({ viewport: { width, height } }).catch(transient);
      page.setDefaultTimeout(30000);
      page.on('pageerror', (err) => console.error('pageerror: ' + err.message));
      const response = await page.goto(url, { waitUntil: 'load', timeout: 45000 }).catch(transient);
      if (!response || !response.ok()) {
        const status = response ? response.status() : 0;
        const e = new Error(status ? ('HTTP ' + status + ' loading preview') : 'No response loading preview');
        e.exitCode = (!response || TRANSIENT_HTTP.has(status)) ? 75 : 1;
        throw e;
      }
      await page.locator('body').waitFor({ state: 'visible' }).catch(transient);
      await page.waitForFunction(() => document.fonts.status === 'loaded').catch(() => {});
      await page.waitForTimeout(1500);
      const dest = path.join(output, 'final-' + name + '.png');
      await page.screenshot({ path: dest, timeout: 30000 }).catch((err) => {
        if (err.name === 'TimeoutError' || !browser.isConnected()) transient(err);
        throw err;
      });
      console.log('captured ' + dest);
      await page.close().catch(() => {});
    }
    for (const name of ['desktop', 'mobile']) {
      const f = path.join(output, 'final-' + name + '.png');
      let size = 0;
      try { size = fs.statSync(f).size; }
      catch (err) { const e = new Error('missing screenshot ' + f); e.exitCode = 1; throw e; }
      if (size < 1024) { const e = new Error('screenshot too small (' + size + ' bytes): ' + f); e.exitCode = 1; throw e; }
    }
  } catch (err) {
    console.error(err && err.message ? err.message : err);
    process.exitCode = (err && err.exitCode) || 1;
  } finally {
    if (browser) await browser.close().catch((err) => { console.error('browser close: ' + err.message); process.exitCode = process.exitCode || 75; });
  }
})();
NODE_EOF
CAPTURE_RC=0
/usr/bin/time -p node "$HELPER" || CAPTURE_RC=$?
if /usr/bin/time -p test "$CAPTURE_RC" -ne 0; then
  echo "capture helper exited $CAPTURE_RC" >&2
  exit "$CAPTURE_RC"
fi
/usr/bin/time -p test -s "$CAPTURE_DIR/final-desktop.png"
/usr/bin/time -p test -s "$CAPTURE_DIR/final-mobile.png"
/usr/bin/time -p ls -l "$CAPTURE_DIR"
echo "captured desktop + mobile screenshots in $CAPTURE_DIR"
