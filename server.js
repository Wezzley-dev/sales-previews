// Sales Previews — zero-dependency Node server.
// Serves the mobile web app, identifies items with Claude, and checks eBay.
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.MODEL || "claude-sonnet-5-5";
const PUBLIC = path.join(__dirname, "public");
const MAX_BODY = 12 * 1024 * 1024; // 12 MB

// ---- Access control ----
// ACCESS_CODES: comma-separated invite codes, e.g. "wes,mom,flipteam". Empty = open to anyone (still rate-limited).
// OWNER_CODE: optional code with no daily limit (for you).
const CODES = (process.env.ACCESS_CODES || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
const OWNER = (process.env.OWNER_CODE || "").trim().toLowerCase();
const PER_USER_DAILY = Number(process.env.DAILY_LIMIT_PER_USER || 40);
const GLOBAL_DAILY = Number(process.env.DAILY_LIMIT_TOTAL || 400);
const usage = { day: "", total: 0, by: new Map() };

const EBAY_ID = process.env.EBAY_CLIENT_ID;
const EBAY_SECRET = process.env.EBAY_CLIENT_SECRET;
const EBAY_API = "https://api.ebay.com";
let ebayToken = { value: null, exp: 0 };

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

const PROMPT = `You are an expert reseller who flips items from yard sales, estate sales and thrift stores.
Identify the item and estimate what it realistically SELLS for (sold prices, not asking prices) on the US secondhand market.
Use any visible brand names, model numbers, markings, labels, hallmarks, materials and condition clues.
If a barcode and matching eBay listing titles are provided, treat them as strong evidence of the exact product.
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
  "ship_estimate": number (typical USD cost to ship it domestically; 0 if local pickup only makes sense),
  "verdict": "BUY" | "MAYBE" | "PASS",
  "verdict_reason": "1 sentence",
  "best_platforms": ["eBay", "..."],
  "search_query": "best search phrase to find sold comps",
  "check_before_buying": ["things to inspect or test"],
  "red_flags": ["fakes, reproductions, missing parts, etc. — empty if none"]
}`;

function send(res, status, body, type = "application/json") {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error("Photos too large"));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function clientIp(req) {
  return (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket.remoteAddress || "?";
}

// Returns { ok, status, error, who, owner }
function checkAccess(req) {
  const code = String(req.headers["x-access-code"] || "").trim().toLowerCase();
  const owner = !!OWNER && code === OWNER;
  if (!owner && CODES.length && !CODES.includes(code)) {
    return { ok: false, status: 401, error: "Invite code required" };
  }
  return { ok: true, owner, who: owner ? "owner" : CODES.length ? "code:" + code : "ip:" + clientIp(req) };
}

function takeQuota(who, owner) {
  const today = new Date().toISOString().slice(0, 10);
  if (usage.day !== today) Object.assign(usage, { day: today, total: 0, by: new Map() });
  if (owner) { usage.total++; return null; }
  const used = usage.by.get(who) || 0;
  if (used >= PER_USER_DAILY) return `Daily limit reached (${PER_USER_DAILY} scans). Resets at midnight UTC.`;
  if (usage.total >= GLOBAL_DAILY) return "The app hit its daily scan limit. Try again tomorrow.";
  usage.by.set(who, used + 1);
  usage.total++;
  return null;
}
function refundQuota(who, owner) {
  usage.total = Math.max(0, usage.total - 1);
  if (!owner) usage.by.set(who, Math.max(0, (usage.by.get(who) || 1) - 1));
}
function remaining(who, owner) {
  if (owner) return null;
  const today = new Date().toISOString().slice(0, 10);
  const used = usage.day === today ? usage.by.get(who) || 0 : 0;
  return Math.max(0, PER_USER_DAILY - used);
}

// ---------- eBay Browse API (active listings, search by image, GTIN) ----------
async function getEbayToken() {
  if (ebayToken.value && Date.now() < ebayToken.exp) return ebayToken.value;
  const r = await fetch(`${EBAY_API}/identity/v1/oauth2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: "Basic " + Buffer.from(`${EBAY_ID}:${EBAY_SECRET}`).toString("base64"),
    },
    body: "grant_type=client_credentials&scope=" + encodeURIComponent("https://api.ebay.com/oauth/api_scope"),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error_description || "eBay login failed — check EBAY_CLIENT_ID / SECRET");
  ebayToken = { value: j.access_token, exp: Date.now() + (j.expires_in - 120) * 1000 };
  return ebayToken.value;
}

function slimItems(j) {
  return (j.itemSummaries || []).map((it) => ({
    title: it.title,
    price: Number(it.price?.value) || null,
    condition: it.condition,
    image: it.thumbnailImages?.[0]?.imageUrl || it.image?.imageUrl,
    url: it.itemWebUrl,
    buyingOptions: it.buyingOptions,
  }));
}

async function ebayHeaders() {
  const token = await getEbayToken();
  return { Authorization: `Bearer ${token}`, "X-EBAY-C-MARKETPLACE-ID": "EBAY_US", "Content-Type": "application/json" };
}

async function ebayByGtin(gtin) {
  const headers = await ebayHeaders();
  const r = await fetch(`${EBAY_API}/buy/browse/v1/item_summary/search?gtin=${encodeURIComponent(gtin)}&limit=20`, { headers });
  const j = await r.json();
  return { items: slimItems(j), total: j.total || 0 };
}

async function ebaySearch(q, imageB64) {
  const headers = await ebayHeaders();
  const out = { keyword: [], image: [], total: 0 };
  const jobs = [];
  if (q) {
    jobs.push(
      fetch(`${EBAY_API}/buy/browse/v1/item_summary/search?q=${encodeURIComponent(q)}&limit=20`, { headers })
        .then((r) => r.json())
        .then((j) => { out.keyword = slimItems(j); out.total = j.total || out.keyword.length; })
        .catch(() => {})
    );
  }
  if (imageB64) {
    jobs.push(
      fetch(`${EBAY_API}/buy/browse/v1/item_summary/search_by_image?limit=12`, {
        method: "POST", headers, body: JSON.stringify({ image: imageB64 }),
      })
        .then((r) => r.json())
        .then((j) => { out.image = slimItems(j); })
        .catch(() => {})
    );
  }
  await Promise.all(jobs);
  return out;
}

function addStats(e) {
  const prices = (e.keyword || []).map((i) => i.price).filter((p) => p > 0).sort((a, b) => a - b);
  if (prices.length) {
    e.stats = { count: prices.length, low: prices[0], high: prices[prices.length - 1], median: prices[Math.floor(prices.length / 2)] };
  }
  return e;
}

async function identify(req, res) {
  if (!API_KEY) return send(res, 500, { error: "Server is missing ANTHROPIC_API_KEY. Add it in Render → Environment." });
  const acc = checkAccess(req);
  if (!acc.ok) return send(res, acc.status, { error: acc.error, needCode: true });

  let data;
  try {
    data = JSON.parse(await readBody(req));
  } catch (e) {
    return send(res, 400, { error: e.message || "Bad request" });
  }
  const images = Array.isArray(data.images) ? data.images.slice(0, 4) : [];
  const upc = String(data.upc || "").replace(/\D/g, "").slice(0, 14);
  if (!images.length && !upc) return send(res, 400, { error: "Add a photo or a barcode" });

  const quotaErr = takeQuota(acc.who, acc.owner);
  if (quotaErr) return send(res, 429, { error: quotaErr });

  const content = [];
  for (const dataUrl of images) {
    const m = /^data:(image\/[a-z]+);base64,(.+)$/i.exec(dataUrl || "");
    if (!m) return send(res, 400, { error: "Bad image" });
    content.push({ type: "image", source: { type: "base64", media_type: m[1], data: m[2] } });
  }

  const ebayOn = !!(EBAY_ID && EBAY_SECRET);
  let gtinHits = null;
  if (upc && ebayOn) {
    try { gtinHits = await ebayByGtin(upc); } catch { gtinHits = null; }
  }

  let text = PROMPT;
  if (upc) {
    text += `\n\nBarcode (UPC/EAN): ${upc}`;
    if (gtinHits && gtinHits.items.length) {
      text += `\neBay listings with this exact barcode:\n` + gtinHits.items.slice(0, 8).map((i) => `- ${i.title}${i.price ? ` ($${i.price})` : ""}`).join("\n");
    } else if (!images.length) {
      text += `\nNo eBay listings matched this barcode. Identify it from the barcode if you know it; otherwise set confidence "low" and say a photo is needed.`;
    }
  }
  if (data.price) text += `\n\nPrice asked at the sale: $${String(data.price).slice(0, 20)}`;
  if (data.notes) text += `\n\nNotes from the buyer: ${String(data.notes).slice(0, 500)}`;
  content.push({ type: "text", text });

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, max_tokens: 1400, messages: [{ role: "user", content }] }),
    });
    const j = await r.json();
    if (!r.ok) { refundQuota(acc.who, acc.owner); return send(res, 502, { error: j?.error?.message || `AI error ${r.status}` }); }
    const out = (j.content || []).map((b) => b.text || "").join("");
    const match = out.match(/\{[\s\S]*\}/);
    if (!match) { refundQuota(acc.who, acc.owner); return send(res, 502, { error: "Couldn't read the AI response" }); }
    const result = JSON.parse(match[0]);
    if (upc) result.upc = upc;

    if (ebayOn) {
      try {
        const firstImg = content[0]?.type === "image" ? content[0].source.data : null;
        const e = await ebaySearch(result.search_query || result.item, firstImg);
        if (gtinHits && gtinHits.items.length) { e.keyword = gtinHits.items; e.total = gtinHits.total; e.byBarcode = true; }
        result.ebay = addStats(e);
      } catch (e) {
        result.ebay = { error: e.message };
      }
    } else {
      result.ebay = { error: "eBay not set up yet (add EBAY_CLIENT_ID and EBAY_CLIENT_SECRET in Render)" };
    }
    result.remaining = remaining(acc.who, acc.owner);
    send(res, 200, result);
  } catch (e) {
    refundQuota(acc.who, acc.owner);
    send(res, 502, { error: e.message || "AI request failed" });
  }
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    if (req.method === "POST" && url.pathname === "/api/identify") {
      try { return await identify(req, res); } catch (e) { return send(res, 400, { error: e.message }); }
    }
    if (url.pathname === "/api/config") {
      const acc = checkAccess(req);
      return send(res, 200, {
        codeRequired: CODES.length > 0,
        unlocked: acc.ok,
        owner: !!acc.owner,
        remaining: acc.ok ? remaining(acc.who, acc.owner) : 0,
        perDay: PER_USER_DAILY,
      });
    }
    if (url.pathname === "/healthz") return send(res, 200, { ok: true, keySet: !!API_KEY, ebay: !!(EBAY_ID && EBAY_SECRET), codes: CODES.length });
    const p = url.pathname === "/" ? "/index.html" : url.pathname;
    const file = path.normalize(path.join(PUBLIC, p));
    if (!file.startsWith(PUBLIC)) return send(res, 403, "Forbidden", "text/plain");
    fs.readFile(file, (err, buf) => {
      if (err) return send(res, 404, "Not found", "text/plain");
      send(res, 200, buf, TYPES[path.extname(file)] || "application/octet-stream");
    });
  })
  .listen(PORT, () => console.log(`Sales Previews on :${PORT}`));
