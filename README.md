# Coact

Attended form automation: click a **queue card** in the desktop app, and the **Chrome extension** fills the form on the tab you’re already watching.

```
Desktop (queue + live steps)  ←WebSocket→  Chrome extension  →  current form tab
```

## What’s included

| Path | Purpose |
|------|---------|
| `desktop/` | Electron app — queue cards, step watcher, pause/takeover |
| `extension/` | Chrome extension — fills/highlights fields on the open page |
| `shared/` | Sample queue + SOP JSON |
| `demo/` | Local vendor form for testing |

## Setup

```bash
cd ~/Projects/coact
npm install
```

### 1. Start the desktop app

```bash
npm start
```

### 2. Load the Chrome extension

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. **Load unpacked** → select the `extension/` folder
4. Confirm the toolbar badge can show `ON` when the desktop app is running

### 3. Open the demo form

```bash
npm run demo-form
```

Open http://localhost:4173 in Chrome (leave this tab active).

### 4. Run a card

1. In Coact desktop, wait until status shows **Extension online**
2. Click a queue card
3. Watch fields fill in Chrome and steps update in the desktop app
4. Use **Pause** / **Resume** / **Take over** as needed

## Customize

- **Queue cards:** `shared/sample-queue.json`
- **SOP steps:** `shared/sops/vendor-onboarding.json`
  - `selector` — CSS selector on the page
  - `valueFrom` — key in the card’s `data` object
  - `action` — `fill` | `click` | `highlight`

## Bridge

Desktop listens on `ws://127.0.0.1:17321`. The extension reconnects automatically when the app starts.

## Next ideas

- Map real portal selectors into a new SOP JSON
- Add validation-error “fix” steps
- Persist queue from your real system instead of sample JSON
