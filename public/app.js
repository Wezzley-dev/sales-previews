"use strict";
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = (n) => (n == null || n === "" || isNaN(+n) ? "—" : (+n < 0 ? "-$" : "$") + Math.abs(Math.round(+n)).toLocaleString());
const nOr = (v, d = 0) => (v === null || v === undefined || v === "" || isNaN(+v) ? d : +v);
const VC = { BUY: "#3ddc97", MAYBE: "#ffb547", PASS: "#ff5d6c" };
const STATUS = [["watching", "Watching"], ["bought", "Bought"], ["listed", "Listed"], ["sold", "Sold"], ["passed", "Passed"]];
const AVATARS = ["🦊", "🐢", "🦉", "🐝", "🦄", "🐙", "🐸", "🦁", "🐼", "🐧", "🦖", "🐳", "🌵", "🍄", "⭐", "💎", "🔥", "🧿", "🎯", "🛍️", "💰", "📦", "🏷️", "🧸"];
const ACCENTS = { lime: "#c8ff4d", sky: "#5cc8ff", orange: "#ff9f43", violet: "#b69cff", pink: "#ff7ac0" };
const ICON = {
  fix: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
  list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.5"/></svg>',
  share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7"/><path d="M16 6l-4-4-4 4M12 2v14"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>',
  sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  dollar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 2v20M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>',
  bag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 7h12l-1 13H7L6 7z"/><path d="M9 7a3 3 0 0 1 6 0"/></svg>',
  dl: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7 10l5 5 5-5M5 21h14"/></svg>',
  key: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="15" r="4"/><path d="M10.8 12.2 20 3M17 6l3 3M15 8l2 2"/></svg>',
  out: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>',
  bulb: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z"/></svg>',
  user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
};

// ================================================================= state
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};
let token = LS.get("sp_token", "");
let me = null, stats = null, cfg = {};
let scans = [];           // list (no full photos)
let photos = [];          // capture tray
let current = null;       // scan shown in scan view or detail
let filter = "all";
const DEFAULTS = { theme: "system", accent: "lime", fee: 13.25, roi: 1, autoHaul: false, tipsDone: false };
const settings = () => Object.assign({}, DEFAULTS, LS.get("sp_settings", {}));

