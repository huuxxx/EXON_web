# Stats Submission System

## Overview

The score submission endpoint now accepts comprehensive game statistics with HMAC-SHA256 validation to prevent cheating. This document explains the system architecture, validation rules, and integration steps.

---

## Security Features

### 1. HMAC Validation

- **Algorithm**: HMAC-SHA256
- **Secret Key**: Stored in `STATS_SECRET_KEY` environment variable (server) and game build (client)
- **Purpose**: Ensures data integrity and prevents tampering with stats
- **Process**: Client computes HMAC of canonical JSON data, server verifies before accepting

### 2. Stats Validation

- **Round Times**: 10-600 seconds per round (10000-600000 milliseconds)
- **Total Kills**: Maximum 300 across all guns
- **Total Damage**: Maximum 200,000 across all guns
- **Ability Uses**: Maximum 150 total uses
- **Utility Stats**: Maximum 50,000 per ability
- **Math Consistency**: finalScore must equal sum of roundTimes (±100ms tolerance)

### 3. Steam Ticket Authentication

- Validates Steam session ticket via `ISteamUserAuth/AuthenticateUserTicket`
- Verifies Steam ID ownership and app ownership
- Already implemented in previous phase

### 4. Rate Limiting

- 3 submissions per 10 minutes per Steam ID
- Already implemented with Redis/Upstash

---

## API Endpoint

### POST `/api/submit-score`

**Request Body:**

```json
{
  "steamId": "76561198012345678",
  "ticket": "hex_encoded_steam_ticket",
  "finalScore": 261000,
  "roundTimes": [25000, 26000, 24500, 27000, 25500, 26500, 25000, 26000, 25500, 25000],
  "gunStats": [
    { "name": "pistol", "kills": 50, "damage": 25000 },
    { "name": "shotgun", "kills": 40, "damage": 35000 },
    { "name": "rifle", "kills": 80, "damage": 45000 },
    { "name": "launcher", "kills": 30, "damage": 40000 },
    { "name": "minigun", "kills": 50, "damage": 30000 }
  ],
  "abilityStats": [
    { "name": "blast", "uses": 25, "utility": 5000 },
    { "name": "blade", "uses": 30, "utility": 8000 },
    { "name": "barrier", "uses": 20, "utility": 12000 },
    { "name": "combustion", "uses": 15, "utility": 35 },
    { "name": "jump", "uses": 0, "utility": 0 },
    { "name": "warp", "uses": 0, "utility": 0 }
  ],
  "dataHMAC": "a1b2c3d4e5f6..."
}
```

**Response Codes:**

- `200`: Success
- `400`: Missing parameters or parse error
- `403`: Invalid HMAC, invalid stats, invalid ticket, or banned Steam ID
- `429`: Rate limited

---

## Steam Leaderboard Metadata

Stats are packed into Steam's 64-integer metadata array for display on leaderboards:

### Layout

**Guns (Slots 0-23):** 12 guns × 2 stats = 24 slots

```
[0-1]   = pistol_kills, pistol_damage
[2-3]   = shotgun_kills, shotgun_damage
[4-5]   = rifle_kills, rifle_damage
[6-7]   = launcher_kills, launcher_damage
[8-9]   = minigun_kills, minigun_damage
[10-23] = reserved for 7 future guns
```

**Abilities (Slots 24-43):** 10 abilities × 2 stats = 20 slots

```
[24-25] = blast_uses, blast_utility (nanite)
[26-27] = blade_uses, blade_utility (healing)
[28-29] = barrier_uses, barrier_utility (absorbed)
[30-31] = combustion_uses, combustion_utility (kills)
[32-33] = jump_uses, jump_utility (reserved)
[34-35] = warp_uses, warp_utility (reserved)
[36-43] = reserved for 4 future abilities
```

**Summary Stats (Slots 44-47):**

```
[44] = total_kills
[45] = total_damage
[46] = total_ability_uses
[47] = total_ability_utility
```

**Unused:** Slots 48-63 (16 slots for future expansion)

---

## Client Integration

### C# Example

See `client-hmac-example.cs` for complete implementation including:

- HMAC-SHA256 computation
- JSON serialization with correct property naming
- Integration with existing `StatsProperties` system
- Example submission at end of round 10

### Key Steps

1. **Collect Stats During Gameplay**
   - Track round times in milliseconds
   - Track per-gun kills and damage
   - Track per-ability uses and utility values

2. **Get Steam Data**

   ```csharp
   CSteamID steamId = SteamUser.GetSteamID();
   byte[] ticket = new byte[1024];
   uint ticketSize;
   HAuthTicket authTicket = SteamUser.GetAuthSessionTicket(ticket, ticket.Length, out ticketSize);
   string ticketHex = BitConverter.ToString(ticket, 0, (int)ticketSize).Replace("-", "");
   ```

3. **Prepare Submission Data**

   ```csharp
   var submission = new StatsSubmission
   {
       steamId = steamId.ToString(),
       ticket = ticketHex,
       finalScore = roundTimes.Sum(),
       roundTimes = roundTimes,
       gunStats = gunStats,
       abilityStats = abilityStats
   };
   ```

