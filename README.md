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
curl "http://localhost:49876/api/chunks"
```

## Deployment

### Docker
1. Build the image: `docker build -t pricebook-asmp-server .`
2. Run it locally: `sudo docker run --rm -p 49876:8080 -e DB_FILE=/data/asmp.db -v "$(pwd)/asmp.db:/data/asmp.db" pricebook-asmp-server`

### Fly.io
1. Install the Fly CLI and authenticate (`fly auth login`).
2. Initialize the app (once): `fly launch --no-deploy --copy-config`
   - When prompted, choose to use the existing `Dockerfile`, set the internal port to `8080`, and skip the database addon.
3. Add a persistent volume for the SQLite database (optional but recommended): `fly volumes create data --size 1`
   - Mount it by adding `[[mounts]]` with `source="data"` and `destination="/data"` to `fly.toml`, and set `DB_FILE=/data/asmp.db` via `fly secrets set`.
4. Deploy: `fly deploy`
5. Tail logs if needed: `fly logs`
