// Tiny database layer. Uses the `pg` driver in production (installed by Render's build).
// For local testing without npm, set PSQL_TEST=1 to run queries through the psql CLI.
const { execFileSync } = require("child_process");

const URL_ = process.env.DATABASE_URL || "";
let pool = null;

function enabled() {
  return !!URL_;
}

function getPool() {
  if (pool) return pool;
  const { Pool } = require("pg");
  // Render's internal URL needs no SSL; the external one (…render.com) does.
  const ssl = /\.render\.com/.test(URL_) ? { rejectUnauthorized: false } : false;
  pool = new Pool({ connectionString: URL_, ssl, max: 5 });
  return pool;
}

// ---- psql shim (tests only) ----
function lit(v) {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "object") v = JSON.stringify(v);
  return "'" + String(v).replace(/'/g, "''") + "'";
}
function parseCsv(text) {
  const rows = [];
  let row = [], cur = "", q = false, i = 0, quoted = false;
  while (i < text.length) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i += 2; continue; }
      if (c === '"') { q = false; i++; continue; }
      cur += c; i++; continue;
    }
    if (c === '"') { q = true; quoted = true; i++; continue; }
    if (c === ",") { row.push(quoted || cur !== "" ? cur : null); cur = ""; quoted = false; i++; continue; }
    if (c === "\n") { row.push(quoted || cur !== "" ? cur : null); rows.push(row); row = []; cur = ""; quoted = false; i++; continue; }
    cur += c; i++;
  }
  if (cur !== "" || row.length) { row.push(quoted || cur !== "" ? cur : null); rows.push(row); }
  return rows;
}
async function psqlQuery(text, params = []) {
  const sql = text.replace(/\$(\d+)/g, (_, n) => lit(params[+n - 1]));
  const out = execFileSync("psql", [URL_, "-X", "-q", "--csv", "-v", "ON_ERROR_STOP=1", "-c", sql], { encoding: "utf8" });
  const rows = parseCsv(out.replace(/\n$/, "") + (out ? "\n" : ""));
  if (!rows.length) return { rows: [] };
  const head = rows[0];
  return {
    rows: rows.slice(1).map((r) => Object.fromEntries(head.map((h, i) => {
      let v = r[i];
      if (v === "t") v = true; else if (v === "f") v = false;
      return [h, v];
    }))),
  };
}

async function query(text, params) {
  if (process.env.PSQL_TEST) return psqlQuery(text, params);
  return getPool().query(text, params);
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  pass_hash TEXT NOT NULL,
  display_name TEXT,
  avatar TEXT DEFAULT '🦊',
  is_owner BOOLEAN DEFAULT FALSE,
  invite TEXT,
  settings JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INT REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  last_seen TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS scans (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id) ON DELETE CASCADE,
  data JSONB NOT NULL,
  item TEXT,
  thumb TEXT,
  photo TEXT,
  status TEXT DEFAULT 'watching',
  paid NUMERIC,
  est_sell NUMERIC,
  ship NUMERIC,
  sold_price NUMERIC,
  notes TEXT,
  in_haul BOOLEAN DEFAULT FALSE,
  share_id TEXT UNIQUE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS scans_user_idx ON scans(user_id, created_at DESC);
CREATE TABLE IF NOT EXISTS ai_calls (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT,
  at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_calls_at_idx ON ai_calls(at);
`;

async function migrate() {
  if (process.env.PSQL_TEST) {
    execFileSync("psql", [URL_, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-c", SCHEMA]);
    return;
  }
  await query(SCHEMA);
}

module.exports = { enabled, query, migrate };
