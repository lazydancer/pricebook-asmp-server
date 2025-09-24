# Scan API Integration Summary

This service records append-only scans for shop and waystone data. The Minecraft mod should call these endpoints with JSON payloads encoded as UTF-8.

## Base URL
Default host is `http://localhost:49876`. Override by setting `PORT` in the server `.env` file.

## POST /v1/scan
Appends a single scan and its observed shops + chunk-level waystone sightings.

### Request Body
```json
{
  "senderId": "string",                 // required identifier for the scanner agent
  "dimension": "overworld",             // optional if provided per shop
  "chunkX": 7,                           // optional; derived from first shop if omitted
  "chunkZ": 35,
  "scanId": "uuid-string",              // optional; server generates if missing
  "shops": [
    {
      "owner": "Alice",
      "item": "Diamond",
      "position": [120, 64, 560],        // [x,y,z] block coordinates
      "price": 32.0,                     // numeric
      "amount": 3,                       // integer count
      "dimension": "overworld",         // text (overworld, end or nether)
      "action": "sell"                  // text (buy, sell, or out of stock)
    }
  ],
  "waystones": [
    {
      "position": [128, 70, 560],        // required [x,y,z]
      "dimension": "overworld"         // optional; defaults to scan dimension
    }
  ]
}
```

- `shops`/`waystones` may be empty to record "no shops/waystones observed".
- Chunk scan waystones only send position (and optional dimension); metadata like name/owner arrives via `/api/scan-waystone`.
- `action` is optional; when provided, the value must be exactly `buy`, `sell`, or `out of stock`.
- Positions are chunk-aligned: chunk is `floor(x/16)`, `floor(z/16)` when not supplied.
- Server response: `201 Created` with
```json
{
  "ok": true,
  "scanId": "uuid-string",
  "dimension": "overworld",
  "chunkX": 7,
  "chunkZ": 35,
  "observed": 1,
  "observedWaystones": 1
}
```
- Error cases return `400` (validation) or `409` (duplicate `scanId`).

## POST /v1/scan-waystone
Appends a single waystone observation captured when the UI opens. This endpoint enriches metadata (name/owner) without wiping chunk-level shop state. UI reports create or refresh entries in `latest_waystones`; chunk scans only remove waystones that go missing. The server records the receipt timestamp automatically.

### Request Body
```json
{
  "senderId": "string",                 // required
  "dimension": "overworld",             // required
  "position": [128, 70, 560],            // required block coords
  "chunkX": 8,                           // required chunk derived from position
  "chunkZ": 35,                          // required chunk derived from position
  "name": "Spawn Hub",                  // required display name (use null if unknown)
  "owner": "Server Admin"               // required owner tag (use null if unknown)
}
```

### Response
```json
{
  "ok": true,
  "scanId": "uuid-string",
  "dimension": "overworld",
  "chunkX": 8,
  "chunkZ": 35,
  "observedWaystones": 1,
  "waystone": {
    "position": [128, 70, 560],
    "name": "Spawn Hub",
    "owner": "Server Admin"
  }
}
```

## GET /v1/chunks
Returns paged chunk coordinates with stored scans and summary stats for both shops and waystones. Chunks with active `latest_waystones` appear even if they have never been chunk-scanned (those entries will show `totalScans = 0`).

Each latest shop record now carries `nearest_waystone_name`, `nearest_waystone_x/y/z`, and `nearest_waystone_distance_sq`, reflecting the closest active waystone when the server processed the observation. These fields surface in item-related responses.

### Response
```json
{
  "chunks": [
    {
      "dimension": "overworld",
      "chunkX": 7,
      "chunkZ": 35,
      "totalScans": 12,
      "latestScannedAt": "2024-04-10T15:10:00.000Z",
      "minutesSinceLastScan": 5,
      "lastObservedCount": 2,
      "everObservedDistinct": 5,
      "lastObservedWaystones": 1,
      "everObservedWaystones": 3
    }
  ]
}
```

Use `limit/offset` for pagination. Filtering happens server-side before pagination, so a large offset might lead to empty pages when filters exclude newer chunks. Additional filters: `minEverWaystones`, `hasWaystones=true|false`.

Chunks surfaced only via `latest_waystones` report `totalScans = 0`, `latestScannedAt = null`, and `minutesSinceLastScan = null` until a chunk sweep runs.

Item-oriented responses now include a `nearestWaystone` object (name, position, distanceSq) for each entry whenever an active waystone is available.

## GET /v1/item
Returns pricing information for a specific item, including top sellers and buyers.

### Query Parameters
- `item` (required): The item name to search for
- `dimension` (optional): Filter results by dimension
- `limit` (optional): Maximum results per category (default: 3, max: 10)

### Response
```json
{
  "ok": true,
  "item": "Diamond",
  "refreshedAt": "2024-04-10T15:10:00.000Z",
  "topSellers": [
    {
      "owner": "Alice",
      "price": 32.0,
      "amount": 3,
      "coords": [120, 64, 560],
      "dimension": "overworld",
      "lastSeenAt": "2024-04-10T15:10:00.000Z",
      "nearestWaystone": {
        "name": "Spawn Hub",
        "position": [128, 70, 560],
        "distanceSq": 64
      }
    }
  ],
  "topBuyers": []
}
```

## GET /v1/items
Returns a list of all items that have been observed in scans.

### Response
```json
{
  "ok": true,
  "refreshedAt": "2024-04-10T15:10:00.000Z",
  "items": [
    { "name": "Diamond" },
    { "name": "Iron Ingot" },
    { "name": "Gold Ingot" }
  ]
}
```

## Operational Notes
- Database path defaults to `asmp.db`; configure with `DB_FILE` in `.env`.
- Run `npm run db:reset` and `npm run db:seed` when bootstrapping local data for integration tests.
- The API enforces unique `(scanId, dimension, owner, item, position)` per scan to prevent duplicate shop entries, and `(scanId, dimension, position)` per scan for waystones.