// ================================================================= helpers
function toast(msg) {
  const t = $("toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("show"), 2200);
}
const guestMode = () => cfg.db === false;
async function api(path, opts = {}) {
  if (guestMode()) return localApi(path, opts);
  return serverApi(path, opts);
}
async function serverApi(path, opts = {}) {
  const r = await fetch(path, {
    method: opts.method || "GET",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let d = {}; try { d = await r.json(); } catch {}
  if (r.status === 401 && !opts.noAuthRedirect) { signOutLocal(); throw new Error(d.error || "Please sign in"); }
  if (!r.ok) throw new Error(d.error || "Something went wrong");
  return d;
}
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast("Copied"); }
  catch { const ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove(); toast("Copied"); }
}

// ================================================================= guest mode (no accounts yet)
// Everything lives on this phone. Full photos are kept for the newest 25 scans to save space.
const G = {
  scans() { return LS.get("sp_g_scans", []); },
  save(list) {
    list.forEach((x, i) => { if (i >= 25) delete x.photo; });
    for (let tries = 0; tries < 30; tries++) {
      try { localStorage.setItem("sp_g_scans", JSON.stringify(list)); return; }
      catch { const i = list.map((x) => !!x.photo).lastIndexOf(true); if (i < 0) break; delete list[i].photo; }
    }
    toast("Phone storage is full. Delete a few old items.");
  },
  profile() { return Object.assign({ display_name: "", avatar: "🦊" }, LS.get("sp_g_profile", {})); },
};
function guestStats(list) {
  const has = (x, ...st) => st.includes(x.status);
  const sum = (arr, f) => arr.reduce((a, x) => a + nOr(f(x)), 0);
  const sold = list.filter((x) => has(x, "sold"));
  return {
    scans: list.length, bought: list.filter((x) => has(x, "bought", "listed", "sold")).length,
    listed: list.filter((x) => has(x, "listed")).length, sold: sold.length,
    spent: sum(list.filter((x) => has(x, "bought", "listed", "sold")), (x) => x.paid),
    sold_cost: sum(sold, (x) => x.paid), revenue: sum(sold, (x) => x.sold_price), sold_ship: sum(sold, (x) => x.ship),
    inventory_value: sum(list.filter((x) => has(x, "bought", "listed")), (x) => x.est_sell),
  };
}
async function localApi(path, opts = {}) {
  const m = opts.method || "GET", b = opts.body || {};
  let mm;
  if (path === "/api/me" && m === "GET") {
    const pr = G.profile();
    let q = {}; try { q = await serverApi("/api/guest"); } catch {}
    return { user: { username: "guest", display_name: pr.display_name || "You", avatar: pr.avatar, guest: true, settings: settings() },
      stats: guestStats(G.scans()), remaining: q.remaining ?? null, perDay: q.perDay };
  }
  if (path === "/api/me" && m === "PATCH") {
    const pr = G.profile();
    if (b.display_name !== undefined) pr.display_name = String(b.display_name).trim().slice(0, 30);
    if (b.avatar !== undefined) pr.avatar = b.avatar;
    LS.set("sp_g_profile", pr);
    return { user: { username: "guest", display_name: pr.display_name || "You", avatar: pr.avatar, guest: true, settings: settings() } };
  }
  if (path === "/api/scans" && m === "GET") return G.scans().map((x) => { const y = { ...x }; delete y.photo; return y; });
  if (path === "/api/identify") {
    const list = G.scans();
    const prev = b.scan_id ? list.find((x) => x.id === b.scan_id) : null;
    const body = { ...b };
    if (prev) { body.images = prev.photo ? [prev.photo] : []; body.prev = { asked: prev.asked, upc: prev.upc }; }
    delete body.photo; delete body.thumb;
    const r = await serverApi("/api/identify", { method: "POST", body });
    const remaining = r.remaining; delete r.remaining;
    let scan;
    if (prev) {
      scan = Object.assign(prev, r, { id: prev.id, paid: prev.paid, notes: prev.notes, status: prev.status, in_haul: prev.in_haul,
        thumb: prev.thumb, photo: prev.photo, when: prev.when, listing: undefined });
    } else {
      const now = Date.now();
      scan = { ...r, id: now, when: now, status: "watching", paid: r.asked ? +r.asked : null, sold_price: null, notes: "",
        in_haul: false, share_id: null, thumb: b.thumb || null, photo: b.photo || null };
      list.unshift(scan);
    }
    G.save(list);
    return { ...scan, remaining };
  }
  if ((mm = path.match(/^\/api\/scans\/(\d+)$/))) {
    const list = G.scans(); const i = list.findIndex((x) => x.id === +mm[1]);
    if (i < 0) throw new Error("Item not found");
    if (m === "GET") return list[i];
    if (m === "DELETE") { list.splice(i, 1); G.save(list); return { ok: true }; }
    if (m === "PATCH") { Object.assign(list[i], b); G.save(list); return list[i]; }
  }
  if ((mm = path.match(/^\/api\/scans\/(\d+)\/listing$/))) {
    const list = G.scans(); const x = list.find((y) => y.id === +mm[1]);
    if (!x) throw new Error("Item not found");
    if (x.listing) return x.listing;
    const scan = { ...x }; delete scan.photo; delete scan.thumb; delete scan.ebay;
    const L = await serverApi("/api/listing", { method: "POST", body: { scan } });
    x.listing = L; G.save(list);
    return L;
  }
  if (path.includes("/share")) throw new Error("Share links switch on once accounts are set up.");
  if (path === "/api/haul/clear") { const list = G.scans(); list.forEach((x) => (x.in_haul = false)); G.save(list); return { ok: true }; }
  throw new Error("Not available yet");
}

// ================================================================= theme / settings
function applyTheme() {
  const s = settings();
  let t = s.theme;
  if (t === "system") t = matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  document.documentElement.dataset.theme = t;
  document.documentElement.dataset.accent = ACCENTS[s.accent] ? s.accent : "lime";
  document.querySelector('meta[name="theme-color"]').content = t === "light" ? "#f5f5f1" : "#0a0a0c";
}
matchMedia("(prefers-color-scheme: light)").addEventListener?.("change", applyTheme);
const pushSettings = debounce(() => { if (token && !guestMode()) api("/api/me", { method: "PATCH", body: { settings: settings() } }).catch(() => {}); }, 600);
function setSetting(k, v) {
  const s = settings(); s[k] = v; LS.set("sp_settings", s);
  applyTheme(); pushSettings();
}

// ================================================================= auth
let authMode = "signup";
function showAuth() {
  ["app", "tabs", "shareView"].forEach((id) => $(id).classList.add("hidden"));
  $("authView").classList.remove("hidden");
  setAuthMode(LS.get("sp_seen", false) ? "login" : "signup");
}
function setAuthMode(m) {
  authMode = m;
  document.querySelectorAll("#authSeg button").forEach((b) => b.classList.toggle("on", b.dataset.m === m));
  $("aNameF").classList.toggle("hidden", m !== "signup");
  $("aCodeF").classList.toggle("hidden", m !== "signup" || !cfg.inviteRequired);
  $("authBtn").textContent = m === "signup" ? "Create account" : "Sign in";
  $("aPass").autocomplete = m === "signup" ? "new-password" : "current-password";
  $("authErr").innerHTML = "";
}
$("authSeg").onclick = (e) => { const b = e.target.closest("button"); if (b) setAuthMode(b.dataset.m); };
$("authForm").onsubmit = async (e) => {
  e.preventDefault();
  $("authBtn").disabled = true; $("authErr").innerHTML = "";
  try {
    const body = { username: $("aUser").value, password: $("aPass").value };
    if (authMode === "signup") Object.assign(body, { display_name: $("aName").value, code: $("aCode").value, settings: settings() });
    const d = await api(authMode === "signup" ? "/api/signup" : "/api/login", { method: "POST", body, noAuthRedirect: true });
    token = d.token; LS.set("sp_token", token); LS.set("sp_seen", true);
    $("aPass").value = "";
    await boot();
    if (authMode === "signup") toast(`Welcome, ${d.user.display_name}!`);
  } catch (err) {
    $("authErr").innerHTML = `<div class="err">${esc(err.message)}</div>`;
  }
  $("authBtn").disabled = false;
};
function signOutLocal() {
  token = ""; LS.del("sp_token"); me = null; scans = []; current = null;
  showAuth();
}
async function signOut() {
  try { await api("/api/logout", { method: "POST", noAuthRedirect: true }); } catch {}
  signOutLocal();
}

// ================================================================= boot
async function loadMe() {
  const d = await api("/api/me");
  me = d.user; stats = d.stats;
  cfg.remaining = d.remaining; cfg.perDay = d.perDay;
  // server settings win (sync across devices), but keep any local keys not yet saved
  LS.set("sp_settings", Object.assign({}, DEFAULTS, LS.get("sp_settings", {}), me.settings || {}));
  applyTheme();
  $("meBtn").textContent = me.avatar || "🦊";
  updQuota();
}
async function loadScans() { scans = await api("/api/scans"); updBadges(); }
function updQuota() {
  $("quota").textContent = cfg.remaining == null ? "Unlimited" : `${cfg.remaining} left today`;
}
function updBadges() { const n = scans.filter((s) => s.in_haul).length; $("haulN").textContent = n ? String(n) : ""; }

async function boot() {
  try { cfg = Object.assign(cfg, await (await fetch("/api/config")).json()); } catch {}
  const share = location.pathname.match(/^\/s\/([a-z0-9]+)/);
  if (share) return showShare(share[1]);
  if (!guestMode() && !token) return showAuth();
  try { await loadMe(); } catch { return; }
  $("authView").classList.add("hidden");
  $("app").classList.remove("hidden"); $("tabs").classList.remove("hidden");
  $("hello").textContent = `Hey ${me.display_name === "You" ? "there" : me.display_name}. Snap anything at a sale to get an ID, a price, your profit and live eBay matches.`;
  renderTips();
  view("scan");
  loadScans().catch(() => {});
}

// ================================================================= views
function view(v) {
  ["scan", "haul", "items", "detail", "profile"].forEach((x) => $(x + "View").classList.toggle("hidden", x !== v));
  const tab = v === "detail" ? "items" : v;
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("on", t.dataset.v === tab));
  if (v === "haul") renderHaul();
  if (v === "items") renderItems();
  if (v === "profile") renderProfile();
  window.scrollTo({ top: 0 });
}
document.querySelectorAll(".tab").forEach((t) => (t.onclick = () => view(t.dataset.v)));
$("meBtn").onclick = () => view("profile");
$("backBtn").onclick = () => view("items");

