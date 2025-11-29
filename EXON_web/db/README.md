# Database Setup for Score Submission Logging

This guide covers setting up Postgres tables for request logging and Steam ID banning.

## 1. Create the database tables

Run the SQL schema to create tables and indexes:

```bash
psql "$POSTGRES_CONNECTION_STRING" -f db/schema.sql
```

Or manually execute the contents of `db/schema.sql` in your Postgres client.

## 2. Environment variables

Ensure `POSTGRES_CONNECTION_STRING` is set in:

- `.env` (local development)
- Netlify environment variables (production)

Format:

```
POSTGRES_CONNECTION_STRING="Host=your-host;Port=5432;Database=exon;Username=user;Password='password'"
```

## 3. How it works

### Request flow:

1. **Ban check** — Queries `banned_steam_ids` table for the Steam ID
2. **Rate limit check** — Uses Redis (Upstash) to enforce 3 submissions per 10 minutes
3. **Logging** — All requests are logged to `request_logs` (async, non-blocking)
4. **Steam API call** — If allowed, submits score to Steam

### Tables:

#### `request_logs`

Stores all submission attempts with:

- `timestamp`, `ip_address`, `steam_id`, `score`
- `rate_limited` (boolean) — was this request blocked by rate limiter?
- `success` (boolean) — did Steam API accept the submission?

#### `banned_steam_ids`

Stores banned Steam IDs with:

- `steam_id` (unique), `reason`, `banned_at`

## 4. Finding and banning attackers

Use the example queries in `db/queries.sql`:

```sql
-- Find Steam IDs hitting rate limits repeatedly
SELECT steam_id, COUNT(*) as violations
FROM request_logs
WHERE rate_limited = true AND steam_id IS NOT NULL
GROUP BY steam_id
HAVING COUNT(*) >= 10
ORDER BY violations DESC;
```

**To ban a Steam ID:**

```sql
INSERT INTO banned_steam_ids (steam_id, reason)
VALUES ('76561198012345678', 'Repeated rate-limit violations');
```

**To unban:**

```sql
DELETE FROM banned_steam_ids WHERE steam_id = '76561198012345678';
```

## 5. Maintenance

### Clean up old logs (optional)

To save DB space, periodically delete logs older than 90 days:

```sql
DELETE FROM request_logs WHERE timestamp < NOW() - INTERVAL '90 days';
```

Or set up a cron job / scheduled task.

### Monitor performance

- Add additional indexes if queries are slow
- Consider partitioning `request_logs` by timestamp for large datasets
- Monitor connection pool usage in serverless logs

## 6. IP banning (via Netlify)

For persistent attackers, ban their IP at the Netlify level:

1. Go to Netlify dashboard → Site settings → Build & deploy → Post processing
2. Add IP blocking rules or use Netlify Edge Functions

Steam ID bans are handled in the app (Postgres table), IP bans should be done at the edge/CDN layer.
