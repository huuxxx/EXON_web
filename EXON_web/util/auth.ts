import { Redis } from '@upstash/redis';
import { Constants } from '@/util/constants';

const redis = Redis.fromEnv();

export async function checkRateLimit(
  key: string,
  window: number,
  maxRequests: number
): Promise<{ limited: boolean; retryAfter?: number }> {
  const bucket = `rl:${key}:${Math.floor(Date.now() / 1000 / window)}`;

  const count = await redis.incr(bucket);
  if (count === 1) {
    await redis.expire(bucket, window);
  }

  if (count > maxRequests) {
    const ttl = await redis.ttl(bucket);
    return { limited: true, retryAfter: ttl > 0 ? ttl : window };
  }

  return { limited: false };
}

export async function validateSteamTicket(
  steamId: string,
  ticket: string
): Promise<{ valid: boolean; reason?: string }> {
  try {
    const authUrl = 'https://api.steampowered.com/ISteamUserAuth/AuthenticateUserTicket/v1/';
    const params = new URLSearchParams({
      key: process.env[Constants.STEAM_WEB_API_KEY]!,
      appid: process.env[Constants.APP_ID_DEMO]!,
      ticket: ticket,
    });

    const authRes = await fetch(`${authUrl}?${params.toString()}`);
    const authData = await authRes.json();

    if (authData.response?.error) {
      return { valid: false, reason: 'Invalid ticket' };
    }

    const ticketSteamId = authData.response?.params?.steamid;
    if (!ticketSteamId || ticketSteamId !== steamId) {
      return { valid: false, reason: 'Steam ID mismatch' };
    }

    const ownerSteamId = authData.response?.params?.ownersteamid;
    if (ownerSteamId && ownerSteamId !== steamId) {
      return { valid: false, reason: 'Not app owner' };
    }

    return { valid: true };
  } catch (error) {
    console.error('Steam ticket validation error:', error);
    return { valid: false, reason: 'Validation failed' };
  }
}
