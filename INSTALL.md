# R&S Sons Accounting v2 — Server install guide (1 page)

Set up one server and the whole office (and home) works on the same books. Each person gets their own login. Everything is saved on the server.
No outside service is needed: it runs on your own VPS or office PC.

> Note (2.3): the Windows and Android apps always use the hosted R&S Sons server (or Offline mode on the PC); they no longer connect to a self-hosted server. A self-hosted server is used from a browser only.

**You need:** Node.js 22.13 or newer, *or* Docker. About 200 MB disk plus your data.
After it starts, open **http://SERVER-IP:8080/app/** in a browser.

---

## A. Ubuntu VPS (access over the internet, with HTTPS) — recommended

```bash
# 1) Install Docker
sudo apt update && sudo apt install -y docker.io docker-compose-v2 git
# 2) Get the code
git clone https://github.com/cybertouch001/rs-sons-accounting.git && cd rs-sons-accounting
cp .env.example .env
nano .env          # ADMIN_PASSWORD=<strong password>, TRUST_PROXY=1, COOKIE_SECURE=1
# 3) Start
sudo docker compose up -d
```
**HTTPS (required when used over the internet):** point a domain (e.g. `accounts.yourfirm.in`) to the VPS IP, then:
```bash
sudo apt install -y caddy
echo 'accounts.yourfirm.in {
  reverse_proxy 127.0.0.1:8080
}' | sudo tee /etc/caddy/Caddyfile && sudo systemctl reload caddy
sudo ufw allow 22,80,443/tcp && sudo ufw enable
```
Caddy gets the SSL certificate by itself. Also change `docker-compose.yml` ports to `"127.0.0.1:8080:8080"` so port 8080 is not open to the internet.
Login: `https://accounts.yourfirm.in/app/`

**Without Docker (plain Node):**
```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash - && sudo apt install -y nodejs
cd rs-sons-accounting/server && npm ci --omit=dev && cp ../.env.example .env && nano .env
node server.js        # test run; Ctrl+C to stop
```
Always-on (systemd): create `/etc/systemd/system/rs-sons.service` with
`[Service]` `WorkingDirectory=/home/ubuntu/rs-sons-accounting/server` `ExecStart=/usr/bin/node server.js` `Restart=always` `User=ubuntu` and `[Install]` `WantedBy=multi-user.target`, then `sudo systemctl enable --now rs-sons`.

## B. Windows PC (office network / LAN)

1. Install **Node.js 22 LTS** from nodejs.org (Next, Next, Finish).
2. On the GitHub page, click **Code › Download ZIP** and extract it to, for example, `D:\RS-Server`.
3. Double-click **`start-server.bat`**. The first time it installs what it needs (internet is needed once). When Windows Firewall asks, choose **Allow (Private network)**.
4. The first admin password is saved in `server\data\FIRST-ADMIN-PASSWORD.txt` (the black window shows where). Log in, set a new password, then **delete that file**.
5. Other computers: open `http://<this PC's IP>:8080/app/` in a browser (find the IP with `ipconfig`, e.g. 192.168.1.10).
- Keep this PC on during office hours. To start automatically, put a shortcut to `start-server.bat` in `shell:startup`.
- ⚠ Plain http is fine inside the office LAN. Over the internet, use a VPS with HTTPS (section A), and don't open port 8080 on your router.

## C. Settings (`.env`)
`PORT` (8080) · `DATA_DIR` (where data is kept) · `ADMIN_USER` / `ADMIN_PASSWORD` (first start only; if blank, a random password goes to `DATA_DIR/FIRST-ADMIN-PASSWORD.txt`) · `TRUST_PROXY=1` + `COOKIE_SECURE=1` behind HTTPS · `MAX_BODY_MB` (upload limit).

## D. Backup / restore (very important)
- **Automatic:** every company is copied once a day into `DATA_DIR/backups/` (the last 30 are kept).
- **Full backup (users + all companies), safe while running:** `node server.js backup D:\RS-Backup\2026-11-01`
  Docker: `sudo docker compose exec rs-sons node server.js backup /data/manual-backup` (it lands in `./data/manual-backup`).
- **Restore:** stop the server, run `node server.js restore D:\RS-Backup\2026-11-01`, then start again. The old data is kept aside.
- **One company:** in the app, Admin › Backup gives you a `.rsbak` download; Restore takes it back as a new company.
- Keep a copy **outside the server** (Google Drive, a pendrive). A server can fail.
- Forgot the admin password? Run `node server.js reset-password admin` on the server.

## E. Moving from v1.1 desktop (bringing the old data)
1. Old PC: the v1.1 app › Backup gives a `.rsbak` file (or use the `.rsdb` files in `Documents\RS Sons Accounting\Companies`).
2. Web: log in as admin › Companies screen › **Restore** › choose the file. The company comes in with all its vouchers.
3. Users: Users › **Import users from v1.1** › choose `Documents\RS Sons Accounting\system.json`. Old passwords keep working.

**Update:** `git pull && sudo docker compose up -d --build` (plain Node: `git pull`, then restart). Data in `DATA_DIR` is untouched; still, take a backup first.
**Roles:** Admin = everything · Operator = vouchers and masters, no deleting · Viewer = reports only. The audit log shows who changed what and when.
