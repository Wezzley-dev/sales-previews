// Sales Previews — Node server.
// Mobile web app + accounts + Claude item identification + eBay lookups.
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const db = require("./db");

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.MODEL || "claude-sonnet-5-5";
const PUBLIC = path.join(__dirname, "public");
const MAX_BODY = 12 * 1024 * 1024;

// Invite codes: ACCESS_CODES="mom,jake" → required to sign up. OWNER_CODE signs you up as owner (no limits).
const CODES = (process.env.ACCESS_CODES || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
const OWNER = (process.env.OWNER_CODE || "").trim().toLowerCase();
const PER_USER_DAILY = Number(process.env.DAILY_LIMIT_PER_USER || 40);
const GLOBAL_DAILY = Number(process.env.DAILY_LIMIT_TOTAL || 400);

const EBAY_ID = process.env.EBAY_CLIENT_ID;
const EBAY_SECRET = process.env.EBAY_CLIENT_SECRET;
const EBAY_API = "https://api.ebay.com";
let ebayToken = { value: null, exp: 0 };

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml", ".png": "image/png",
};

// ---------------------------------------------------------------- helpers
function send(res, status, body, type = "application/json") {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const fail = (status, msg) => { throw new HttpError(status, msg); };

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new HttpError(413, "Photos too large")); req.destroy(); } else chunks.push(c);
    });
    req.on("end", () => {
      const s = Buffer.concat(chunks).toString("utf8");
      try { resolve(s ? JSON.parse(s) : {}); } catch { reject(new HttpError(400, "Bad request")); }
    });
    req.on("error", reject);
  });
}
const num = (v) => (v === null || v === undefined || v === "" ? null : Number.isFinite(+v) ? +v : null);
const json = (v) => (typeof v === "string" ? JSON.parse(v) : v || {});
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const clientIp = (req) => (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket.remoteAddress || "?";

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(pw, salt, 32);
  return `s1$${salt.toString("hex")}$${key.toString("hex")}`;
}
function checkPassword(pw, stored) {
  const [, salt, key] = String(stored).split("$");
  if (!salt || !key) return false;
  const k = crypto.scryptSync(pw, Buffer.from(salt, "hex"), 32);
  return crypto.timingSafeEqual(k, Buffer.from(key, "hex"));
}

// Simple in-memory brute-force guard for login/signup
const attempts = new Map();
function guard(req) {
  const ip = clientIp(req), now = Date.now();
  const a = (attempts.get(ip) || []).filter((t) => now - t < 15 * 60 * 1000);
  if (a.length >= 20) fail(429, "Too many attempts. Try again in a few minutes.");
  a.push(now); attempts.set(ip, a);
}

// ---------------------------------------------------------------- users
function publicUser(u) {
  return { id: +u.id, username: u.username, display_name: u.display_name || u.username, avatar: u.avatar || "🦊", is_owner: !!u.is_owner, settings: json(u.settings), created_at: u.created_at };
}
async function newSession(userId) {
  const token = crypto.randomBytes(32).toString("hex");
  await db.query("INSERT INTO sessions (token_hash, user_id) VALUES ($1, $2)", [sha(token), userId]);
  return token;
}
async function auth(req, required = true) {
  const h = String(req.headers.authorization || "");
  const token = h.startsWith("Bearer ") ? h.slice(7).trim() : "";
  if (!token) { if (required) fail(401, "Please sign in"); return null; }
  const { rows } = await db.query("UPDATE sessions SET last_seen = now() WHERE token_hash = $1 RETURNING user_id", [sha(token)]);
  if (!rows.length) { if (required) fail(401, "Session expired. Please sign in again."); return null; }
  const u = await db.query("SELECT * FROM users WHERE id = $1", [rows[0].user_id]);
  if (!u.rows.length) fail(401, "Account not found");
  const user = u.rows[0]; user.id = +user.id; user._token = token;
  return user;
}

async function usageToday(userId) {
  const { rows } = await db.query(
    `SELECT count(*) FILTER (WHERE user_id = $1) AS mine, count(*) AS total FROM ai_calls WHERE at >= date_trunc('day', now())`, [userId]);
  return { mine: +rows[0].mine, total: +rows[0].total };
}
async function takeQuota(user) {
  if (user.is_owner) return;
  const u = await usageToday(user.id);
  if (u.mine >= PER_USER_DAILY) fail(429, `Daily limit reached (${PER_USER_DAILY} AI actions). Resets at midnight UTC.`);
  if (u.total >= GLOBAL_DAILY) fail(429, "The app hit its daily limit. Try again tomorrow.");
}
const logCall = (user, kind) => db.query("INSERT INTO ai_calls (user_id, kind) VALUES ($1, $2)", [user.id, kind]);
async function remainingFor(user) {
  if (user.is_owner) return null;
  const u = await usageToday(user.id);
  return Math.max(0, PER_USER_DAILY - u.mine);
}

