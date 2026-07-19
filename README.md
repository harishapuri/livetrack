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

## Setup

```bash
cd ~/Projects/coact
npm install
```

### Build installable package (Mac)

```bash
npm run dist:mac
```

Installer lands in `release/` (`.dmg` + `.zip`). The Chrome extension is bundled under the app’s Resources as `extension/` — load that folder in Chrome after install.

### 1. Start liveAct (dev)

```bash
npm start
# same as: npm run start -w @coact/liveact
```

### 2. Load the Chrome extension

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. **Load unpacked** → choose:
   - **Installed app:** `/Applications/liveAct.app/Contents/Resources/extension`
   - **From source:** `packages/extension` (full path: `~/Projects/coact/packages/extension`)
4. Confirm the toolbar badge can show `ON` when liveAct is running

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
| `npm run pack` / `dist:mac` | `@coact/liveact` |

Run a package directly:

```bash
npm run start -w @coact/liveact
npm run start -w @coact/dashboard
npm run serve -w @coact/demo
```
