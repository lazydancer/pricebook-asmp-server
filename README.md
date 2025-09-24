# Pricebook ASMP Server

Append-only API for recording overworld shop + waystone scans and summarizing watched chunks.

## Quick Start
1. Install Node.js 18+ and npm.
2. Install dependencies: `npm install`.
3. Optional: configure `.env` with `PORT` and `DB_FILE` (defaults: 49876, `asmp.db`).
4. Reset + seed: `npm run db:reset && npm run db:seed`.
5. Launch the API: `npm run dev`.

## Example Requests
Create a scan with observed shops and waystones (server timestamps this scan on receipt; waystones just record location):
```bash
curl -X POST http://localhost:49876/api/scans \
  -H 'Content-Type: application/json' \
  -d '{
    "senderId": "agent-42",
    "dimension": "overworld",
    "chunkX": 7,
    "chunkZ": 35,
    "shops": [
      {
        "owner": "Alice",
        "item": "Diamond",
        "position": [120, 64, 560],
        "price": 32,
        "amount": 3,
        "action": "out of stock"
      }
    ],
    "waystones": [
      { "position": [128, 70, 560] }
    ]
  }'
```

`action` values are optional; when present they must be exactly `buy`, `sell`, or `out of stock`.

Nearest-waystone metadata (`nearest_waystone_*` fields) is automatically populated for each latest shop using the active waystone list.

Record an empty scan for the same chunk (server timestamps automatically):
```bash
curl -X POST http://localhost:49876/api/scans \
  -H 'Content-Type: application/json' \
  -d '{
    "senderId": "agent-42",
    "dimension": "overworld",
    "chunkX": 7,
    "chunkZ": 35,
    "shops": [],
    "waystones": []
  }'
```

Submit a UI-enriched waystone observation (server timestamps automatically; keeps `latest_waystones` in sync):
```bash
curl -X POST http://localhost:49876/api/scan-waystone \
  -H 'Content-Type: application/json' \
  -d '{
    "senderId": "agent-42",
    "dimension": "overworld",
    "position": [128, 70, 560],
    "chunkX": 8,
    "chunkZ": 35,
    "name": "Spawn Hub",
    "owner": "Server Admin"
  }'
```

List the latest chunk coordinates with summary stats (includes chunks from active waystones even before they are chunk-scanned):
```bash
curl "http://localhost:49876/api/chunks?limit=20"
```