// ---------------------------------------------------------------- Claude
const PROMPT = `You are an expert reseller who flips items from yard sales, estate sales and thrift stores.
Identify the item and estimate what it realistically SELLS for (sold prices, not asking prices) on the US secondhand market.
Use any visible brand names, model numbers, markings, labels, hallmarks, materials and condition clues.
If a barcode and matching eBay listing titles are provided, treat them as strong evidence of the exact product.
If the buyer corrects what the item is, trust the correction.
If a "price asked" is given, judge whether it's a good flip after ~13% eBay fees and shipping.

Reply with ONLY a JSON object, no markdown, in exactly this shape:
{
  "item": "short specific name (brand + model if known)",
  "category": "e.g. Vintage Electronics",
  "confidence": "high" | "medium" | "low",
  "description": "1-2 sentences: what it is, era, notable features",
  "condition_notes": "what you can see about condition, or what to check",
  "price_low": number,
  "price_high": number,
  "price_basis": "1 sentence on why",
  "ship_estimate": number,
  "sell_speed": "fast" | "average" | "slow",
  "verdict": "BUY" | "MAYBE" | "PASS",
  "verdict_reason": "1 sentence",
  "best_platforms": ["eBay", "..."],
  "search_query": "best search phrase to find sold comps",
  "check_before_buying": ["things to inspect or test"],
  "red_flags": ["fakes, reproductions, missing parts, etc. — empty if none"]
}`;

