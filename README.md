# Coact

Attended form automation monorepo: click a **queue card** in **liveAct**, and the **Chrome extension** fills the form on the tab you’re already watching.

```
liveAct (queue + live steps)  ←WebSocket→  Chrome extension  →  current form tab
```

## Packages

| Package | Path | Purpose |
|---------|------|---------|
| `@coact/liveact` | `packages/liveact` | Electron app — queue cards, step watcher, pause/takeover |
| `@coact/extension` | `packages/extension` | Chrome extension — fills/highlights fields |
| `@coact/dashboard` | `packages/dashboard` | Supervisor dashboard, queue studio, assignments, SOP converter |
| `@coact/shared` | `packages/shared` | Protocol + SOP JSON + demo catalog |
| `@coact/demo` | `packages/demo` | Local demo form sites |

## Bridge (same machine)

liveAct and the Chrome/Edge extension always run on **the same PC**. The extension connects to:

- WebSocket: `ws://127.0.0.1:17321`
- Health: `http://127.0.0.1:17321/health`

`127.0.0.1` is **this machine’s loopback** on every PC — no personal LAN IP is hardcoded. The bridge listens on `0.0.0.0:17321`. On startup it detects this machine’s LAN IPv4 (`os.networkInterfaces()`) and reports it in `/health` as `host` / `wsUrl` for logging only.

Optional overrides (rare remote-dev):

- Dashboard publish: `LIVEACT_BRIDGE_HOST=<host>` (default `127.0.0.1`)
- Extension: `chrome.storage.local.bridgeHost` or `bridgeUrl`

When liveAct is closed, the extension waits quietly (“Waiting for liveAct…”) and reconnects automatically.

## Setup

```bash
cd ~/Projects/coact
npm install
```

### Build installable package (Mac)

```bash
npm run dist:mac
```

Installer lands in `release/` (`.dmg` + `.zip`). The browser extension is bundled under Resources as `extension/`.

### Build Windows `.exe` (NSIS installer + portable)

Run on a Windows machine (or CI with Windows runners):

```bash
npm run dist:win
```

Outputs in `release/`:
- `liveAct-Setup-…-x64.exe` — NSIS installer
- `liveAct-Portable-…-x64.exe` — portable app

The Chrome/Edge extension is **inside the install** at:

`C:\Users\<you>\AppData\Local\Programs\liveAct\resources\extension`

(or next to the portable exe under `resources\extension`).

#### Can the `.exe` auto-add the extension to Chrome/Edge?

**No.** Chrome and Edge block silent extension installs from desktop apps (security).  
You still load it once as **unpacked**:

1. Install / run liveAct
2. **⚙ Settings → Add to Chrome…** or **Add to Edge…**  
   (copies extension to `Projects/coact/extension` and opens the extensions page)
3. Turn on **Developer mode** → **Load unpacked** → select `Projects/coact/extension`
4. Start liveAct, confirm the toolbar badge can show Online

Same extension folder works for **both Chrome and Edge**.

For enterprise auto-install you’d need Chrome Web Store / Edge Add-ons publishing + policy — not shipped in this POC.

### 1. Start liveAct (dev)

```bash
npm start
# same as: npm run start -w @coact/liveact
```

### 2. Load the Chrome / Edge extension

**Easiest (installed or dev app):** liveAct → ⚙ Settings → **Add to Chrome…** / **Add to Edge…**

Or manually:

1. Open `chrome://extensions` or `edge://extensions`
2. Enable **Developer mode**
3. **Load unpacked** → choose:
   - **After Settings install:** `Projects/coact/extension`
   - **Mac app:** `/Applications/liveAct.app/Contents/Resources/extension`
   - **Windows app:** `<install>\resources\extension`
   - **From source:** `packages/extension`
4. Confirm the toolbar badge can show Online when liveAct is running

### 3. Open the demo form

```bash
npm run demo-form
```

Open http://localhost:4173 in Chrome.

### 4. Supervisor dashboard

```bash
npm run dashboard
```

| URL | Purpose |
|-----|---------|
| http://127.0.0.1:4175/ | Executions |
| http://127.0.0.1:4175/queue-studio/ | Create / clone queue cards |
| http://127.0.0.1:4175/assignments/ | Assign users to LOB / cards |
| http://127.0.0.1:4175/converter/ | PPT / PDF / DOCX → SOP JSON |

Date filters:

```bash
node packages/dashboard/server.js --from=2026-07-01 --to=2026-07-18
node packages/dashboard/server.js --days=14
```

### SQL from executions

```bash
npm run generate-day-sql
node packages/liveact/scripts/generate-day-sql.js --date=2026-07-18
```

### Seed demo sites

```bash
npm run seed-demo-sites
```

## Workspace commands

| Command | Package |
|---------|---------|
| `npm start` | `@coact/liveact` |
| `npm run dashboard` | `@coact/dashboard` |
| `npm run demo-form` | `@coact/demo` |
| `npm run pack` / `dist:mac` / `dist:win` | `@coact/liveact` |

Run a package directly:

```bash
npm run start -w @coact/liveact
npm run start -w @coact/dashboard
npm run serve -w @coact/demo
```
