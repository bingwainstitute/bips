// BIPS web server for Render (Web Service). Zero dependencies – Node 18+.
//  - serves the website from /public
//  - GET  /js/config.js     -> built from env vars (no keys committed to git)
//  - GET  /health           -> Render health check
//  - POST /api/send-email   -> application confirmation + status emails (via Resend)
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, "public");
const env = (k, d = "") => (process.env[k] || d).trim();
const SUPABASE_URL = () => env("SUPABASE_URL").replace(/\/+$/, "");
const ANON = () => env("SUPABASE_ANON_KEY");
const SERVICE = () => env("SUPABASE_SERVICE_ROLE_KEY"); // server-side ONLY

const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8", ".json": "application/json",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml",
  ".ico": "image/x-icon", ".webp": "image/webp", ".txt": "text/plain; charset=utf-8",
  ".woff2": "font/woff2",
};

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Frame-Options": "SAMEORIGIN",
    ...headers,
  });
  res.end(body);
}
const json = (res, status, obj) => send(res, status, JSON.stringify(obj), { "Content-Type": "application/json", "Cache-Control": "no-store" });

// ---------- Supabase REST helpers (server side) ----------
async function sbRest(pathAndQuery, opts = {}) {
  const key = SERVICE();
  const r = await fetch(`${SUPABASE_URL()}/rest/v1/${pathAndQuery}`, {
    ...opts,
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(opts.headers || {}) },
  });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${await r.text()}`);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}
const first = (rows) => (Array.isArray(rows) && rows.length ? rows[0] : null);

async function getSettings() {
  const rows = (await sbRest("site_settings?select=key,value")) || [];
  const s = {};
  rows.forEach((r) => (s[r.key] = r.value || ""));
  return s;
}

async function requireAdmin(authHeader) {
  const token = (authHeader || "").replace(/^Bearer\s+/i, "");
  if (!token) return { status: 401, error: "Unauthorized" };
  const r = await fetch(`${SUPABASE_URL()}/auth/v1/user`, { headers: { apikey: ANON(), Authorization: `Bearer ${token}` } });
  if (!r.ok) return { status: 401, error: "Unauthorized" };
  const user = await r.json();
  if (!user?.id || !/^[0-9a-f-]{36}$/i.test(user.id)) return { status: 401, error: "Unauthorized" };
  const adm = first(await sbRest(`admin_users?select=user_id&user_id=eq.${user.id}`));
  if (!adm) return { status: 403, error: "Forbidden" };
  return { user };
}

// ---------- email ----------
function layout(title, bodyHtml, s) {
  return `<div style="font-family:Arial,Helvetica,sans-serif;background:#f4f6fa;padding:24px">
  <div style="max-width:580px;margin:auto;background:#fff;border-radius:10px;overflow:hidden;border:1px solid #e3e8f0">
    <div style="background:#0B2A5B;color:#fff;padding:20px 24px">
      <div style="font-size:18px;font-weight:bold">Bingwa Institute of Professional Studies</div>
      <div style="color:#E8A317;font-size:13px;margin-top:2px">Kuwa Bingwa – Become a Champion</div>
    </div>
    <div style="padding:24px;color:#1b2540;line-height:1.55;font-size:15px">
      <h2 style="margin:0 0 12px;color:#0B2A5B;font-size:20px">${esc(title)}</h2>${bodyHtml}
    </div>
    <div style="background:#f4f6fa;padding:16px 24px;font-size:12px;color:#5b6682">
      ${esc(s.phone || "")} ${s.phone && s.email ? "·" : ""} ${esc(s.email || "")}<br>${esc(s.address || "")}<br>
      <b>Your Future, Our Priority.</b>
    </div></div></div>`;
}

async function sendMail(to, subject, html, replyTo) {
  const key = env("RESEND_API_KEY");
  if (!key) return { ok: false, reason: "RESEND_API_KEY is not set on the server" };
  const from = env("MAIL_FROM") || "BIPS <onboarding@resend.dev>";
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [to], subject, html, ...(replyTo ? { reply_to: replyTo } : {}) }),
  });
  if (!r.ok) return { ok: false, reason: await r.text() };
  return { ok: true };
}

async function handleSendEmail(req, res, body) {
  if (!SUPABASE_URL() || !SERVICE()) return json(res, 500, { error: "Server is missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" });
  const s = await getSettings();

  if (body.type === "confirmation") {
    const ref = String(body.reference_number || "").toUpperCase();
    const email = String(body.email || "").toLowerCase();
    if (!/^[A-Z0-9-]{4,40}$/.test(ref) || !/^[^\s@,()]+@[^\s@,()]+\.[^\s@,()]+$/.test(email)) return json(res, 400, { sent: false, reason: "invalid input" });
    const a = first(await sbRest(`applications?select=*&reference_number=eq.${encodeURIComponent(ref)}&email=eq.${encodeURIComponent(email)}`));
    if (!a) return json(res, 404, { sent: false, reason: "not found" });
    if (a.confirmation_sent) return json(res, 200, { sent: false, reason: "already sent" });
    const html = layout("We have received your application",
      `<p>Dear ${esc(a.full_name)},</p>
       <p>Thank you for applying to BIPS. Your application for <b>${esc(a.course_name)}</b> was received successfully.</p>
       <p style="background:#fff7e0;border-left:4px solid #E8A317;padding:12px 14px;margin:16px 0">
         Your reference number<br><b style="font-size:20px;color:#0B2A5B;letter-spacing:1px">${esc(a.reference_number)}</b></p>
       <p>Keep this number safe. You can track your application any time on our website using this reference number and your email address.</p>
       <p>Our admissions team will review your application and contact you.</p>`, s);
    const r = await sendMail(a.email, `BIPS application received – ${a.reference_number}`, html, s.email);
    if (r.ok) await sbRest(`applications?id=eq.${a.id}`, { method: "PATCH", body: JSON.stringify({ confirmation_sent: true }), headers: { Prefer: "return=minimal" } });
    return json(res, 200, { sent: r.ok, reason: r.reason });
  }

  if (body.type === "status") {
    const auth = await requireAdmin(req.headers.authorization);
    if (auth.error) return json(res, auth.status, { error: auth.error });
    const id = String(body.application_id || "");
    if (!/^[0-9a-f-]{36}$/i.test(id)) return json(res, 400, { error: "invalid application_id" });
    const a = first(await sbRest(`applications?select=*&id=eq.${id}`));
    if (!a) return json(res, 404, { error: "Application not found" });

    const colors = { Approved: "#1a7f37", Rejected: "#b42318", "Under Review": "#b7791f", Pending: "#5b6682" };
    const intro = {
      Approved: "Congratulations! We are pleased to inform you that your application has been <b>approved</b>.",
      Rejected: "Thank you for your interest in BIPS. After review, we are unable to offer you admission for this course at this time.",
      "Under Review": "Your application is now <b>under review</b> by our admissions team.",
      Pending: "Your application status has been updated.",
    };
    const comment = a.admin_comments
      ? `<div style="background:#f4f6fa;border-radius:8px;padding:12px 14px;margin:16px 0"><b>Message from admissions:</b><br>${esc(a.admin_comments).replace(/\n/g, "<br>")}</div>` : "";
    const html = layout(`Application ${a.status}`,
      `<p>Dear ${esc(a.full_name)},</p><p>${intro[a.status] || intro.Pending}</p>
       <p>Course: <b>${esc(a.course_name)}</b><br>Reference: <b>${esc(a.reference_number)}</b><br>
       Status: <b style="color:${colors[a.status] || "#0B2A5B"}">${esc(a.status)}</b></p>${comment}
       <p>You can check your status any time on our website using your reference number and email.</p>`, s);
    const r = await sendMail(a.email, `BIPS application ${a.status} – ${a.reference_number}`, html, s.email);
    return json(res, 200, { sent: r.ok, reason: r.reason });
  }
  return json(res, 400, { error: "Unknown type" });
}

// ---------- tiny rate limiter (per IP, per minute) ----------
const hits = new Map();
function limited(ip, max = 20) {
  const now = Date.now(), w = 60_000;
  const arr = (hits.get(ip) || []).filter((t) => now - t < w);
  arr.push(now); hits.set(ip, arr);
  if (hits.size > 5000) hits.clear();
  return arr.length > max;
}

function readBody(req, limit = 20_000) {
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on("data", (c) => { n += c.length; if (n > limit) { reject(new Error("too large")); req.destroy(); } else chunks.push(c); });
    req.on("end", () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString() || "{}")); } catch { reject(new Error("bad json")); } });
    req.on("error", reject);
  });
}

// ---------- static files ----------
function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel.endsWith("/")) rel += "index.html";
  if (rel === "") rel = "/index.html";
  let file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + path.sep) && file !== PUBLIC) return send(res, 403, "Forbidden");
  if (!path.extname(file) && fs.existsSync(file + ".html")) file += ".html"; // /about -> about.html
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      return fs.readFile(path.join(PUBLIC, "index.html"), (e2, buf) =>
        send(res, 404, e2 ? "Not found" : buf, { "Content-Type": "text/html; charset=utf-8" }));
    }
    const ext = path.extname(file).toLowerCase();
    const cache = ext === ".html" || file.endsWith(path.join("js", "config.js")) ? "no-cache" : "public, max-age=86400";
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream", "Content-Length": st.size, "Cache-Control": cache,
      "X-Content-Type-Options": "nosniff", "X-Frame-Options": "SAMEORIGIN", "Referrer-Policy": "strict-origin-when-cross-origin",
    });
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://x");
    const p = url.pathname;

    if (p === "/health") return json(res, 200, { ok: true });

    if (p === "/js/config.js") {
      const cfg = { SUPABASE_URL: SUPABASE_URL() || "https://YOUR-PROJECT-REF.supabase.co", SUPABASE_ANON_KEY: ANON() || "YOUR-ANON-PUBLIC-KEY", SITE_NAME: env("SITE_NAME", "Bingwa Institute of Professional Studies") };
      return send(res, 200, `window.BIPS_CONFIG = ${JSON.stringify(cfg)};`, { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "no-cache" });
    }

    if (p === "/api/send-email") {
      if (req.method !== "POST") return json(res, 405, { error: "POST only" });
      const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
      if (limited(ip)) return json(res, 429, { error: "Too many requests, try again in a minute" });
      let body;
      try { body = await readBody(req); } catch (e) { return json(res, 400, { error: String(e.message) }); }
      return await handleSendEmail(req, res, body);
    }
    if (p.startsWith("/api/")) return json(res, 404, { error: "Not found" });

    if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "Method not allowed");
    return serveStatic(req, res, p);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) json(res, 500, { error: "Server error" });
  }
});

server.listen(PORT, "0.0.0.0", () => console.log(`BIPS server listening on :${PORT}`));
