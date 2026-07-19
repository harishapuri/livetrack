const http = require("http");
const fs = require("fs");
const path = require("path");

const DEFAULT_PORT = 17322;

/**
 * Tiny local server so Chrome can view filled/cleared PDFs over http
 * (file:// tabs do not refresh when the file changes on disk).
 */
function createPdfViewServer({ port = DEFAULT_PORT } = {}) {
  /** @type {Map<string, { filePath: string, updatedAt: number }>} */
  const views = new Map();
  let server = null;

  function publish(cardId, filePath) {
    const id = String(cardId || "")
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "");
    if (!id || !filePath || !fs.existsSync(filePath)) {
      return null;
    }
    const updatedAt = Date.now();
    views.set(id, { filePath, updatedAt });
    return {
      id,
      url: `http://127.0.0.1:${port}/pdf/${id}.pdf?t=${updatedAt}`,
      baseUrl: `http://127.0.0.1:${port}/pdf/${id}.pdf`,
      updatedAt,
    };
  }

  function getView(cardId) {
    const id = String(cardId || "");
    return views.get(id) || null;
  }

  function start() {
    if (server) return Promise.resolve(port);
    return new Promise((resolve, reject) => {
      server = http.createServer((req, res) => {
        try {
          const url = new URL(req.url || "/", `http://127.0.0.1:${port}`);
          const match = url.pathname.match(/^\/pdf\/([a-z0-9_-]+)\.pdf$/i);
          if (!match) {
            res.writeHead(404, { "Content-Type": "text/plain" });
            res.end("Not found");
            return;
          }
          const id = match[1].toLowerCase();
          const view = views.get(id);
          if (!view || !fs.existsSync(view.filePath)) {
            res.writeHead(404, { "Content-Type": "text/plain" });
            res.end("PDF not published");
            return;
          }
          const data = fs.readFileSync(view.filePath);
          res.writeHead(200, {
            "Content-Type": "application/pdf",
            "Content-Length": data.length,
            "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
            Pragma: "no-cache",
            Expires: "0",
            "Access-Control-Allow-Origin": "*",
          });
          res.end(data);
        } catch (err) {
          res.writeHead(500, { "Content-Type": "text/plain" });
          res.end(err.message || "error");
        }
      });
      server.on("error", reject);
      server.listen(port, "127.0.0.1", () => {
        console.log(`[coact] PDF view server http://127.0.0.1:${port}`);
        resolve(port);
      });
    });
  }

  function close() {
    if (!server) return;
    try {
      server.close();
    } catch {
      /* ignore */
    }
    server = null;
  }

  return { start, close, publish, getView, port };
}

module.exports = { createPdfViewServer, DEFAULT_PORT };
