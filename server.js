// Sales Previews — zero-dependency Node server.
// Serves the mobile web app and proxies photos to Claude for identification + pricing.
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.MODEL || "claude-sonnet-5-5";
const PUBLIC = path.join(__dirname, "public");
const EBAY_ID = process.env.EBAY_CLIENT_ID;
const EBAY_SECRET = process.env.EBAY_CLIENT_SECRET;
const EBAY_API = "https://api.ebay.com";
let ebayToken = { value: null, exp: 0 };
const MAX_BODY = 12 * 1024 * 1024; // 12 MB

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
Identify the item(s) in the photo(s) and estimate resale value in USD on the secondhand market.
Use any visible brand names, model numbers, markings, labels, hallmarks, materials and condition clues.
If a "price asked" is given, judge whether it's a good flip after fees (~13% eBay) and shipping.

Reply with ONLY a JSON object, no markdown, in exactly this shape:
{
  "item": "short specific name (brand + model if known)",
  "category": "e.g. Vintage Electronics",
  "confidence": "high" | "medium" | "low",
  "description": "1-2 sentences: what it is, era, notable features",
  "condition_notes": "what you can see about condition, or what to check",
  "price_low": number,
  "price_high": number,
  "price_basis": "1 sentence on why, e.g. typical sold prices for this model",
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
        reject(new Error("Photo too large"));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

// ---------- eBay Browse API (active listings + search by image) ----------
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
    currency: it.price?.currency,
    condition: it.condition,
    image: it.thumbnailImages?.[0]?.imageUrl || it.image?.imageUrl,
    url: it.itemWebUrl,
    buyingOptions: it.buyingOptions,
  }));
}

async function ebaySearch(q, imageB64) {
  const token = await getEbayToken();
  const headers = { Authorization: `Bearer ${token}`, "X-EBAY-C-MARKETPLACE-ID": "EBAY_US", "Content-Type": "application/json" };
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
  const prices = out.keyword.map((i) => i.price).filter((p) => p > 0).sort((a, b) => a - b);
  if (prices.length) {
    out.stats = {
      count: prices.length,
      low: prices[0],
      high: prices[prices.length - 1],
      median: prices[Math.floor(prices.length / 2)],
    };
  }
  return out;
}

async function identify(req, res) {
  if (!API_KEY) return send(res, 500, { error: "Server is missing ANTHROPIC_API_KEY. Add it in Render → Environment." });
  let data;
  try {
    data = JSON.parse(await readBody(req));
  } catch (e) {
    return send(res, 400, { error: e.message || "Bad request" });
  }
  const images = Array.isArray(data.images) ? data.images.slice(0, 4) : [];
  if (!images.length) return send(res, 400, { error: "No photo received" });

  const content = images.map((dataUrl) => {
    const m = /^data:(image\/[a-z]+);base64,(.+)$/i.exec(dataUrl || "");
    if (!m) throw new Error("Bad image");
    return { type: "image", source: { type: "base64", media_type: m[1], data: m[2] } };
  });
  let text = PROMPT;
  if (data.price) text += `\n\nPrice asked at the sale: $${String(data.price).slice(0, 20)}`;
  if (data.notes) text += `\n\nNotes from the buyer: ${String(data.notes).slice(0, 500)}`;
  content.push({ type: "text", text });

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({ model: MODEL, max_tokens: 1200, messages: [{ role: "user", content }] }),
    });
    const j = await r.json();
    if (!r.ok) return send(res, 502, { error: j?.error?.message || `AI error ${r.status}` });
    const out = (j.content || []).map((b) => b.text || "").join("");
    const match = out.match(/\{[\s\S]*\}/);
    if (!match) return send(res, 502, { error: "Couldn't read the AI response", raw: out });
    const result = JSON.parse(match[0]);
    if (EBAY_ID && EBAY_SECRET) {
      try {
        result.ebay = await ebaySearch(result.search_query || result.item, content[0].source.data);
      } catch (e) {
        result.ebay = { error: e.message };
      }
    } else {
      result.ebay = { error: "eBay not set up yet (add EBAY_CLIENT_ID and EBAY_CLIENT_SECRET in Render)" };
    }
    send(res, 200, result);
  } catch (e) {
    send(res, 502, { error: e.message || "AI request failed" });
  }
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    if (req.method === "POST" && url.pathname === "/api/identify") {
      try {
        return await identify(req, res);
      } catch (e) {
        return send(res, 400, { error: e.message });
      }
    }
    if (url.pathname === "/healthz") return send(res, 200, { ok: true, keySet: !!API_KEY });
    let p = url.pathname === "/" ? "/index.html" : url.pathname;
    const file = path.normalize(path.join(PUBLIC, p));
    if (!file.startsWith(PUBLIC)) return send(res, 403, "Forbidden", "text/plain");
    fs.readFile(file, (err, buf) => {
      if (err) return send(res, 404, "Not found", "text/plain");
      send(res, 200, buf, TYPES[path.extname(file)] || "application/octet-stream");
    });
  })
  .listen(PORT, () => console.log(`Sales Previews on :${PORT}`));