// ================================================================= tips
function renderTips() {
  if (settings().tipsDone) { $("tips").innerHTML = ""; return; }
  $("tips").innerHTML = `<div class="tips"><button class="x" id="tipsX" aria-label="Dismiss">×</button>
    <h4>📸 Tips for spot-on prices</h4>
    <ol><li>Fill the frame with the item in good light.</li>
    <li>Add a 2nd photo of any <b>label, maker's mark, model number or signature</b>.</li>
    <li>Got a barcode? Scan it for an exact match.</li>
    <li>Type the asking price to get a BUY or PASS call and your profit.</li></ol></div>`;
  $("tipsX").onclick = () => { setSetting("tipsDone", true); renderTips(); };
}

// ================================================================= capture
function resize(src, max, q) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL("image/jpeg", q));
    };
    img.onerror = reject; img.src = src;
  });
}
async function addFiles(files) {
  for (const f of files) {
    if (photos.length >= 4) break;
    const u = URL.createObjectURL(f);
    try { photos.push(await resize(u, 1280, 0.82)); } catch { toast("Couldn't read that photo"); }
    if (!$("upc").value) decodeBarcode(u, true); else URL.revokeObjectURL(u);
  }
  renderTray();
}
function renderTray() {
  const t = $("tray");
  t.classList.toggle("hidden", !photos.length);
  t.innerHTML = photos.map((p, i) => `<div class="shot"><img src="${p}" alt=""><button data-i="${i}" aria-label="Remove">×</button></div>`).join("")
    + (photos.length && photos.length < 4 ? `<button class="add" id="addBtn"><b>+</b>Angle</button>` : "");
  updGo();
  $("capT").textContent = photos.length ? "Tap to start a new item" : "Tap to scan an item";
}
function updGo() { $("goBtn").disabled = !photos.length && $("upc").value.replace(/\D/g, "").length < 8; }
$("tray").onclick = (e) => {
  if (e.target.closest("#addBtn")) return $("lib").click();
  const i = e.target.dataset.i; if (i != null) { photos.splice(+i, 1); renderTray(); }
};
$("camBtn").onclick = () => {
  photos = []; renderTray(); $("result").innerHTML = ""; current = null;
  $("price").value = ""; $("notes").value = ""; $("upc").value = ""; bcMsg("");
  $("cam").click();
};
$("cam").onchange = (e) => { addFiles(e.target.files); e.target.value = ""; };
$("lib").onchange = (e) => { addFiles(e.target.files); e.target.value = ""; };

