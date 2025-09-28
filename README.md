# Pricebook ASMP Server

Append-only API for recording overworld shop + waystone scans and summarizing watched chunks.

## Quick Start
1. Install Node.js 18+ and npm.
2. Install dependencies: `npm install`.
3. Optional: configure `.env` with `PORT` and `DB_FILE` (defaults: 49876, `asmp.db`).
4. Reset + seed: `npm run db:reset && npm run db:seed`.
5. Upgrading an existing deployment? Run any required migrations from `scripts/migrations/`, for example:
   - `node scripts/migrations/2025-09-27-migrate-scan-id.js`
   - `node scripts/migrations/2025-09-28-migrate-nearest-waystone.js`
6. Launch the API: `npm run dev`.

## API Endpoints
See [`API_INTERFACE.md`](./API_INTERFACE.md) for the full request/response contract, validation rules, and example payloads for every endpoint. The summary covers `/v1/scan`, `/v1/scan-waystone`, `/v1/chunks`, `/v1/item`, and `/v1/items`.

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
