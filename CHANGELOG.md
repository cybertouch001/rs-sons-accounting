# Changelog

## 2.1.0 (1 Nov 2026): login-first apps, "login once, data everywhere"

**Apps**
- The Windows app opens straight on the online login for the hosted server. It stays logged in like a phone app, remembers the last username (never the password), and has a Logout.
  - "Offline mode (sirf is PC pe)" on the login screen opens the old local books on this PC. v1.1 and v2.0 local data is untouched.
  - "Advanced: apna server" points the app at a self-hosted server.
  - Ctrl+Shift+L switches to offline mode.
- New Android app (`bot.tab.sites.rssons`, Android 6+):
  - Same login and same data as Windows and the web.
  - Stays logged in; the back button moves through screens.
  - PDF / Excel go to Downloads; invoice PDFs share to WhatsApp and others.
  - Clear no-internet message with auto-retry; optional app lock (fingerprint or phone PIN).
- Connection states in Hindi and English, with Retry: "Connecting…", "Server jag raha hai…" (server waking up), "Internet nahi hai". Login errors are bilingual too.

**Speed**
- Opening a company: about 3.5 s → 2.3 s (15 → 6 server calls).
- Voucher form: 1.4 s → 0.5 s.
- How: several calls go to the server in one request (new `batch` method), dashboard data loads in parallel, the daily backup runs after the reply, and nothing is uploaded when a company has not changed.

**Extras**
- Quick search (🔍 / Ctrl+K) across ledgers, items and vouchers.
- Dark/light switch for each device.
- Share PDF button in the document view.
- Phone layout fixes: voucher forms, top bar, wide tables scroll sideways.

**Server**
- `auth.login(user, pw, { remember: true })`: a "stay logged in" session with a 60-day idle limit and 180 days at most. Normal sessions still end after 12 h idle / 7 days. Logout ends either kind at once.
- New `batch` method: up to 40 calls per request, each checked on its own. Login, logout and password calls are refused inside a batch.
- Downloads can carry their own content type (the APK is served as an Android package).

**Tests**
- Engine 253, server 85 + 21 new (`server/test/v21.test.js`).
- Desktop e2e 31 + admin e2e 56.
- New cloud e2e (`app/test/e2e-cloud.js`) covering: login-first, wrong password, server down, slow server, cross-device sync, reopen while still logged in, and offline mode with old local data.

## 2.0.0 (1 Nov 2026)
Multi-user server (web + desktop + self-host), roles and company access, audit log, ITR computation, GSTR-2B match, bank statement import, recurring vouchers, due dates on the dashboard.

## 1.1.0
Desktop (Windows) offline accounting: GST invoices, inventory, payroll, reports, GSTR-1 / 3B JSON.
