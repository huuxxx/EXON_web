import { NextResponse } from 'next/server';
import { Constants } from '@/util/constants';
import { Redis } from '@upstash/redis';
import { isSteamIdBanned, logRequest } from '@/util/db';

const RATE_LIMIT_WINDOW_SEC = 600; // 10 minutes
const MAX_SUBMISSIONS_PER_WINDOW = 3; // 3 full completions per 10 minutes
const redis = Redis.fromEnv();

export async function POST(req: Request) {
  const forwarded = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip');
  const ip = forwarded ? forwarded.split(',')[0].trim() : 'unknown';
  let steamId: string | undefined;
  let score: number | undefined;
  let success = false;

  try {
    const body = await req.json();
    steamId = body.steamId;
    score = body.score;
    const ticket = body.ticket;

    if (!steamId || score == null || !ticket) {
      logRequest({
        ipAddress: ip,
        steamId,
        score,
        rateLimited: false,
        success: false,
        requestResult: 'Missing parameters',
      }).catch(() => {});
      return NextResponse.json({}, { status: 400 });
    }

    const ticketValidation = await validateSteamTicket(steamId, ticket);
    if (!ticketValidation.valid) {
      logRequest({
        ipAddress: ip,
        steamId,
        score,
        rateLimited: false,
        success: false,
        requestResult: ticketValidation.reason || 'Invalid ticket',
      }).catch(() => {});
      return NextResponse.json({}, { status: 403 });
    }

    const banned = await isSteamIdBanned(steamId);
    if (banned) {
      logRequest({
        ipAddress: ip,
        steamId,
        score,
        rateLimited: false,
        success: false,
        requestResult: 'Banned Steam ID',
      }).catch(() => {});
      return NextResponse.json({}, { status: 403 });
    }

    const limiterKey = steamId ? `steam:${steamId}` : `ip:${ip}`;

    const rateLimitedData = await checkRateLimit(limiterKey);
    if (rateLimitedData.limited) {
      logRequest({
        ipAddress: ip,
        steamId,
        score,
        rateLimited: true,
        success: false,
        requestResult: 'Rate limited',
      }).catch(() => {});
      return NextResponse.json({}, { status: 429 });
    }

    const params = new URLSearchParams({
      key: process.env[Constants.STEAM_WEB_API_KEY]!,
      appid: process.env[Constants.APP_ID_DEMO]!,
      leaderboardid: process.env[Constants.LEADERBOARD_TEST_ID]!,
      steamid: steamId,
      score: score.toString(),
      scoremethod: Constants.STEAM_API_SCORE_METHOD_KEEP_BEST,
    });

    const url = `https://partner.steam-api.com/ISteamLeaderboards/SetLeaderboardScore/v1/`;
    const steamRes = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      },
      body: params.toString(),
    });

    const raw = await steamRes.text();
    let json: any = null;
    json = JSON.parse(raw);
    console.log('submit-score Steam response: ', json ?? raw);
    success = steamRes.ok ? true : false;

    logRequest({
      ipAddress: ip,
      steamId,
      score,
      rateLimited: false,
      success: success,
      requestResult: success ? 'Success' : 'Steam API error',
    }).catch(() => {});

    return NextResponse.json({ json }, { status: 200 });
  } catch (err: any) {
    logRequest({
      ipAddress: ip,
      steamId: steamId,
      score: score,
      rateLimited: false,
      success: false,
      requestResult: 'Parse error',
    }).catch(() => {});
    return NextResponse.json({}, { status: 400 });
  }
}

async function checkRateLimit(key: string): Promise<{ limited: boolean; retryAfter?: number }> {
  const window = RATE_LIMIT_WINDOW_SEC;
  const bucket = `rl:${key}:${Math.floor(Date.now() / 1000 / window)}`;

  const count = await redis.incr(bucket);
  if (count === 1) {
    await redis.expire(bucket, window);
  }

  if (count > MAX_SUBMISSIONS_PER_WINDOW) {
    const ttl = await redis.ttl(bucket);
    return { limited: true, retryAfter: ttl > 0 ? ttl : window };
  }

  return { limited: false };
}

async function validateSteamTicket(
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
    console.log('Steam ticket auth response:', authData);

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
