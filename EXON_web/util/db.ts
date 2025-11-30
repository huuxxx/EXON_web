import { Pool } from 'pg';
import { Constants } from './constants';

// Singleton connection pool for serverless (reused across invocations)
let pool: Pool | null = null;

function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      host: process.env.POSTGRES_HOST,
      port: parseInt(process.env.POSTGRES_PORT || '5432'),
      database: process.env.POSTGRES_DATABASE,
      user: process.env.POSTGRES_USER,
      password: process.env.POSTGRES_PASSWORD,
      ssl: {
        rejectUnauthorized: false, // AWS RDS uses self-signed certificates
      },
      max: 2, // Low max for serverless to avoid connection exhaustion
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });
  }
  return pool;
}

/**
 * Check if a Steam ID is banned
 */
export async function isSteamIdBanned(steamId: string): Promise<boolean> {
  try {
    const pool = getPool();
    const result = await pool.query('SELECT 1 FROM banned_steam_ids WHERE steam_id = $1 LIMIT 1', [
      steamId,
    ]);
    return result.rows.length > 0;
  } catch (error) {
    console.error('Error checking ban status:', error);
    return false; // Fail open to not block legitimate users on DB errors
  }
}

/**
 * Ban a Steam ID and log the associated IP address
 * Also removes the Steam ID from all leaderboards
 */
export async function banSteamId(
  steamId: string,
  ipAddress: string,
  reason: string
): Promise<void> {
  try {
    const pool = getPool();

    // Insert ban with IP address included in reason for easy reference
    const banReason = `${reason} (IP: ${ipAddress})`;
    await pool.query(
      'INSERT INTO banned_steam_ids (steam_id, reason) VALUES ($1, $2) ON CONFLICT (steam_id) DO NOTHING',
      [steamId, banReason]
    );

    console.log(`🚫 AUTO-BAN: Steam ID ${steamId} | IP ${ipAddress} | Reason: ${reason}`);
    console.log(`   Add to Netlify IP Blacklist: ${ipAddress}`);

    // Remove from all leaderboards
    await removeFromAllLeaderboards(steamId);
  } catch (error) {
    console.error('Error banning Steam ID:', error);
  }
}

/**
 * Remove a Steam ID from all difficulty leaderboards
 */
async function removeFromAllLeaderboards(steamId: string): Promise<void> {
  const leaderboardIds = [
    process.env[Constants.LEADERBOARD_DEMO_EASY_ID],
    process.env[Constants.LEADERBOARD_DEMO_MEDIUM_ID],
    process.env[Constants.LEADERBOARD_DEMO_HARD_ID],
    process.env[Constants.LEADERBOARD_DEMO_VERY_HARD_ID],
  ];

  const apiKey = process.env[Constants.STEAM_WEB_API_KEY];
  const appId = process.env[Constants.APP_ID_DEMO];

  if (!apiKey || !appId) {
    console.error('Missing Steam API credentials for leaderboard cleanup');
    return;
  }

  for (const leaderboardId of leaderboardIds) {
    if (!leaderboardId) continue;

    try {
      const params = new URLSearchParams({
        key: apiKey,
        appid: appId,
        leaderboardid: leaderboardId,
        steamid: steamId,
      });

      const url = `https://partner.steam-api.com/ISteamLeaderboards/DeleteLeaderboardScore/v1/`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        },
        body: params.toString(),
      });

      if (response.ok) {
        console.log(`   ✓ Removed from leaderboard ${leaderboardId}`);
      } else {
        const errorText = await response.text();
        console.error(`   ✗ Failed to remove from leaderboard ${leaderboardId}: ${errorText}`);
      }
    } catch (error) {
      console.error(`   ✗ Error removing from leaderboard ${leaderboardId}:`, error);
    }
  }
}

/**
 * Log a request (async, non-blocking - fire-and-forget)
 */
export async function logRequest(data: {
  ipAddress: string;
  steamId?: string;
  levelName?: string;
  difficulty?: string;
  score?: number;
  rateLimited: boolean;
  success: boolean;
  requestResult?: string;
}): Promise<void> {
  try {
    const pool = getPool();
    await pool.query(
      `INSERT INTO request_logs (ip_address, steam_id, level_name, difficulty, score, rate_limited, success, request_result)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        data.ipAddress,
        data.steamId || null,
        data.levelName || null,
        data.difficulty || null,
        data.score || null,
        data.rateLimited,
        data.success,
        data.requestResult || null,
      ]
    );
  } catch (error) {
    // Log error but don't throw - logging failures shouldn't break the endpoint
    console.error('Error logging request:', error);
  }
}