function bcMsg(t, ok) { $("bcMsg").textContent = t; $("bcMsg").className = "bc-msg" + (ok ? " ok" : ""); }
async function decodeBarcode(objUrl, quiet) {
  let text = null;
  try {
    if ("BarcodeDetector" in window) {
      const img = await createImageBitmap(await (await fetch(objUrl)).blob());
      const det = new BarcodeDetector({ formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39"] });
      const found = await det.detect(img);
      if (found.length) text = found[0].rawValue;
    }
    if (!text && window.ZXing && !quiet) {
      const res = await new ZXing.BrowserMultiFormatReader().decodeFromImageUrl(objUrl);
      text = res && res.getText();
    }
  } catch {}
  URL.revokeObjectURL(objUrl);
  if (text) { $("upc").value = text.replace(/\D/g, "") || text; bcMsg("✓ Barcode found", true); updGo(); }
  else if (!quiet) bcMsg("Couldn't read it. Get closer, fill the frame, avoid glare, or type the numbers.");
}
$("bcBtn").onclick = () => $("bcam").click();
$("bcam").onchange = (e) => {
  const f = e.target.files[0]; e.target.value = "";
  if (!f) return;
  bcMsg("Reading barcode…");
  decodeBarcode(URL.createObjectURL(f), false);
};
$("upc").oninput = updGo;

// ================================================================= identify
function scanningHtml(img, label) {
  const bg = img ? `<img src="${img}" alt="">` : `<div style="height:200px"></div>`;
  return `<div class="scanning">${bg}<div class="beam"></div><div class="lbl"><i></i>${label}</div></div>`;
}
$("goBtn").onclick = async () => {
  $("goBtn").disabled = true;
  $("result").innerHTML = scanningHtml(photos[0], "Identifying &amp; checking eBay…");
  $("result").scrollIntoView({ behavior: "smooth", block: "start" });
  try {
    const body = { images: photos, upc: $("upc").value, price: $("price").value, notes: $("notes").value };
    if (photos[0]) { body.photo = await resize(photos[0], 640, 0.72); body.thumb = await resize(photos[0], 160, 0.6); }
    const d = await api("/api/identify", { method: "POST", body });
    afterIdentify(d);
    if (settings().autoHaul && !d.in_haul) await patchScan(d, { in_haul: true }, true);
    renderScan(d, $("result"));
  } catch (e) {
    $("result").innerHTML = `<div class="err">⚠️ ${esc(e.message)}</div>`;
  }
  updGo();
};
function afterIdentify(d) {
  if (d.remaining !== undefined) { cfg.remaining = d.remaining; updQuota(); }
  const i = scans.findIndex((s) => s.id === d.id);
  const slim = { ...d }; delete slim.photo;
  if (i >= 0) scans[i] = Object.assign(scans[i], slim); else scans.unshift(slim);
  updBadges();
}

// ================================================================= scan updates
async function patchScan(d, fields, quiet) {
  Object.assign(d, fields);
  const i = scans.findIndex((s) => s.id === d.id);
  if (i >= 0) Object.assign(scans[i], fields);
  updBadges();
  try { await api(`/api/scans/${d.id}`, { method: "PATCH", body: fields }); }
  catch (e) { if (!quiet) toast(e.message); }
}
const patchLater = debounce((d, f) => patchScan(d, f, true), 700);

function profitFor(sell, ship, cost) {
  const s = settings();
  const fees = sell > 0 ? sell * s.fee / 100 + 0.4 : 0;
  const net = sell - fees - ship;
  const profit = net - cost;
  return { fees, net, profit, roi: cost > 0 ? profit / cost : null, maxPay: Math.max(0, net / (1 + s.roi)) };
}
const scanProfit = (x) => profitFor(nOr(x.status === "sold" && x.sold_price != null ? x.sold_price : x.est_sell), nOr(x.ship), nOr(x.paid)).profit;

// ================================================================= render a scan
const listCard = (i) => `
  <a class="lst" target="_blank" rel="noopener" href="${esc(i.url)}">
    <img src="${esc(i.image || "")}" loading="lazy" alt="" onerror="this.style.visibility='hidden'">
    <div><b>${i.price ? money(i.price) : "—"}</b><span>${esc(i.title)}</span>
    <em>${esc(i.condition || "")}${(i.buyingOptions || []).includes("AUCTION") ? " · Auction" : ""}</em></div>
  </a>`;
const checks = (arr, red) => arr && arr.length ? `<ul class="checks ${red ? "red" : ""}">${arr.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : `<div class="none">Nothing flagged</div>`;

function ebaySections(d) {
  const e = d.ebay || {};
  let h = "";
  if (e.error) return `<div class="sec"><h3>eBay</h3><div class="card note">${esc(e.error)}</div></div>`;
  if (e.image && e.image.length) h += `<div class="sec"><h3>Looks like this <small>visual matches</small></h3><div class="rail">${e.image.slice(0, 10).map(listCard).join("")}</div></div>`;
  if (e.keyword && e.keyword.length) h += `<div class="sec"><h3>Listed now <small>${e.byBarcode ? "exact barcode · " : ""}${(e.total || 0).toLocaleString()} on eBay</small></h3><div class="rail">${e.keyword.slice(0, 10).map(listCard).join("")}</div></div>`;
  return h || `<div class="sec"><h3>eBay</h3><div class="card note">No matching active listings found.</div></div>`;
}
function infoSections(d) {
  const q = encodeURIComponent(d.search_query || d.item || "");
  return `
    <div class="sec"><h3>Check sold prices</h3><div class="chips">
      <a class="chip pri" target="_blank" rel="noopener" href="https://www.ebay.com/sch/i.html?_nkw=${q}&LH_Sold=1&LH_Complete=1">eBay sold ↗</a>
      <a class="chip" target="_blank" rel="noopener" href="https://www.worthpoint.com/search?query=${q}">WorthPoint ↗</a>
      <a class="chip" target="_blank" rel="noopener" href="https://www.google.com/search?tbm=shop&q=${q}">Google ↗</a>
      <a class="chip" target="_blank" rel="noopener" href="https://www.facebook.com/marketplace/search/?query=${q}">Marketplace ↗</a>
    </div></div>
    <div class="sec"><h3>About it</h3><div class="card"><p>${esc(d.description)}</p></div></div>
    ${(d.best_platforms || []).length ? `<div class="sec"><h3>Best places to sell</h3><div class="chips">${d.best_platforms.map((p) => `<span class="chip plain">${esc(p)}</span>`).join("")}</div></div>` : ""}
    <div class="sec"><h3>Check before buying</h3><div class="card">${checks(d.check_before_buying)}</div></div>
    <div class="sec"><h3>Red flags</h3><div class="card">${checks(d.red_flags, true)}</div></div>
    <div class="sec"><h3>Condition</h3><div class="card"><p class="note">${esc(d.condition_notes)}</p></div></div>`;
}
function heroHtml(d) {
  const v = ["BUY", "MAYBE", "PASS"].includes(d.verdict) ? d.verdict : "MAYBE";
  const img = d.photo || d.thumb;
  return `<div class="hero">
      ${img ? `<img src="${img}" alt="">` : `<div class="ph"></div>`}
      <div class="fade"></div>
      ${d.corrected ? `<div class="corr">✎ Corrected</div>` : ""}
      <div class="verdict v-${v}">${v}</div>
      <div class="over"><div class="tag">${esc(d.category)} · ${esc(d.confidence)} confidence${d.upc ? " · UPC " + esc(d.upc) : ""}</div><h2>${esc(d.item)}</h2></div>
    </div>`;
}
function valueHtml(d) {
  const sp = { fast: "⚡ Sells fast", average: "⏱ Average sell time", slow: "🐢 Slow seller" }[d.sell_speed];
  return `<div class="card val">
      <div class="lbl-sm">Est. resale value</div>
      <div class="big">${money(d.price_low)}–${money(d.price_high)}</div>
      <div class="why">${esc(d.price_basis)}</div>
      ${sp ? `<div class="speed">${sp}</div>` : ""}
      <div class="reason">${esc(d.verdict_reason)}</div>
    </div>`;
}

function renderScan(d, box) {
  current = d;
  const st = (d.ebay || {}).stats;
  const sold = d.status === "sold";
  box.innerHTML = `<div class="res">
    ${heroHtml(d)}
    ${valueHtml(d)}

    <div class="status-seg"><div class="seg" id="stSeg">${STATUS.map(([k, l]) => `<button data-s="${k}" class="${d.status === k ? "on" : ""}">${l}</button>`).join("")}</div></div>

    <div class="actions">
      <button class="act" data-a="fix">${ICON.fix}Fix ID</button>
      <button class="act" data-a="listing">${ICON.list}Listing</button>
      <button class="act ${d.share_id ? "on" : ""}" data-a="share" ${guestMode() ? 'style="opacity:.45"' : ""}>${ICON.share}Share</button>
      <button class="act" data-a="delete">${ICON.trash}Delete</button>
    </div>
    <div id="panel"></div>

    <div class="sec"><h3>${sold ? "Your profit (sold)" : "Your profit"} <small>edit any number</small></h3>
      <div class="card">
        <div class="calc">
          <div class="field"><label>You paid</label><div class="money"><span>$</span><input type="number" id="pCost" inputmode="decimal" value="${d.paid ?? ""}" placeholder="0"></div></div>
          <div class="field"><label>${sold ? "Sold for" : "Sell for"}</label><div class="money"><span>$</span><input type="number" id="pSell" inputmode="decimal" value="${sold ? (d.sold_price ?? d.est_sell ?? "") : (d.est_sell ?? "")}"></div></div>
          <div class="field"><label>Shipping</label><div class="money"><span>$</span><input type="number" id="pShip" inputmode="decimal" value="${d.ship ?? ""}"></div></div>
        </div>
        <div class="profit">
          <div><div class="lbl-sm">Profit</div><div class="net" id="pNet">$0</div><div class="roi" id="pRoi"></div></div>
          <div class="maxpay"><div class="lbl-sm" id="pMaxK">Max to pay</div><div class="v" id="pMax">$0</div></div>
        </div>
        <div class="breakdown" id="pBreak"></div>
        <button class="haul-btn" id="haulBtn"></button>
      </div>
    </div>

    <div class="sec"><h3>Notes</h3>
      <div class="field"><textarea id="pNotes" rows="2" placeholder="Where you found it, condition, what to fix…">${esc(d.notes || "")}</textarea></div>
    </div>

    <div class="sec"><div class="stats">
      <div class="stat"><div class="k">Asking</div><div class="v">${d.asked ? money(d.asked) : "—"}</div></div>
      <div class="stat"><div class="k">eBay median</div><div class="v">${st ? money(st.median) : "—"}</div></div>
      <div class="stat"><div class="k">Listed</div><div class="v">${st ? ((d.ebay.total || st.count).toLocaleString()) : "—"}</div></div>
    </div></div>

    ${ebaySections(d)}
    ${infoSections(d)}
  </div>`;

  const q = (sel) => box.querySelector(sel);
  q("#stSeg").onclick = (e) => {
    const b = e.target.closest("button"); if (!b) return;
    const s = b.dataset.s;
    const f = { status: s };
    if (s === "sold" && d.sold_price == null) f.sold_price = nOr(q("#pSell").value, nOr(d.est_sell));
    if (s === "bought" && d.paid == null && d.asked) f.paid = +d.asked;
    patchScan(d, f).then(() => { renderScan(d, box); toast(s === "sold" ? "Nice! Marked as sold 🎉" : `Marked as ${s}`); });
  };
  const recalc = () => {
    const sell = nOr(q("#pSell").value), ship = nOr(q("#pShip").value), cost = nOr(q("#pCost").value);
    const p = profitFor(sell, ship, cost), s = settings();
    q("#pNet").textContent = money(p.profit);
    q("#pNet").className = "net " + (p.profit >= 0 ? "pos" : "neg");
    q("#pRoi").textContent = p.roi == null ? "enter what you paid" : (p.roi >= 0 ? "+" : "") + Math.round(p.roi * 100) + "% return";
    q("#pMax").textContent = money(p.maxPay);
    q("#pMaxK").textContent = `Max to pay (${{ 0.5: "+50%", 1: "2×", 2: "3×" }[s.roi] || "2×"})`;
    q("#pBreak").textContent = `${money(sell)} − fees ${money(p.fees)} (${s.fee}% + $0.40) − ship ${money(ship)} − cost ${money(cost)}`;
  };
  ["#pCost", "#pSell", "#pShip"].forEach((sel) => (q(sel).oninput = () => {
    recalc();
    const f = { paid: q("#pCost").value === "" ? null : nOr(q("#pCost").value), ship: nOr(q("#pShip").value) };
    if (d.status === "sold") f.sold_price = nOr(q("#pSell").value); else f.est_sell = nOr(q("#pSell").value);
    Object.assign(d, f); patchLater(d, f);
  }));
  q("#pNotes").oninput = () => { d.notes = q("#pNotes").value; patchLater(d, { notes: d.notes }); };
  const paintHaul = () => {
    q("#haulBtn").classList.toggle("done", !!d.in_haul);
    q("#haulBtn").textContent = d.in_haul ? "✓ In today's haul (tap to remove)" : "+ Add to today's haul";
  };
  q("#haulBtn").onclick = () => { patchScan(d, { in_haul: !d.in_haul }).then(paintHaul); paintHaul(); };
  q(".actions").onclick = (e) => { const b = e.target.closest(".act"); if (b) action(b.dataset.a, d, box); };
  recalc(); paintHaul();
}

// ================================================================= actions
async function action(a, d, box) {
  const panel = box.querySelector("#panel");
  if (a === "fix") {
    panel.innerHTML = `<div class="card panel">
      <div class="lbl-sm" style="margin-bottom:6px">What is it actually?</div>
      <div class="field" style="background:var(--s2)"><input id="fixIn" placeholder="e.g. Fire-King Jadeite mixing bowl" value=""></div>
      <button class="cta sm" id="fixGo">Re-price it</button>
      <div class="dim" style="font-size:12.5px;margin-top:8px">Uses 1 scan. Keeps your photo, notes and numbers.</div></div>`;
    panel.querySelector("#fixIn").focus();
    panel.querySelector("#fixGo").onclick = async () => {
      const correction = panel.querySelector("#fixIn").value.trim();
      if (!correction) return;
      panel.innerHTML = scanningHtml(d.photo || d.thumb, "Re-identifying…");
      try {
        const nd = await api("/api/identify", { method: "POST", body: { scan_id: d.id, correction } });
        afterIdentify(nd);
        renderScan(nd, box);
        toast("Updated");
      } catch (e) { panel.innerHTML = `<div class="err">${esc(e.message)}</div>`; }
    };
  }
  if (a === "listing") {
    panel.innerHTML = scanningHtml(null, "Writing your eBay listing…");
    try {
      const L = await api(`/api/scans/${d.id}/listing`, { method: "POST" });
      d.listing = L;
      const specs = Object.entries(L.specifics || {}).filter(([, v]) => v);
      panel.innerHTML = `<div class="card panel">
        <div class="lbl-sm">eBay listing draft · tap to copy</div>
        <div class="copyrow"><div class="t"><b>${esc(L.title)}</b><div class="dim" style="font-size:12px">${(L.title || "").length}/80 characters</div></div><button data-c="title">Copy</button></div>
        <div class="copyrow"><div class="t">Price <b>${money(L.price)}</b> · ${esc(L.condition || "")}</div><button data-c="price">Copy</button></div>
        <div class="copyrow"><div class="t">${esc(L.description)}</div><button data-c="description">Copy</button></div>
        ${specs.length ? `<div class="copyrow"><div class="t"><div class="lbl-sm">Item specifics</div><div class="kv">${specs.map(([k, v]) => `<span><b>${esc(k)}:</b> ${esc(v)}</span>`).join("")}</div></div><button data-c="specs">Copy</button></div>` : ""}
        <a class="cta sm" style="text-decoration:none" target="_blank" rel="noopener" href="https://www.ebay.com/sl/prelist/suggest?title=${encodeURIComponent(L.title || "")}">Start listing on eBay ↗</a>
      </div>`;
      panel.onclick = (e) => {
        const c = e.target.dataset.c; if (!c) return;
        copy(c === "specs" ? specs.map(([k, v]) => `${k}: ${v}`).join("\n") : c === "price" ? String(L.price) : L[c]);
      };
      if (cfg.remaining != null) loadMe().catch(() => {});
    } catch (e) { panel.innerHTML = `<div class="err">${esc(e.message)}</div>`; }
  }
  if (a === "share") {
    try {
      const { share_id } = await api(`/api/scans/${d.id}/share`, { method: "POST" });
      d.share_id = share_id;
      const url = `${location.origin}/s/${share_id}`;
      box.querySelector('[data-a="share"]').classList.add("on");
      if (navigator.share) { try { await navigator.share({ title: d.item, text: `Should I grab this? ${d.item} — est. ${money(d.price_low)}–${money(d.price_high)}`, url }); } catch {} }
      panel.innerHTML = `<div class="card panel">
        <div class="lbl-sm">Share link · anyone with it can view (no prices you paid)</div>
        <div class="copyrow"><div class="t" style="word-break:break-all">${esc(url)}</div><button data-c="1">Copy</button></div>
        <button class="ghost" id="unshare">Turn off link</button></div>`;
      panel.querySelector("[data-c]").onclick = () => copy(url);
      panel.querySelector("#unshare").onclick = async () => {
        await api(`/api/scans/${d.id}/share`, { method: "DELETE" });
        d.share_id = null; panel.innerHTML = ""; box.querySelector('[data-a="share"]').classList.remove("on"); toast("Link turned off");
      };
    } catch (e) { toast(e.message); }
  }
  if (a === "delete") {
    if (!confirm("Delete this scan for good?")) return;
    try {
      await api(`/api/scans/${d.id}`, { method: "DELETE" });
      scans = scans.filter((s) => s.id !== d.id); updBadges();
      toast("Deleted");
      if (box.id === "detailBody") view("items"); else box.innerHTML = "";
    } catch (e) { toast(e.message); }
  }
}

// ================================================================= haul
function renderHaul() {
  const haul = scans.filter((s) => s.in_haul);
  if (!haul.length) {
    $("haulBody").innerHTML = `<div class="empty"><b>🛍️</b>Nothing in your haul yet.<br>Scan an item and tap “Add to today's haul”.<br><br>
      <span class="dim" style="font-size:13.5px">Tip: turn on “Auto-add scans to haul” in Profile when you're working a big estate sale.</span></div>`;
    return;
  }
  const cost = haul.reduce((a, x) => a + nOr(x.paid), 0);
  const sell = haul.reduce((a, x) => a + nOr(x.est_sell), 0);
  const profit = haul.reduce((a, x) => a + scanProfit(x), 0);
  $("haulBody").innerHTML = `
    <div class="haul-top">
      <div class="lbl-sm">Est. profit after fees &amp; shipping</div>
      <div class="big ${profit >= 0 ? "pos" : "neg"}">${money(profit)}</div>
      <div class="haul-grid">
        <div><div class="lbl-sm">Items</div><b>${haul.length}</b></div>
        <div><div class="lbl-sm">Spent</div><b>${money(cost)}</b></div>
        <div><div class="lbl-sm">Resale</div><b>${money(sell)}</b></div>
      </div>
    </div>
    ${haul.map((x) => `
      <div class="row" data-id="${x.id}">
        ${x.thumb ? `<img src="${x.thumb}" alt="">` : `<div class="noimg">📦</div>`}
        <div class="t"><div class="n">${esc(x.item)}</div><div class="m">Paid ${money(x.paid)} · sells ~${money(x.est_sell)}</div></div>
        <div class="p ${scanProfit(x) >= 0 ? "pos" : "neg"}">${money(scanProfit(x))}</div>
        <button class="x" data-rm="${x.id}" aria-label="Remove">×</button>
      </div>`).join("")}
    <button class="cta sm" id="haulBought">Mark all as Bought</button>
    <button class="ghost" id="newHaul">Start a new haul</button>`;
}
$("haulBody").onclick = async (e) => {
  if (e.target.id === "newHaul") {
    if (!confirm("Clear this haul and start a new one? Your items stay saved.")) return;
    await api("/api/haul/clear", { method: "POST" }).catch((er) => toast(er.message));
    scans.forEach((s) => (s.in_haul = false)); updBadges(); renderHaul(); return;
  }
  if (e.target.id === "haulBought") {
    const list = scans.filter((s) => s.in_haul && s.status === "watching");
    await Promise.all(list.map((s) => patchScan(s, { status: "bought" }, true)));
    toast(`${list.length} item${list.length === 1 ? "" : "s"} marked as bought`); return;
  }
  const rm = e.target.dataset.rm;
  if (rm) { const s = scans.find((x) => x.id === +rm); if (s) { await patchScan(s, { in_haul: false }); renderHaul(); } return; }
  const row = e.target.closest(".row"); if (row) openDetail(+row.dataset.id);
};

