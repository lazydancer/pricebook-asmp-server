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
  "shops": [
    {
      "owner": "Alice",
      "item": "Diamond",
      "position": [120, 64, 560],        // [x,y,z] block coordinates
      "price": 32.0,                     // numeric
      "amount": 3,                       // integer count
      "dimension": "overworld",         // text (overworld, end or nether)
      "action": "sell"                  // required text (buy, sell, or out of stock)
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
- Chunk scan waystones only send position (and optional dimension); metadata like name/owner arrives via `/v1/scan-waystone`.
- `action` is required for every shop row and must be exactly `buy`, `sell`, or `out of stock`.
- Positions are chunk-aligned: chunk is `floor(x/16)`, `floor(z/16)` when not supplied.
- Server response: `201 Created` with an empty body when the scan is accepted.
- Error cases return `400` (validation) or `409` (duplicate data).

## POST /v1/scan-waystone
Appends a single waystone observation captured when the UI opens. This endpoint enriches metadata (name/owner) without wiping chunk-level shop state. UI reports create or refresh entries in `latest_waystones`; chunk scans only remove waystones that go missing. The server records the receipt timestamp automatically.

### Request Body
```json
{
  "senderId": "string",                 // required
  "dimension": "overworld",             // required
  "position": [128, 70, 560],            // required block coords
  "name": "Spawn Hub",                  // required display name (use null if unknown)
  "owner": "Server Admin"               // required owner tag (use null if unknown)
}
```

- Chunk coordinates are derived server-side from the provided position.

### Response
`201 Created` with an empty body when the observation is accepted.

## GET /v1/chunks
Returns the set of chunk coordinates known to the service. A chunk appears if it has ever been scanned or if an active waystone currently references it. The response has no pagination or filters.

### Response
```json
{
  "chunks": [
    { "dimension": "overworld", "chunkX": 7, "chunkZ": 35 },
    { "dimension": "nether", "chunkX": -2, "chunkZ": 18 }
  ]
}
```

## GET /v1/item
Returns pricing information for a specific item, including top sellers and buyers.

### Query Parameters
- `item` (required): The item name to search for

The response includes up to three sellers and buyers (server default) and, when available, a `nearestWaystone.owner` value.

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
        "owner": "Server Admin",
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
- `scanId` is an auto-incrementing integer assigned by the server.
- The API enforces unique `(scanId, dimension, owner, item, position)` per scan to prevent duplicate shop entries, and `(scanId, dimension, position)` per scan for waystones.