async function claude(content, maxTokens = 1400) {
  if (!API_KEY) fail(500, "Server is missing ANTHROPIC_API_KEY. Add it in Render → Environment.");
  const r = await fetch(process.env.ANTHROPIC_URL || "https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, messages: [{ role: "user", content }] }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) fail(502, j?.error?.message || `AI error ${r.status}`);
  const out = (j.content || []).map((b) => b.text || "").join("");
  const m = out.match(/\{[\s\S]*\}/);
  if (!m) fail(502, "Couldn't read the AI response");
  try { return JSON.parse(m[0]); } catch { return fail(502, "Couldn't read the AI response"); }
}

// ---------------------------------------------------------------- eBay
async function getEbayToken() {
  if (ebayToken.value && Date.now() < ebayToken.exp) return ebayToken.value;
  const r = await fetch(`${EBAY_API}/identity/v1/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: "Basic " + Buffer.from(`${EBAY_ID}:${EBAY_SECRET}`).toString("base64") },
    body: "grant_type=client_credentials&scope=" + encodeURIComponent("https://api.ebay.com/oauth/api_scope"),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error_description || "eBay login failed — check EBAY_CLIENT_ID / SECRET");
  ebayToken = { value: j.access_token, exp: Date.now() + (j.expires_in - 120) * 1000 };
  return ebayToken.value;
}
const ebayOn = () => !!(EBAY_ID && EBAY_SECRET);
function slimItems(j) {
  return (j.itemSummaries || []).map((it) => ({
    title: it.title, price: Number(it.price?.value) || null, condition: it.condition,
    image: it.thumbnailImages?.[0]?.imageUrl || it.image?.imageUrl, url: it.itemWebUrl, buyingOptions: it.buyingOptions,
  }));
}
async function ebayHeaders() {
  return { Authorization: `Bearer ${await getEbayToken()}`, "X-EBAY-C-MARKETPLACE-ID": "EBAY_US", "Content-Type": "application/json" };
}
async function ebayByGtin(gtin) {
  const r = await fetch(`${EBAY_API}/buy/browse/v1/item_summary/search?gtin=${encodeURIComponent(gtin)}&limit=20`, { headers: await ebayHeaders() });
  const j = await r.json();
  return { items: slimItems(j), total: j.total || 0 };
}
async function ebaySearch(q, imageB64) {
  const headers = await ebayHeaders();
  const out = { keyword: [], image: [], total: 0 };
  const jobs = [];
  if (q) jobs.push(fetch(`${EBAY_API}/buy/browse/v1/item_summary/search?q=${encodeURIComponent(q)}&limit=20`, { headers })
    .then((r) => r.json()).then((j) => { out.keyword = slimItems(j); out.total = j.total || out.keyword.length; }).catch(() => {}));
  if (imageB64) jobs.push(fetch(`${EBAY_API}/buy/browse/v1/item_summary/search_by_image?limit=12`, { method: "POST", headers, body: JSON.stringify({ image: imageB64 }) })
    .then((r) => r.json()).then((j) => { out.image = slimItems(j); }).catch(() => {}));
  await Promise.all(jobs);
  return out;
}
function addStats(e) {
  const p = (e.keyword || []).map((i) => i.price).filter((x) => x > 0).sort((a, b) => a - b);
  if (p.length) e.stats = { count: p.length, low: p[0], high: p[p.length - 1], median: p[Math.floor(p.length / 2)] };
  return e;
}

// ---------------------------------------------------------------- scans
function scanRow(r, full = false) {
  const d = json(r.data);
  const out = {
    ...d, id: +r.id, status: r.status, paid: num(r.paid), est_sell: num(r.est_sell), ship: num(r.ship),
    sold_price: num(r.sold_price), notes: r.notes || "", in_haul: !!r.in_haul, share_id: r.share_id || null,
    thumb: r.thumb || null, created_at: r.created_at, when: new Date(r.created_at).getTime(),
  };
  if (full) out.photo = r.photo || null;
  return out;
}
const LIST_COLS = "id, data, item, thumb, status, paid, est_sell, ship, sold_price, notes, in_haul, share_id, created_at";
async function getScan(user, id) {
  const { rows } = await db.query("SELECT * FROM scans WHERE id = $1 AND user_id = $2", [id, user.id]);
  if (!rows.length) fail(404, "Scan not found");
  return rows[0];
}
const cleanImg = (s, max) => (typeof s === "string" && /^data:image\/[a-z]+;base64,/i.test(s) && s.length <= max ? s : null);

async function identify(req) {
  const user = await auth(req);
  const data = await readBody(req);
  const images = Array.isArray(data.images) ? data.images.slice(0, 4) : [];
  const upc = String(data.upc || "").replace(/\D/g, "").slice(0, 14);
  const correction = String(data.correction || "").trim().slice(0, 200);
  const prevId = num(data.scan_id);
  if (!images.length && !upc && !correction) fail(400, "Add a photo or a barcode");
  await takeQuota(user);

  const prev = prevId ? await getScan(user, prevId) : null;

  const content = [];
  for (const u of images) {
    const m = /^data:(image\/[a-z]+);base64,(.+)$/i.exec(u || "");
    if (!m) fail(400, "Bad image");
    content.push({ type: "image", source: { type: "base64", media_type: m[1], data: m[2] } });
  }
  // A correction re-run reuses the saved photo of the original scan
  if (!content.length && prev && prev.photo) {
    const m = /^data:(image\/[a-z]+);base64,(.+)$/i.exec(prev.photo);
    if (m) content.push({ type: "image", source: { type: "base64", media_type: m[1], data: m[2] } });
  }

  let gtinHits = null;
  if (upc && ebayOn()) { try { gtinHits = await ebayByGtin(upc); } catch { gtinHits = null; } }

  let text = PROMPT;
  if (correction) text += `\n\nThe buyer says this item is actually: "${correction}". Re-identify and re-price it accordingly.`;
  if (upc) {
    text += `\n\nBarcode (UPC/EAN): ${upc}`;
    if (gtinHits && gtinHits.items.length) text += `\neBay listings with this exact barcode:\n` + gtinHits.items.slice(0, 8).map((i) => `- ${i.title}${i.price ? ` ($${i.price})` : ""}`).join("\n");
    else if (!content.length) text += `\nNo eBay listings matched this barcode. Identify it from the barcode if you know it; otherwise set confidence "low" and say a photo is needed.`;
  }
  const asked = data.price || (prev ? json(prev.data).asked : "") || "";
  if (asked) text += `\n\nPrice asked at the sale: $${String(asked).slice(0, 20)}`;
  if (data.notes) text += `\n\nNotes from the buyer: ${String(data.notes).slice(0, 500)}`;
  content.push({ type: "text", text });

  const result = await claude(content);
  await logCall(user, correction ? "correct" : "identify");
  if (upc) result.upc = upc;
  else if (prev && json(prev.data).upc) result.upc = json(prev.data).upc;
  if (correction) result.corrected = correction;
  result.asked = asked ? String(asked) : "";

  if (ebayOn()) {
    try {
      const firstImg = content[0]?.type === "image" ? content[0].source.data : null;
      const e = await ebaySearch(result.search_query || result.item, firstImg);
      if (gtinHits && gtinHits.items.length) { e.keyword = gtinHits.items; e.total = gtinHits.total; e.byBarcode = true; }
      result.ebay = addStats(e);
    } catch (e) { result.ebay = { error: e.message }; }
  } else {
    result.ebay = { error: "eBay not connected yet. Waiting on eBay developer keys." };
  }

  const mid = Math.round(((+result.price_low || 0) + (+result.price_high || 0)) / 2);
  const ship = num(result.ship_estimate) ?? 10;
  let row;
  if (prev) {
    ({ rows: [row] } = await db.query(
      `UPDATE scans SET data = $1, item = $2, est_sell = $3, ship = $4, updated_at = now() WHERE id = $5 AND user_id = $6 RETURNING *`,
      [result, result.item, mid, ship, +prev.id, user.id]));
  } else {
    ({ rows: [row] } = await db.query(
      `INSERT INTO scans (user_id, data, item, thumb, photo, paid, est_sell, ship) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [user.id, result, result.item, cleanImg(data.thumb, 60000), cleanImg(data.photo, 400000), num(asked), mid, ship]));
  }
  const out = scanRow(row, true);
  out.remaining = await remainingFor(user);
  return out;
}