// ================================================================= items
function renderItems() {
  const counts = Object.fromEntries(STATUS.map(([k]) => [k, scans.filter((s) => s.status === k).length]));
  $("filters").innerHTML = [["all", "All", scans.length], ...STATUS.map(([k, l]) => [k, l, counts[k]])]
    .filter(([k, , n]) => k === "all" || n)
    .map(([k, l, n]) => `<button data-f="${k}" class="${filter === k ? "on" : ""}">${l}<i>${n}</i></button>`).join("");
  const term = $("q").value.trim().toLowerCase();
  const list = scans.filter((s) => (filter === "all" || s.status === filter) &&
    (!term || `${s.item} ${s.category} ${s.notes} ${s.upc || ""}`.toLowerCase().includes(term)));
  if (!scans.length) { $("itemsList").innerHTML = `<div class="empty"><b>📸</b>No scans yet. Your finds will show up here.</div>`; return; }
  if (!list.length) { $("itemsList").innerHTML = `<div class="empty"><b>🔍</b>Nothing matches.</div>`; return; }
  $("itemsList").innerHTML = list.map((s) => {
    const sold = s.status === "sold";
    const right = sold ? `<div class="p pos">${money(scanProfit(s))}<small>profit</small></div>` : `<div class="p">${money(s.price_low)}–${money(s.price_high)}<small>${s.paid != null ? "paid " + money(s.paid) : "&nbsp;"}</small></div>`;
    return `<button class="row" data-id="${s.id}">
      ${s.thumb ? `<img src="${s.thumb}" alt="">` : `<div class="noimg">📦</div>`}
      <div class="t"><div class="n">${esc(s.item)}</div>
        <div class="m"><span class="st st-${s.status}">${esc(s.status)}</span><span class="dot" style="background:${VC[s.verdict] || VC.MAYBE}"></span>${new Date(s.when).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</div></div>
      ${right}
    </button>`;
  }).join("") + (scans.length >= 2 ? `<button class="ghost" id="exportBtn">${"Export all to spreadsheet (CSV)"}</button>` : "");
}
$("filters").onclick = (e) => { const b = e.target.closest("button"); if (b) { filter = b.dataset.f; renderItems(); } };
$("q").oninput = debounce(renderItems, 150);
$("itemsList").onclick = (e) => {
  if (e.target.id === "exportBtn") return exportCsv();
  const row = e.target.closest(".row"); if (row) openDetail(+row.dataset.id);
};
async function openDetail(id) {
  view("detail");
  const s = scans.find((x) => x.id === id);
  $("detailBody").innerHTML = scanningHtml(s && s.thumb, "Loading…");
  try {
    const d = await api(`/api/scans/${id}`);
    renderScan(d, $("detailBody"));
  } catch (e) { $("detailBody").innerHTML = `<div class="err">${esc(e.message)}</div>`; }
}

