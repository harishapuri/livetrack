#!/usr/bin/env node
/**
 * Generates demo site HTML forms + SOPs from shared/demo-catalog.js
 * and ensures matching queue cards under <project>/queue.
 */
const fs = require("fs");
const path = require("path");
const { DEMO_SITES } = require("@coact/shared/demo-catalog");
const { defaultDocumentsRoot } = require("../liveact/documents");

const root = path.join(__dirname);
const sitesDir = path.join(root, "sites");
const sopsDir = path.join(__dirname, "..", "shared", "sops");
const DEFAULT_LOB = "TCOO";
const queueRoot = defaultDocumentsRoot();
const lobQueueRoot = path.join(queueRoot, DEFAULT_LOB);

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function fieldHtml(field) {
  const control =
    field.type === "textarea"
      ? `<textarea id="${field.id}" name="${field.id}" rows="3"></textarea>`
      : `<input id="${field.id}" name="${field.id}" type="${field.type || "text"}" />`;
  return `        <label>
          ${field.label}
          ${control}
        </label>`;
}

function siteHtml(site) {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${site.siteName} — Demo Form</title>
    <style>
      :root {
        --bg: #f6f4f1;
        --ink: #1c1917;
        --line: #d6d0c6;
        --accent: ${site.accent};
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: "Segoe UI", "Avenir Next", sans-serif;
        color: var(--ink);
        background:
          linear-gradient(180deg, color-mix(in srgb, var(--accent) 14%, transparent), transparent 32%),
          var(--bg);
        min-height: 100vh;
      }
      main { max-width: 640px; margin: 0 auto; padding: 40px 22px 64px; }
      .site { font-size: 0.75rem; letter-spacing: 0.08em; text-transform: uppercase; color: var(--accent); font-weight: 700; }
      h1 { margin: 6px 0 8px; font-size: 1.75rem; }
      .sub { margin: 0 0 24px; color: #57534e; }
      form { display: grid; gap: 12px; }
      label { display: grid; gap: 6px; font-size: 0.92rem; }
      input, textarea {
        font: inherit; padding: 10px 12px; border: 1px solid var(--line);
        border-radius: 8px; background: #fff;
      }
      button {
        margin-top: 6px; justify-self: start; font: inherit; padding: 11px 16px;
        border: 0; border-radius: 8px; background: var(--accent); color: #fff; cursor: pointer;
      }
      .hint {
        margin-top: 18px; padding: 12px 14px; border-left: 3px solid var(--accent);
        background: color-mix(in srgb, var(--accent) 10%, #fff); color: #44403c; font-size: 0.88rem;
      }
    </style>
  </head>
  <body>
    <main>
      <div class="site">${site.siteName}</div>
      <h1>${site.title.split("—")[1]?.trim() || site.title}</h1>
      <p class="sub">Dummy Coact form — open this tab, then Start the matching queue card.</p>
      <form id="demoForm">
${site.fields.map(fieldHtml).join("\n")}
        <button id="submitBtn" type="submit">Submit</button>
      </form>
      <p class="hint">URL: http://127.0.0.1:4173/${site.path.replace(/\.html$/, "")}</p>
    </main>
    <script>
      document.getElementById("demoForm").addEventListener("submit", function (event) {
        event.preventDefault();
        var ref = "RD-" + Date.now().toString(36).toUpperCase() + "-" + Math.floor(Math.random() * 9000 + 1000);
        var url = new URL(location.href);
        url.searchParams.set("ref", ref);
        location.href = url.toString();
      });
    </script>
  </body>
</html>
`;
}

function sopJson(site) {
  return {
    id: `demo-${site.id}`,
    name: site.title,
    description: `Fill the ${site.siteName} demo form on the current tab.`,
    formUrl: `http://127.0.0.1:4173/${site.path.replace(/\.html$/, "")}`,
    steps: [
      ...site.fields.map((f) => ({
        id: f.id,
        action: "fill",
        label: f.label,
        selector: `#${f.id}`,
        valueFrom: f.valueFrom,
      })),
      {
        id: "highlight-review",
        action: "highlight",
        label: "Highlight submit for human review",
        selector: "#submitBtn",
      },
    ],
  };
}

function hubHtml() {
  // Prefer the curated hub in demo/sites/index.html (click-stream + catalog).
  // Regenerating only updates catalog entries if this file is missing.
  const existing = path.join(sitesDir, "index.html");
  if (fs.existsSync(existing)) {
    return fs.readFileSync(existing, "utf8");
  }
  const links = DEMO_SITES.map((s) => {
    const slug = path.basename(s.path).replace(/\.html$/, "");
    return `      <li><a href="./${slug}">${s.siteName}</a> — ${s.title.split("—")[1]?.trim() || s.title}</li>`;
  }).join("\n");
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Coact demo sites</title>
  </head>
  <body>
    <h1>Coact demo sites</h1>
    <ul>
${links}
      <li><a href="../">Vendor registration (original)</a></li>
    </ul>
  </body>
</html>
`;
}

function writeQueueCase(site) {
  const dir = path.join(lobQueueRoot, site.id);
  ensureDir(dir);
  fs.writeFileSync(path.join(dir, "data.json"), JSON.stringify(site.answers, null, 2));
  fs.writeFileSync(
    path.join(dir, "meta.json"),
    JSON.stringify(
      {
        id: site.id,
        title: site.title,
        sopId: `demo-${site.id}`,
        status: "queued",
        lob: DEFAULT_LOB,
        formUrl: `http://127.0.0.1:4173/${site.path.replace(/\.html$/, "")}`,
      },
      null,
      2
    )
  );
  const cleanPath = site.path.replace(/\.html$/, "");
  fs.writeFileSync(
    path.join(dir, "README.txt"),
    `${site.title}\n\n1. npm run demo-form\n2. Open http://127.0.0.1:4173/${cleanPath}\n3. In Coact, open LOB ${DEFAULT_LOB}, then this queue card, and press Start.\n\nAnswers live in data.json.\n`
  );
}

ensureDir(sitesDir);
ensureDir(sopsDir);
ensureDir(lobQueueRoot);

for (const site of DEMO_SITES) {
  const htmlPath = path.join(root, site.path);
  ensureDir(path.dirname(htmlPath));
  fs.writeFileSync(htmlPath, siteHtml(site));
  fs.writeFileSync(path.join(sopsDir, `demo-${site.id}.json`), JSON.stringify(sopJson(site), null, 2));
  writeQueueCase(site);
}

fs.writeFileSync(path.join(sitesDir, "index.html"), hubHtml());

console.log(`Generated ${DEMO_SITES.length} demo sites, SOPs, and queue cards.`);
console.log(`Queue LOB: ${lobQueueRoot}`);
console.log(`Forms hub: http://127.0.0.1:4173/sites/`);
