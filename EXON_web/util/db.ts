import { Pool } from 'pg';

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
