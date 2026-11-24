# Sales Previews

Snap a photo of an item at a yard sale, estate sale or thrift store and get:
- what it is (brand/model/era)
- an estimated resale price range
- a BUY / MAYBE / PASS verdict vs. the asking price
- one-tap links to eBay sold listings, Google Shopping, FB Marketplace, WorthPoint
- things to check and red flags
- a scan history saved on your phone

## Deploy on Render
- Runtime: Node · Build: `npm install` · Start: `node server.js`
- Environment variables:
  - `ANTHROPIC_API_KEY` (required) — identifies the item from the photo
  - `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET` (recommended) — Production keyset from developer.ebay.com; enables live eBay listings + photo search
  - `MODEL` (optional, defaults to `claude-sonnet-5-5`)

### Sharing safely (protects your API bill)
- `ACCESS_CODES`: comma-separated invite codes, e.g. `mom,jake,flipcrew`. If it's empty, anyone with the link can scan (still rate-limited per IP).
- `OWNER_CODE`: your personal code, with no daily limit.
- `DAILY_LIMIT_PER_USER` (default 40) and `DAILY_LIMIT_TOTAL` (default 400): caps reset daily, and on restart.

### Database (accounts)
- `DATABASE_URL`: Render Postgres **Internal Database URL**. It's required for accounts, so without it sign-up is disabled.
- Tables are created automatically on startup.

### Features
- Accounts (username + password), invite codes at sign-up, per-user daily AI limits, owner account with no limits
- Photo ID and pricing, barcode/UPC scan with exact eBay match, "Fix ID" re-pricing when the AI guesses wrong
- Profit calculator (fees, shipping, ROI, max to pay), estate sale "Haul" totals, auto-add to haul
- Item tracking: Watching → Bought → Listed → Sold → real profit; notes; search and filters; CSV export
- AI eBay listing drafts (title, price, specifics, description) with copy buttons
- Public share links for a find (never shows what you paid)
- Profile: avatar, display name, stats, light/dark/auto theme, 5 accent colors, password change, delete account

eBay's public API only returns active listings. Sold prices open via the "eBay sold" link (eBay's sold-data API is restricted).

No dependencies. Open the site on your phone and use "Add to Home Screen" so it works like an app.