function exportCsv() {
  const cols = ["date", "item", "category", "status", "verdict", "paid", "est_low", "est_high", "est_sell", "ship", "sold_price", "profit", "upc", "notes"];
  const rows = scans.map((s) => [new Date(s.when).toISOString().slice(0, 10), s.item, s.category, s.status, s.verdict, s.paid, s.price_low, s.price_high, s.est_sell, s.ship, s.sold_price, Math.round(scanProfit(s) * 100) / 100, s.upc || "", s.notes || ""]);
  const csv = [cols, ...rows].map((r) => r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = `sales-previews-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click(); toast("Exported");
}

// ================================================================= profile
async function renderProfile() {
  paintProfile();
  try { await loadMe(); paintProfile(); } catch {}
}
function paintProfile() {
  if (!me) return;
  const s = settings(), st = stats || {};
  const realized = (st.revenue || 0) - (st.sold_cost || 0) - (st.sold_ship || 0) - ((st.revenue || 0) * s.fee / 100 + 0.4 * (st.sold || 0));
  const since = me.created_at ? new Date(me.created_at).toLocaleDateString(undefined, { month: "short", year: "numeric" }) : "";
  $("profileBody").innerHTML = `
    <div class="prof">
      <button class="ava" id="avaBtn" aria-label="Change avatar">${esc(me.avatar)}</button>
      <div><div class="nm">${esc(me.display_name)}${me.is_owner ? '<span class="badge">Owner</span>' : ""}</div>
      <div class="un">${me.guest ? "Saved on this phone" : "@" + esc(me.username) + (since ? " · since " + since : "")}</div></div>
    </div>
    <div id="avaPick"></div>

    <div class="stats">
      <div class="stat"><div class="k">Scans</div><div class="v">${st.scans ?? 0}</div></div>
      <div class="stat"><div class="k">Bought</div><div class="v">${st.bought ?? 0}</div></div>
      <div class="stat"><div class="k">Sold</div><div class="v">${st.sold ?? 0}</div></div>
    </div>
    <div class="stats two" style="margin-top:10px">
      <div class="stat"><div class="k">Real profit (sold)</div><div class="v ${realized >= 0 ? "pos" : "neg"}">${money(realized)}</div></div>
      <div class="stat"><div class="k">Inventory value</div><div class="v">${money(st.inventory_value || 0)}</div></div>
    </div>

    <div class="sec"><h3>Appearance</h3><div class="group">
      <div class="item"><div class="ic">${ICON.sun}</div><div class="lb">Theme</div></div>
      <div class="item-body"><div class="seg" id="themeSeg">${[["system", "Auto"], ["light", "Light"], ["dark", "Dark"]].map(([k, l]) => `<button data-t="${k}" class="${s.theme === k ? "on" : ""}">${l}</button>`).join("")}</div></div>
      <div class="item"><div class="ic">🎨</div><div class="lb">Accent color</div></div>
      <div class="item-body"><div class="swatches" id="swatches">${Object.entries(ACCENTS).map(([k, c]) => `<button class="sw ${s.accent === k ? "on" : ""}" data-a="${k}" style="background:${c}" aria-label="${k}"></button>`).join("")}</div></div>
    </div></div>

    <div class="sec"><h3>Profit</h3><div class="group">
      <div class="item"><div class="ic">${ICON.dollar}</div><div class="lb">Selling fees</div>
        <div class="field" style="width:96px;padding:6px 10px;border-radius:12px;background:var(--s2)"><div class="money"><input type="number" id="feeIn" inputmode="decimal" step="0.1" value="${s.fee}" style="text-align:right"><span>%</span></div></div></div>
      <div class="item"><div class="ic">🎯</div><div class="lb">"Max to pay" target</div></div>
      <div class="item-body"><div class="seg" id="roiSeg">${[[0.5, "+50%"], [1, "2× money"], [2, "3× money"]].map(([r, l]) => `<button data-r="${r}" class="${s.roi === r ? "on" : ""}">${l}</button>`).join("")}</div></div>
      <div class="item"><div class="ic">${ICON.bag}</div><div class="lb">Auto-add scans to haul<div class="dim" style="font-size:12.5px">Great for big estate sales</div></div><button class="toggle ${s.autoHaul ? "on" : ""}" id="autoHaul" aria-label="Auto-add to haul"></button></div>
    </div></div>

    <div class="sec"><h3>Account</h3><div class="group">
      <button class="item" id="pName"><div class="ic">${ICON.user}</div><div class="lb">Display name</div><div class="vl">${esc(me.display_name)}</div><div class="chev">›</div></button>
      <div id="nameBody"></div>
      ${me.guest ? "" : `<button class="item" id="pPass"><div class="ic">${ICON.key}</div><div class="lb">Change password</div><div class="chev">›</div></button>`}
      <div id="passBody"></div>
      <button class="item" id="pExport"><div class="ic">${ICON.dl}</div><div class="lb">Export items (CSV)</div><div class="chev">›</div></button>
      <button class="item" id="pTips"><div class="ic">${ICON.bulb}</div><div class="lb">Show photo tips again</div><div class="chev">›</div></button>
      <div class="item"><div class="ic">⚡</div><div class="lb">AI scans today</div><div class="vl">${cfg.remaining == null ? "Unlimited" : `${cfg.remaining} of ${cfg.perDay} left`}</div></div>
    </div></div>

    ${me.guest ? `<div class="card" style="margin-top:22px;font-size:14px"><b>Accounts are coming soon.</b><br><span class="muted">For now your items are saved on this phone only. Once accounts switch on, you'll get a username and sync across devices.</span></div>` : `
    <button class="ghost" id="pOut" style="margin-top:22px">Sign out</button>
    <button class="ghost danger" id="pDel">Delete my account</button>
    <div id="delBody"></div>`}
    <div class="dim" style="text-align:center;font-size:12px;margin-top:18px">Sales Previews · prices are estimates, always double-check sold comps.</div>`;

  $("avaBtn").onclick = () => {
    const box = $("avaPick");
    if (box.innerHTML) { box.innerHTML = ""; return; }
    box.innerHTML = `<div class="card" style="margin-bottom:16px"><div class="lbl-sm">Pick your avatar</div><div class="emoji-grid">${AVATARS.map((a) => `<button class="${a === me.avatar ? "on" : ""}">${a}</button>`).join("")}</div></div>`;
    box.querySelector(".emoji-grid").onclick = async (e) => {
      const b = e.target.closest("button"); if (!b) return;
      me.avatar = b.textContent; $("meBtn").textContent = me.avatar;
      await api("/api/me", { method: "PATCH", body: { avatar: me.avatar } }).catch((er) => toast(er.message));
      paintProfile();
    };
  };
  $("themeSeg").onclick = (e) => { const b = e.target.closest("button"); if (b) { setSetting("theme", b.dataset.t); paintProfile(); } };
  $("swatches").onclick = (e) => { const b = e.target.closest("button"); if (b) { setSetting("accent", b.dataset.a); paintProfile(); } };
  $("feeIn").oninput = () => { const f = parseFloat($("feeIn").value); if (!isNaN(f) && f >= 0 && f < 60) setSetting("fee", f); };
  $("roiSeg").onclick = (e) => { const b = e.target.closest("button"); if (b) { setSetting("roi", +b.dataset.r); paintProfile(); } };
  $("autoHaul").onclick = () => { setSetting("autoHaul", !settings().autoHaul); paintProfile(); };
  $("pName").onclick = () => {
    const b = $("nameBody");
    if (b.innerHTML) { b.innerHTML = ""; return; }
    b.innerHTML = `<div class="item-body"><div class="field" style="background:var(--s2)"><input id="nameIn" maxlength="30" value="${esc(me.display_name)}"></div><button class="cta sm" id="nameSave">Save</button></div>`;
    $("nameSave").onclick = async () => {
      try { const d = await api("/api/me", { method: "PATCH", body: { display_name: $("nameIn").value } }); me = d.user; toast("Saved"); paintProfile(); }
      catch (er) { toast(er.message); }
    };
  };
  if ($("pPass")) $("pPass").onclick = () => {
    const b = $("passBody");
    if (b.innerHTML) { b.innerHTML = ""; return; }
    b.innerHTML = `<div class="item-body">
      <div class="field" style="background:var(--s2)"><label>Current password</label><input id="pwOld" type="password" autocomplete="current-password"></div>
      <div class="field" style="background:var(--s2);margin-top:8px"><label>New password</label><input id="pwNew" type="password" autocomplete="new-password" placeholder="6+ characters"></div>
      <button class="cta sm" id="pwSave">Update password</button></div>`;
    $("pwSave").onclick = async () => {
      try { await api("/api/me/password", { method: "POST", body: { old: $("pwOld").value, new: $("pwNew").value } }); toast("Password updated. Other devices were signed out."); b.innerHTML = ""; }
      catch (er) { toast(er.message); }
    };
  };
  $("pExport").onclick = exportCsv;
  $("pTips").onclick = () => { setSetting("tipsDone", false); renderTips(); view("scan"); };
  if (!$("pOut")) return;
  $("pOut").onclick = signOut;
  $("pDel").onclick = () => {
    const b = $("delBody");
    if (b.innerHTML) { b.innerHTML = ""; return; }
    b.innerHTML = `<div class="card" style="margin-top:10px"><p style="font-size:14px;margin-bottom:10px">This permanently deletes your account and every scan. Enter your password to confirm.</p>
      <div class="field" style="background:var(--s2)"><input id="delPw" type="password" placeholder="Password"></div>
      <button class="ghost danger" id="delGo">Delete forever</button></div>`;
    $("delGo").onclick = async () => {
      try { await api("/api/me", { method: "DELETE", body: { password: $("delPw").value } }); LS.del("sp_seen"); signOutLocal(); toast("Account deleted"); }
      catch (er) { toast(er.message); }
    };
  };
}

// ================================================================= public share page
async function showShare(id) {
  ["authView", "app", "tabs"].forEach((x) => $(x).classList.add("hidden"));
  $("shareView").classList.remove("hidden");
  $("shareBody").innerHTML = scanningHtml(null, "Loading…");
  try {
    const d = await (async () => { const r = await fetch(`/api/share/${id}`); const j = await r.json(); if (!r.ok) throw new Error(j.error); return j; })();
    document.title = `${d.item} · Sales Previews`;
    $("shareBody").innerHTML = `
      <div class="shared-by"><div class="ava">${esc(d.by.avatar)}</div><div><b>${esc(d.by.name)}</b> shared a find</div></div>
      ${heroHtml(d)}${valueHtml(d)}${ebaySections(d)}${infoSections(d)}`;
  } catch (e) {
    $("shareBody").innerHTML = `<div class="empty"><b>🔗</b>${esc(e.message || "Link not found")}</div>`;
  }
}

boot();
