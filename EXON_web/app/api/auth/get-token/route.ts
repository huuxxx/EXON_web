import { NextResponse } from 'next/server';
import { Constants } from '@/util/constants';
import { Redis } from '@upstash/redis';
import { isSteamIdBanned, banSteamId } from '@/util/db';
import { checkRateLimit, validateSteamTicket } from '@/util/auth';
import crypto from 'crypto';

interface TokenRequest {
  steamId: string;
  ticket: string;
}

interface TokenPayload {
  steamId: string;
  iat: number; // issued at (unix timestamp)
  exp: number; // expires at (unix timestamp)
  nonce: string; // unique identifier to prevent replay
}

const TOKEN_EXPIRY_SECONDS = 30; // 30 seconds
const RATE_LIMIT_WINDOW_SEC = 600; // 10 minutes
const MAX_TOKEN_REQUESTS_PER_WINDOW = 3; // 3 token requests per 10 minutes
const redis = Redis.fromEnv();
const showDetailedResponse =
  process.env.NODE_ENV === 'development' ||
  process.env[Constants.ENABLE_DETAILED_RESPONSE] === 'true';

export async function POST(req: Request) {
  const forwarded = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip');
  const ipAddress = forwarded ? forwarded.split(',')[0].trim() : 'unknown';

  try {
    const body: TokenRequest = await req.json();
    const { steamId, ticket } = body;

    // 1. Rate limit check - IP and Steam ID
    const ipLimiterKey = `token:ip:${ipAddress}`;
    const steamLimiterKey = `token:steam:${steamId}`;

    const ipRateLimited = await checkRateLimit(
      ipLimiterKey,
      RATE_LIMIT_WINDOW_SEC,
      MAX_TOKEN_REQUESTS_PER_WINDOW
    );
    if (ipRateLimited.limited) {
      console.log(`🚫 Token rate limited (IP): ${ipAddress} | Steam ID: ${steamId || 'unknown'}`);
      return NextResponse.json(
        showDetailedResponse ? { error: 'Rate limited', retryAfter: ipRateLimited.retryAfter } : {},
        { status: 429 }
      );
    }

    const steamRateLimited = await checkRateLimit(
      steamLimiterKey,
      RATE_LIMIT_WINDOW_SEC,
      MAX_TOKEN_REQUESTS_PER_WINDOW
    );
    if (steamRateLimited.limited) {
      console.log(`🚫 Token rate limited (Steam ID): ${steamId} | IP: ${ipAddress}`);
      return NextResponse.json(
        showDetailedResponse
          ? { error: 'Rate limited', retryAfter: steamRateLimited.retryAfter }
          : {},
        { status: 429 }
      );
    }

    // 2. Validate required fields
    if (!steamId || !ticket) {
      return NextResponse.json(
        showDetailedResponse
          ? { error: 'Missing required fields', details: 'steamId and ticket are required' }
          : {},
        { status: 400 }
      );
    }

    // 3. DB ban check
    const banned = await isSteamIdBanned(steamId);
    if (banned) {
      console.log(`🚫 Banned user attempted token request: ${steamId} | IP: ${ipAddress}`);
      return NextResponse.json(showDetailedResponse ? { error: 'Steam ID is banned' } : {}, {
        status: 403,
      });
    }

    // 4. Validate Steam ticket (auto-ban on failure)
    const ticketValidation = await validateSteamTicket(steamId, ticket);
    if (!ticketValidation.valid) {
      console.log(
        `🚫 AUTO-BAN: Invalid Steam ticket for token | Steam ID: ${steamId} | IP: ${ipAddress} | Reason: ${ticketValidation.reason}`
      );
      await banSteamId(
        steamId,
        ipAddress,
        `Token request with invalid Steam ticket: ${ticketValidation.reason}`
      );
      return NextResponse.json(
        showDetailedResponse
          ? {
              error: 'Steam ticket validation failed',
              reason: ticketValidation.reason,
            }
          : {},
        { status: 403 }
      );
    }

    // 5. Create token payload
    const now = Math.floor(Date.now() / 1000);
    const payload: TokenPayload = {
      steamId,
      iat: now,
      exp: now + TOKEN_EXPIRY_SECONDS,
      nonce: crypto.randomBytes(16).toString('hex'),
    };

    const token = signToken(payload);
    console.log(
      `✅ Token issued: ${steamId} | IP: ${ipAddress} | Expires in: ${TOKEN_EXPIRY_SECONDS}s`
    );

    return NextResponse.json(
      {
        token,
        expiresIn: TOKEN_EXPIRY_SECONDS,
        expiresAt: payload.exp,
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.log(`❌ Token request error | IP: ${ipAddress} | Error: ${err.message}`);
    return NextResponse.json(
      showDetailedResponse ? { error: 'Invalid request', details: err.message } : {},
      { status: 400 }
    );
  }
}

function signToken(payload: TokenPayload): string {
  const secret = process.env.STATS_SECRET_KEY;
  if (!secret) {
    throw new Error('STATS_SECRET_KEY not configured');
  }

  // Create base64url encoded payload
  const payloadJson = JSON.stringify(payload);
  const payloadBase64 = Buffer.from(payloadJson)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  // Create HMAC signature
  const signature = crypto
    .createHmac('sha256', secret)
    .update(payloadBase64)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  // Return token in format: payload.signature
  return `${payloadBase64}.${signature}`;
}

export function verifyToken(token: string): {
  valid: boolean;
  payload?: TokenPayload;
  reason?: string;
} {
  try {
    const secret = process.env.STATS_SECRET_KEY;
    if (!secret) {
      return { valid: false, reason: 'Server configuration error' };
    }

    const parts = token.split('.');
    if (parts.length !== 2) {
      return { valid: false, reason: 'Invalid token format' };
    }

    const [payloadBase64, signature] = parts;

    // Verify signature
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(payloadBase64)
      .digest('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');

    if (signature !== expectedSignature) {
      return { valid: false, reason: 'Invalid signature' };
    }

    // Decode payload
    const payloadJson = Buffer.from(
      payloadBase64.replace(/-/g, '+').replace(/_/g, '/'),
      'base64'
    ).toString('utf-8');
    const payload: TokenPayload = JSON.parse(payloadJson);

    // Check expiry
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp < now) {
      return { valid: false, reason: 'Token expired' };
    }

    return { valid: true, payload };
  } catch (error) {
    console.error('Token verification error:', error);
    return { valid: false, reason: 'Token verification failed' };
  }
}
