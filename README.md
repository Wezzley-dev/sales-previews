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

eBay's public API only returns active listings. Sold prices open via the "eBay sold" link (eBay's sold-data API is restricted).

No dependencies. Open the site on your phone and use "Add to Home Screen" so it works like an app.
