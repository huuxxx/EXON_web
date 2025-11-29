import { NextResponse } from 'next/server';
import { Constants } from '@/util/constants';
import { Redis } from '@upstash/redis';

const RATE_LIMIT_WINDOW_SEC = 600; // 10 minutes
const MAX_SUBMISSIONS_PER_WINDOW = 3; // 3 full completions per 10 minutes
const redis = Redis.fromEnv();

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

export async function POST(req: Request) {
  try {
    const { steamId, score } = await req.json();

    if (!steamId || score == null) {
      return NextResponse.json({ error: 'Missing parameters' }, { status: 400 });
    }

    // Determine client identity for rate limiting. Prefer Steam ID, fallback to IP.
    const forwarded = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip');
    const ip = forwarded ? forwarded.split(',')[0].trim() : 'unknown';
    const limiterKey = steamId ? `steam:${steamId}` : `ip:${ip}`;

    // Check rate limit via Redis
    const rl = await checkRateLimit(limiterKey);
    if (rl.limited) {
      return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
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
    console.log('submit score: ', json ?? raw);
    try {
      json = JSON.parse(raw);
    } catch {}

    if (!steamRes.ok) {
      return NextResponse.json(
        { error: 'Steam API returned error', body: json ?? raw },
        { status: steamRes.status }
      );
    }

    return NextResponse.json(json ?? raw);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