async function listingDraft(req, id) {
  const user = await auth(req);
  const row = await getScan(user, id);
  const d = json(row.data);
  if (d.listing) return d.listing;
  await takeQuota(user);
  const listing = await claude([{ type: "text", text:
`Write an eBay listing for this item a reseller just bought.
Item: ${d.item}
Category: ${d.category}
Details: ${d.description}
Condition notes: ${d.condition_notes}
${row.notes ? "Seller notes: " + row.notes : ""}
${d.upc ? "UPC: " + d.upc : ""}
Suggested price range: $${d.price_low}-$${d.price_high}

Reply with ONLY JSON:
{
  "title": "keyword-rich eBay title, max 80 characters, no ALL CAPS spam",
  "price": number,
  "condition": "eBay condition name",
  "specifics": {"Brand": "...", "Model": "..."},
  "description": "friendly, honest 3-6 sentence description; tell buyers to check photos for condition; no markdown",
  "keywords": ["a few search terms buyers use"]
}` }], 900);
  if (listing.title) listing.title = String(listing.title).slice(0, 80);
  await logCall(user, "listing");
  d.listing = listing;
  await db.query("UPDATE scans SET data = $1 WHERE id = $2", [d, +row.id]);
  return listing;
}

// ---------------------------------------------------------------- routes
async function route(req, res, url) {
  const p = url.pathname, m = req.method;
  let mm;

  if (p === "/healthz") {
    let dbOk = false;
    if (db.enabled()) { try { await db.query("SELECT 1 AS ok"); dbOk = true; } catch {} }
    return send(res, 200, { ok: true, keySet: !!API_KEY, ebay: ebayOn(), db: dbOk, codes: CODES.length });
  }
  if (p === "/api/config") return send(res, 200, { inviteRequired: CODES.length > 0, db: db.enabled(), perDay: PER_USER_DAILY, ebay: ebayOn() });

  if (!db.enabled()) fail(503, "Database not set up yet");

  // --- auth
  if (p === "/api/signup" && m === "POST") {
    guard(req);
    const b = await readBody(req);
    const username = String(b.username || "").trim().toLowerCase();
    const password = String(b.password || "");
    const code = String(b.code || "").trim().toLowerCase();
    if (!/^[a-z0-9_.]{3,20}$/.test(username)) fail(400, "Username: 3–20 letters, numbers, _ or .");
    if (password.length < 6) fail(400, "Password must be at least 6 characters");
    const isOwner = !!OWNER && code === OWNER;
    if (!isOwner && CODES.length && !CODES.includes(code)) fail(403, "That invite code didn't work");
    const exists = await db.query("SELECT 1 AS x FROM users WHERE username = $1", [username]);
    if (exists.rows.length) fail(409, "That username is taken");
    const display = String(b.display_name || "").trim().slice(0, 30) || username;
    const { rows: [u] } = await db.query(
      `INSERT INTO users (username, pass_hash, display_name, is_owner, invite, settings) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [username, hashPassword(password), display, isOwner, code || null, b.settings && typeof b.settings === "object" ? b.settings : {}]);
    const token = await newSession(+u.id);
    return send(res, 200, { token, user: publicUser(u) });
  }
  if (p === "/api/login" && m === "POST") {
    guard(req);
    const b = await readBody(req);
    const { rows } = await db.query("SELECT * FROM users WHERE username = $1", [String(b.username || "").trim().toLowerCase()]);
    if (!rows.length || !checkPassword(String(b.password || ""), rows[0].pass_hash)) fail(401, "Wrong username or password");
    const token = await newSession(+rows[0].id);
    return send(res, 200, { token, user: publicUser(rows[0]) });
  }
  if (p === "/api/logout" && m === "POST") {
    const u = await auth(req, false);
    if (u) await db.query("DELETE FROM sessions WHERE token_hash = $1", [sha(u._token)]);
    return send(res, 200, { ok: true });
  }

  // --- public share (no login)
  if ((mm = p.match(/^\/api\/share\/([a-z0-9]{6,32})$/)) && m === "GET") {
    const { rows } = await db.query(
      `SELECT s.data, s.photo, s.thumb, s.created_at, u.display_name, u.username, u.avatar FROM scans s JOIN users u ON u.id = s.user_id WHERE s.share_id = $1`, [mm[1]]);
    if (!rows.length) fail(404, "This share link was removed");
    const r = rows[0], d = json(r.data);
    delete d.listing; delete d.asked;
    return send(res, 200, { ...d, photo: r.photo || r.thumb, created_at: r.created_at, by: { name: r.display_name || r.username, avatar: r.avatar } });
  }

  // --- me
  if (p === "/api/me" && m === "GET") {
    const u = await auth(req);
    const { rows: [s] } = await db.query(
      `SELECT count(*) AS scans,
              count(*) FILTER (WHERE status IN ('bought','listed','sold')) AS bought,
              count(*) FILTER (WHERE status = 'listed') AS listed,
              count(*) FILTER (WHERE status = 'sold') AS sold,
              coalesce(sum(paid) FILTER (WHERE status IN ('bought','listed','sold')), 0) AS spent,
              coalesce(sum(paid) FILTER (WHERE status = 'sold'), 0) AS sold_cost,
              coalesce(sum(sold_price) FILTER (WHERE status = 'sold'), 0) AS revenue,
              coalesce(sum(ship) FILTER (WHERE status = 'sold'), 0) AS sold_ship,
              coalesce(sum(est_sell) FILTER (WHERE status IN ('bought','listed')), 0) AS inventory_value
         FROM scans WHERE user_id = $1`, [u.id]);
    const stats = Object.fromEntries(Object.entries(s).map(([k, v]) => [k, +v]));
    return send(res, 200, { user: publicUser(u), stats, remaining: await remainingFor(u), perDay: PER_USER_DAILY });
  }
  if (p === "/api/me" && m === "PATCH") {
    const u = await auth(req);
    const b = await readBody(req);
    const display = b.display_name !== undefined ? String(b.display_name).trim().slice(0, 30) || u.username : u.display_name;
    const avatar = b.avatar !== undefined ? String(b.avatar).slice(0, 8) : u.avatar;
    const settings = b.settings && typeof b.settings === "object" ? { ...json(u.settings), ...b.settings } : json(u.settings);
    const { rows: [nu] } = await db.query("UPDATE users SET display_name = $1, avatar = $2, settings = $3 WHERE id = $4 RETURNING *", [display, avatar, settings, u.id]);
    return send(res, 200, { user: publicUser(nu) });
  }
  if (p === "/api/me/password" && m === "POST") {
    const u = await auth(req);
    const b = await readBody(req);
    if (!checkPassword(String(b.old || ""), u.pass_hash)) fail(403, "Current password is wrong");
    if (String(b.new || "").length < 6) fail(400, "New password must be at least 6 characters");
    await db.query("UPDATE users SET pass_hash = $1 WHERE id = $2", [hashPassword(String(b.new)), u.id]);
    await db.query("DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2", [u.id, sha(u._token)]);
    return send(res, 200, { ok: true });
  }
  if (p === "/api/me" && m === "DELETE") {
    const u = await auth(req);
    const b = await readBody(req);
    if (!checkPassword(String(b.password || ""), u.pass_hash)) fail(403, "Password is wrong");
    await db.query("DELETE FROM users WHERE id = $1", [u.id]);
    return send(res, 200, { ok: true });
  }

  // --- scans
  if (p === "/api/identify" && m === "POST") return send(res, 200, await identify(req));
  if (p === "/api/scans" && m === "GET") {
    const u = await auth(req);
    const { rows } = await db.query(`SELECT ${LIST_COLS} FROM scans WHERE user_id = $1 ORDER BY created_at DESC LIMIT 500`, [u.id]);
    return send(res, 200, rows.map((r) => scanRow(r)));
  }
  if ((mm = p.match(/^\/api\/scans\/(\d+)$/))) {
    const u = await auth(req);
    const id = +mm[1];
    if (m === "GET") return send(res, 200, scanRow(await getScan(u, id), true));
    if (m === "DELETE") { await db.query("DELETE FROM scans WHERE id = $1 AND user_id = $2", [id, u.id]); return send(res, 200, { ok: true }); }
    if (m === "PATCH") {
      const b = await readBody(req);
      const row = await getScan(u, id);
      const STAT = ["watching", "bought", "listed", "sold", "passed"];
      const v = {
        status: STAT.includes(b.status) ? b.status : row.status,
        paid: "paid" in b ? num(b.paid) : num(row.paid),
        est_sell: "est_sell" in b ? num(b.est_sell) : num(row.est_sell),
        ship: "ship" in b ? num(b.ship) : num(row.ship),
        sold_price: "sold_price" in b ? num(b.sold_price) : num(row.sold_price),
        notes: "notes" in b ? String(b.notes || "").slice(0, 2000) : row.notes,
        in_haul: "in_haul" in b ? !!b.in_haul : !!row.in_haul,
      };
      const { rows: [r] } = await db.query(
        `UPDATE scans SET status=$1, paid=$2, est_sell=$3, ship=$4, sold_price=$5, notes=$6, in_haul=$7, updated_at=now() WHERE id=$8 AND user_id=$9 RETURNING *`,
        [v.status, v.paid, v.est_sell, v.ship, v.sold_price, v.notes, v.in_haul, id, u.id]);
      return send(res, 200, scanRow(r, true));
    }
  }
  if ((mm = p.match(/^\/api\/scans\/(\d+)\/share$/))) {
    const u = await auth(req);
    if (m === "POST") {
      const row = await getScan(u, +mm[1]);
      let sid = row.share_id;
      if (!sid) { sid = crypto.randomBytes(6).toString("hex"); await db.query("UPDATE scans SET share_id = $1 WHERE id = $2", [sid, +row.id]); }
      return send(res, 200, { share_id: sid });
    }
    if (m === "DELETE") {
      await db.query("UPDATE scans SET share_id = NULL WHERE id = $1 AND user_id = $2", [+mm[1], u.id]);
      return send(res, 200, { ok: true });
    }
  }
  if ((mm = p.match(/^\/api\/scans\/(\d+)\/listing$/)) && m === "POST") return send(res, 200, await listingDraft(req, +mm[1]));
  if (p === "/api/haul/clear" && m === "POST") {
    const u = await auth(req);
    await db.query("UPDATE scans SET in_haul = FALSE WHERE user_id = $1", [u.id]);
    return send(res, 200, { ok: true });
  }
  fail(404, "Not found");
}

function serveStatic(res, pathname) {
  const p = pathname === "/" ? "/index.html" : pathname;
  const file = path.normalize(path.join(PUBLIC, p));
  if (!file.startsWith(PUBLIC)) return send(res, 403, "Forbidden", "text/plain");
  fs.readFile(file, (err, buf) => {
    if (err) {
      // extensionless paths (e.g. /s/abc123 share links) get the app shell
      if (!path.extname(p)) return fs.readFile(path.join(PUBLIC, "index.html"), (e2, b2) => (e2 ? send(res, 404, "Not found", "text/plain") : send(res, 200, b2, TYPES[".html"])));
      return send(res, 404, "Not found", "text/plain");
    }
    send(res, 200, buf, TYPES[path.extname(file)] || "application/octet-stream");
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname.startsWith("/api/") || url.pathname === "/healthz") {
    try { await route(req, res, url); }
    catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(e);
      send(res, status, { error: status === 500 ? "Server error" : e.message });
    }
    return;
  }
  serveStatic(res, url.pathname);
});

(async () => {
  if (db.enabled()) {
    for (let i = 0; i < 5; i++) {
      try { await db.migrate(); console.log("DB ready"); break; }
      catch (e) { console.error("DB migrate failed, retrying:", e.message); await new Promise((r) => setTimeout(r, 3000)); }
    }
  }
  server.listen(PORT, () => console.log(`Sales Previews on :${PORT}`));
})();
