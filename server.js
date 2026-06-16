const { spawn } = require("child_process");
const http = require("http");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const PORT = parseInt(process.env.PORT || "3458", 10);
const MODEL = process.env.OP_MODEL || "deepseek/deepseek-v4-pro";
const AGENT = process.env.OP_AGENT || "build";
const WORKDIR = process.env.OP_WORKDIR || process.cwd();
const ROOT = path.resolve(__dirname, "..");
const OPENCODE = "C:\\nvm4w\\nodejs\\node_modules\\opencode-ai\\bin\\opencode.exe";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

function serveStatic(req, res) {
  let fp = req.url === "/" ? "/index.html" : req.url;
  fp = path.join(__dirname, "public", fp);
  const ext = path.extname(fp);
  try {
    if (!fs.existsSync(fp) || fs.statSync(fp).isDirectory()) return false;
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream", "Cache-Control": "private, no-cache, no-store, must-revalidate", "CDN-Cache-Control": "no-store" });
    res.end(fs.readFileSync(fp));
    return true;
  } catch { return false; }
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      try { resolve(JSON.parse(body)); }
      catch { resolve(null); }
    });
  });
}

function runOpenCode(sessionId, message, directory) {
  const args = [
    "run", message,
    "--model", MODEL,
    "--agent", AGENT,
    "--format", "json",
  ];
  if (sessionId) {
    args.push("--session", sessionId);
    if (directory) {
      args.push("--dir", directory);
    }
  } else {
    args.push("--dir", WORKDIR);
  }

  const child = spawn(OPENCODE, args, {
    windowsHide: true,
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
  });

  return child;
}

function listFiles(dirPath, depth) {
  if (depth <= 0) return [];
  if (!fs.existsSync(dirPath)) return [];
  const skip = new Set(["node_modules", ".git"]);
  try {
    return fs.readdirSync(dirPath, { withFileTypes: true }).map(entry => {
      if (skip.has(entry.name)) return null;
      const fullPath = path.join(dirPath, entry.name);
      const item = { name: entry.name, type: entry.isDirectory() ? "dir" : "file", _path: fullPath };
      if (entry.isDirectory()) {
        item.children = listFiles(fullPath, depth - 1);
      }
      return item;
    }).filter(Boolean);
  } catch {
    return [];
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url.startsWith("/api/files/")) {
    const dirPath = decodeURIComponent(req.url.slice("/api/files/".length));
    const tree = listFiles(dirPath, 3);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(tree));
    return;
  }

  if (req.method === "GET" && req.url.startsWith("/api/file/")) {
    const filePath = decodeURIComponent(req.url.slice("/api/file/".length));
    try {
      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        res.writeHead(404); res.end("not found"); return;
      }
      const content = fs.readFileSync(filePath, "utf8").slice(0, 50000);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ path: filePath, content }));
    } catch {
      res.writeHead(500); res.end("read error");
    }
    return;
  }
  if (req.method === "GET" && !req.url.startsWith("/api/")) {
    if (serveStatic(req, res)) return;
  }

  if (req.method === "POST" && req.url === "/api/send") {
    const body = await readBody(req);
    if (!body?.message) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "message required" }));
      return;
    }

    const sessionId = body.sessionId || null;

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    });

    let closed = false;
    req.on("close", () => { closed = true; });

    res.write(": ok\n\n");

    const child = runOpenCode(sessionId, body.message, body.directory);
    let buf = "";
    let sessionEmitted = null;

    const heartbeat = setInterval(() => {
      if (!closed) res.write(": hb\n\n");
    }, 12000);

    function processChunk(chunk) {
      if (closed) return;
      buf += chunk.toString();
      const lines = buf.split("\n");
      buf = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const evt = JSON.parse(line);
          res.write(`data: ${JSON.stringify(evt)}\n\n`);

          if (!sessionEmitted && !sessionId && evt.sessionID && evt.type !== "session") {
            sessionEmitted = evt.sessionID;
            res.write(`data: ${JSON.stringify({ type: "session", id: evt.sessionID })}\n\n`);
          }
        } catch {}
      }
    }

    child.stdout.on("data", processChunk);

    let doneCalled = false;
    const done = () => {
      if (doneCalled || closed) return;
      doneCalled = true;
      clearInterval(heartbeat);
      if (buf.trim()) processChunk("\n");
      clearTimeout(timeout);
      res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
      res.end();
    };

    child.stdout.on("end", done);
    child.on("close", () => { done(); });
    child.stderr.on("data", (d) => { console.error("[opencode stderr]", d.toString().slice(0, 200)); });

    const timeout = setTimeout(() => {
      console.error("[opencode] timeout, killing");
      child.kill();
      done();
    }, 180000);

    child.on("error", (err) => {
      clearInterval(heartbeat);
      if (!closed) {
        res.write(`data: ${JSON.stringify({ type: "error", error: err.message })}\n\n`);
        res.end();
      }
    });

    return;
  }

  if (req.method === "GET" && req.url.startsWith("/api/session/")) {
    const sessionId = req.url.slice("/api/session/".length);
    const child = spawn(OPENCODE, ["export", sessionId], {
      windowsHide: true,
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let out = "", err = "";
    child.stdout.on("data", (d) => { out += d.toString(); });
    child.stderr.on("data", (d) => { err += d.toString(); });

    child.on("close", (code) => {
      if (code === 0) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(out);
      } else {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify([]));
      }
    });

    child.on("error", () => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify([]));
    });

    return;
  }

  if (req.method === "GET" && req.url.split("?")[0] === "/api/sessions") {
    const dirs = [ROOT];
    if (WORKDIR && WORKDIR !== ROOT) dirs.push(WORKDIR);

    const queries = dirs.map((cwd) => new Promise((resolve) => {
      const child = spawn(OPENCODE, ["session", "list", "--format", "json", "--pure"], {
        windowsHide: true,
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let out = "";
      child.stdout.on("data", (d) => { out += d.toString(); });
      child.on("close", () => { try { resolve(JSON.parse(out)); } catch { resolve([]); } });
      child.on("error", () => resolve([]));
    }));

    const results = await Promise.all(queries);
    const seen = new Set();
    const merged = [];
    for (const list of results) {
      for (const s of (list || [])) {
        if (!seen.has(s.id)) {
          seen.add(s.id);
          merged.push(s);
        }
      }
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(merged));
    return;
  }

  if (req.method === "DELETE" && req.url.startsWith("/api/session/")) {
    const sessionId = req.url.slice("/api/session/".length);
    const child = spawn(OPENCODE, ["session", "delete", sessionId], {
      windowsHide: true,
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.on("close", () => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    child.on("error", () => {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false }));
    });

    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
});

server.listen(PORT, () => {
  console.error(`opencode-web http://localhost:${PORT}`);
});
