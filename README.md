# R&S Sons Accounting 2.3

GST accounting, inventory and payroll for Indian small businesses. Version 2 adds a **multi-user server**, so the same books can be used from:

- **Browser:** the web app at `/app/` on your server, phones included
- **Windows desktop app:** uses the hosted server, or works offline on the PC (local mode)
- **Self-hosted server:** Docker or plain `node server.js` on your own VPS or office PC, used from a browser (the 2.3 apps always use the hosted server)

New in 2.0: per-user logins with roles (admin / operator / viewer) enforced on the server, company-level access, an audit trail, ITR computation (P&L or 44AD/44ADA, old vs new regime, PDF + Excel filing sheet), GSTR-2B ITC reconciliation, bank statement import with auto-match, recurring vouchers, a due-date calendar, and import of v1.1 companies and users.

New in 2.1 (see [CHANGELOG.md](CHANGELOG.md)): login-first **Windows and Android apps**. Log in once and the same data is on the PC, the phone and the browser, with an offline mode kept for local books on a PC. Also faster company opening and voucher forms, quick search, dark mode, and Share PDF.

New in 2.2: **Viewer users are strictly view-only** (buttons disabled, server refuses writes, no setup options on their screen), **live updates** between users on the same company with notifications, and **email OTP login** (6-digit code to the user's email, sent by the server via your Gmail App Password or any SMTP; admin can switch it off per user or for everyone, backup codes).

New in 2.3: **English only** everywhere (apps, website, notifications, emails), **Forgot password?** on the login screen (a one-time reset code by email, 10 minutes, rate-limited; backup codes also work), **PDF viewer for viewers** (view, download, print and share invoices and reports, still no edits), and the own-server option is removed from the apps.

**Install the server:** see [INSTALL.md](INSTALL.md) (one page).

## Layout
```
android/  Android app (native shell around the web app; see android/README.md)
app/      Electron desktop app; app/core is the accounting engine shared by desktop and server, app/renderer is the UI shared by both
server/   Node server (server.js, node:sqlite), API service, tests; worker.js = optional Cloudflare Workers build (D1 + R2)
Dockerfile, docker-compose.yml, .env.example, start-server.bat (Windows)
```

## Tests
```
cd app && npm install && npm test              # engine: core, dashboard, admin, ITR (hand-checked), automation
cd server && npm install && npm test           # API: login/lockout, roles, 2 users concurrently, audit, backup/restore, v1.1 import, worker build, v2.1 batch + stay-logged-in, v2.2 viewer/live/OTP, v2.3 forgot password / English / viewer PDF
```

## Build the Windows app
`cd app && npm install && npx electron-builder --win --x64` (on Linux this needs wine).

## Limits (honest)
- The app does **not** file ITR or GST returns. Direct ITR filing needs ERI registration and GST filing needs a GSP, so it prepares the computation PDF / Excel and the GSTR-1/3B JSON for you to upload on the portals.
- Tax rules were checked against official sources as of Nov 2026, for FY 2025-26 and tax year 2026-27 (Income-tax Act 2025). Interest u/s 234A/B/C is not computed.
- The desktop installer is not code-signed, so Windows SmartScreen shows a warning. The Android APK is not on the Play Store, so the phone asks to allow "install unknown apps".
