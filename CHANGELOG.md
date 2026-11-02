# Changelog

## 2.3.0 (2 Nov 2026): English only, Forgot password, PDF for viewers

**English only**
- Every screen, message, toast, notification, dialog, menu, report and email (login OTP, reset code) is English. The live-update notification reads e.g. "Ramesh saved Sales Invoice #INV/2".

**Own server option removed**
- The Windows and Android apps always use the hosted server (or Offline mode on the PC). The "Advanced" own-server dialog and the Ctrl+Shift+L server shortcut are gone, in the app and in the desktop bridge.

**Forgot password?**
- Login screen › Forgot password? › username › a 6-digit reset code goes to that user's email › new password twice. Works for every role, admin included.
- The code is valid 10 minutes and once only; 5 wrong tries end it; resend after 60 s; at most 4 codes per user and 12 per network per hour. Only hashes are stored. An unknown username gets the same neutral answer.
- A backup code (from Email settings) can be used instead of the email code. After a reset every session of that user is logged out and a "password changed" email is sent.
- Mail goes through the same Gmail App Password / SMTP settings as the login OTP (Admin › Email settings). Without them, the screen says so and the admin resets the password.

**Viewer PDF options**
- Invoices, vouchers and reports open in a built-in PDF viewer with Download PDF, Print and Share (Share PDF on Android; Save / Share on Windows; WhatsApp / email links in a browser). Viewers still cannot change anything: the server answers 403 to every write.

## 2.2.0 (2 Nov 2026): view-only users, live updates, email OTP login

**Viewer = strictly view only**
- A user with the Viewer role can only read. Every save / edit / delete / post / import button is disabled and greyed out on every screen and dialog (clicks and shortcuts like Ctrl+S, Alt+C, F4–F9 are stopped before the screen sees them); saved vouchers and masters open read-only.
- The server refuses every write from a viewer with HTTP 403 (it already checked roles; v2.2 adds tests for each kind of write).
- The viewer's screen shows only reading screens: no backup / restore, settings, users, company create / delete, data entry, bank import or admin menus. Utilities shows only Change Password, Help and About.
- A PC or phone where a viewer logs in hides the Offline mode, own-server and online/offline storage choices on the login screen; the Windows app also refuses offline mode and server changes there (Ctrl+Shift+L too) until a non-viewer logs in on that device.

**Live updates between users**
- Every save writes one small change row on the server. While a company is open, the app asks "anything new since #N?" every 3 s (15 s in the background), on Windows, Android and the browser.
- Another user's save shows a notification ("Ramesh saved Sales Invoice #INV/12") and refreshes the open dashboard / report / list at once. A screen with unsaved typing is never reloaded under you: a "data changed — Refresh" bar appears instead. 🔔 in the top bar lists recent changes.
- Android: a phone notification while the app is in the background (asks for the notification permission on Android 13+). Windows: a desktop notification when the window is not in front.

**Email OTP login**
- After the right password, a 6-digit code goes to the user's email; the login finishes only with that code. 10 minutes valid, 5 tries, resend after 30 s (max 5 per login, 10 per hour), wrong codes count toward the account lock-out. New users verify their email with the first OTP, then set their own password.
- Mail is sent by the server itself over SMTP (TLS 465 or STARTTLS 587; Cloudflare TCP sockets on the hosted server, Node net/tls when self-hosted). The admin enters the sending Gmail address + a Google App Password in Admin › Email OTP; it is stored only in the server database and never sent back to any screen. Gmail, Zoho, Outlook, Brevo or any SMTP server.
- Safe roll-out: OTP stays OFF until a test mail succeeds; changing the mail login switches it off again until a new test passes. Users without an email log in with the password only.
- Ways out when email fails: the admin switches OTP off for everyone (one button) or for one user (Users › user › "Login pe email OTP"); every non-viewer can make 8 one-time backup codes (Utilities › Login OTP & backup codes).
- `/api/health/mail` says whether the server can reach Gmail's mail server.

**Upgrade**
- Existing users, companies and data are untouched: the users table gets 4 new columns; before that change the server writes a full copy of the system tables (hosted: R2 `backups/_system/`, self-hosted: `Backups/_system/`).
- Tests: `server/test/v22.test.js` (51 checks: viewer 403s, live changes between two users, OTP with a local test mail server, expiry, tries, resend, backup codes, admin switches), `app/test/e2e-v22.js` (desktop view-only device, 10 checks).

## 2.1.0 (1 Nov 2026): login-first apps, "login once, data everywhere"

**Apps**
- The Windows app opens straight on the online login for the hosted server. It stays logged in like a phone app, remembers the last username (never the password), and has a Logout.
  - "Offline mode (this PC only)" on the login screen opens the old local books on this PC. v1.1 and v2.0 local data is untouched.
  - An advanced option pointed the app at a self-hosted server (removed in 2.3).
  - Ctrl+Shift+L switched the server (removed in 2.3).
- New Android app (`bot.tab.sites.rssons`, Android 6+):
  - Same login and same data as Windows and the web.
  - Stays logged in; the back button moves through screens.
  - PDF / Excel go to Downloads; invoice PDFs share to WhatsApp and others.
  - Clear no-internet message with auto-retry; optional app lock (fingerprint or phone PIN).
- Connection states with Retry: "Connecting…", "Server is waking up…", "No internet".

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