4. **Compute HMAC**

   ```csharp
   var canonicalData = new
   {
       steamId = submission.steamId,
       finalScore = submission.finalScore,
       roundTimes = submission.roundTimes,
       gunStats = submission.gunStats,
       abilityStats = submission.abilityStats
   };
   string canonicalJson = JsonSerializer.Serialize(canonicalData);
   using (var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(STATS_SECRET_KEY)))
   {
       byte[] hash = hmac.ComputeHash(Encoding.UTF8.GetBytes(canonicalJson));
       submission.dataHMAC = BitConverter.ToString(hash).Replace("-", "").ToLower();
   }
   ```

5. **Submit to API**
   ```csharp
   string jsonBody = JsonSerializer.Serialize(submission);
   var content = new StringContent(jsonBody, Encoding.UTF8, "application/json");
   var response = await client.PostAsync(API_ENDPOINT, content);
   ```

---

## Environment Variables

Add to `.env` (local) and Netlify environment:

```env
STATS_SECRET_KEY=your-secure-random-key-here
```

**Generate a secure key:**

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## Database Logging

All requests are logged to `request_logs` table with `request_result` column tracking outcomes:

**Possible Values:**

- `"Success"` - Submission accepted
- `"Missing parameters"` - Required field missing
- `"Invalid HMAC"` - HMAC verification failed
- `"HMAC mismatch"` - HMAC doesn't match computed value
- `"Invalid stats"` - Stats validation failed (includes reason)
- `"Invalid ticket"` - Steam ticket validation failed
- `"Steam ID mismatch"` - Ticket Steam ID doesn't match submitted ID
- `"Not app owner"` - Steam account doesn't own the game
- `"Banned Steam ID"` - User is banned
- `"Rate limited"` - Too many submissions
- `"Steam API error"` - Steam leaderboard API error
- `"Parse error"` - JSON parsing failed

---

## Testing

### Valid Submission Test

```bash
curl -X POST https://your-domain.com/api/submit-score \
  -H "Content-Type: application/json" \
  -d '{
    "steamId": "76561198012345678",
    "ticket": "your_hex_ticket",
    "finalScore": 26100,
    "roundTimes": [2500, 2600, 2450, 2700, 2550, 2650, 2500, 2600, 2550, 2500],
    "gunStats": [
      {"name": "pistol", "kills": 50, "damage": 25000},
      {"name": "shotgun", "kills": 40, "damage": 35000},
      {"name": "rifle", "kills": 80, "damage": 45000},
      {"name": "launcher", "kills": 30, "damage": 40000},
      {"name": "minigun", "kills": 50, "damage": 30000}
    ],
    "abilityStats": [
      {"name": "blast", "uses": 25, "utility": 5000},
      {"name": "blade", "uses": 30, "utility": 8000},
      {"name": "barrier", "uses": 20, "utility": 12000},
      {"name": "combustion", "uses": 15, "utility": 35},
      {"name": "jump", "uses": 0, "utility": 0},
      {"name": "warp", "uses": 0, "utility": 0}
    ],
    "dataHMAC": "computed_hmac_here"
  }'
```

### Invalid HMAC Test

Change `dataHMAC` to an incorrect value - should return 403 with "Invalid HMAC" logged.

### Invalid Stats Test

Set `totalKills` > 300 or `totalDamage` > 200000 - should return 403 with detailed reason.

---

## Future Enhancements

1. **Jump/Warp Tracking**: Currently reserved, enable tracking when ready
2. **Additional Guns**: Slots 10-23 reserved for 7 more guns
3. **Additional Abilities**: Slots 36-43 reserved for 4 more abilities
4. **Round-by-Round Details**: Use unused slots 48-63 for per-round breakdowns
5. **Difficulty Modifiers**: Track game difficulty or modifiers in metadata
6. **Replay Validation**: Store replay data hash for manual review of suspicious scores

---

## Troubleshooting

### "Invalid HMAC" Errors

- Ensure `STATS_SECRET_KEY` matches on client and server
- Verify JSON serialization uses **camelCase** property naming
- Check canonical data order matches exactly (steamId, finalScore, roundTimes, gunStats, abilityStats)
- Ensure HMAC is lowercase hex string

### "Invalid stats" Errors

- Check validation thresholds (kills < 300, damage < 200000, etc.)
- Verify finalScore equals sum of roundTimes
- Ensure all 10 rounds are included
- Ensure all 5 guns are included
- Ensure all 6 abilities are included

### Rate Limiting

- Wait 10 minutes between submissions during testing
- Use different Steam IDs for parallel testing
- Check Redis connection if rate limit not working

---

## Security Considerations

1. **Secret Key Protection**: Store `STATS_SECRET_KEY` securely, obfuscate in game build
2. **Validation Thresholds**: Adjust based on actual gameplay data (currently set conservatively)
3. **Pattern Detection**: Use SQL queries in `db/queries.sql` to identify suspicious patterns
4. **Manual Review**: Flag impossible scores for manual replay review
5. **Version Updates**: Include game version in future to invalidate old exploits

---

## Questions?

For implementation help or questions about this system, refer to:

- `app/api/submit-score/route.ts` - Server-side implementation
- `docs/client-hmac-example.cs` - Client-side C# example
- `db/queries.sql` - Security monitoring queries
