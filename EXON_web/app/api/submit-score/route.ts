import { NextResponse } from 'next/server';
import { Constants } from '@/util/constants';
import { Redis } from '@upstash/redis';
import { isSteamIdBanned, logRequest } from '@/util/db';
import crypto from 'crypto';

interface GunStats {
  name: string; // pistol, shotgun, rifle, launcher, minigun
  kills: number;
  damage: number;
}

interface AbilityStats {
  name: string; // blast, blade, barrier, combustion, jump, warp
  uses: number;
  utility: number; // nanite, healing, absorbed, kills, or 0 for jump/warp
  kills: number; // kill count for all abilities
}

interface StatsSubmission {
  steamId: string;
  ticket: string;
  difficulty: string; // 'easy', 'medium', 'hard', 'veryHard'
  finalScore: number; // Total time in milliseconds
  roundTimes: number[]; // 10 round times in milliseconds
  roundKills: number[]; // Kill count per round (length 10)
  gunStats: GunStats[];
  abilityStats: AbilityStats[];
  dataHMAC: string; // HMAC-SHA256 signature
}

const RATE_LIMIT_WINDOW_SEC = 600; // 10 minutes
const MAX_SUBMISSIONS_PER_WINDOW = 3; // 3 full completions per 10 minutes
const redis = Redis.fromEnv();

// Validation constants
const MAX_TOTAL_DAMAGE = 200000;
const MAX_TOTAL_KILLS = 300;
const MAX_ABILITY_USES = 150;
const MAX_UTILITY_STAT = 50000;
const EXPECTED_ROUND_COUNT = 10;
const EXPECTED_GUN_COUNT = 5;
const EXPECTED_ABILITY_COUNT = 6; // blast, blade, barrier, combustion, jump, warp
const SPAWN_DURATION_MS = 2300; // Time for enemy to fully spawn
const LEVEL_NAME = 'Demo'; // Current level name

// Round spawn data: [totalMonsters, mutants, lastSpawnRequestTime (seconds)]
const ROUND_SPAWN_DATA = [
  [12, 0, 15], // Round 1
  [15, 0, 15], // Round 2
  [18, 3, 15], // Round 3
  [21, 3, 18], // Round 4
  [24, 3, 16], // Round 5
  [28, 3, 18], // Round 6
  [30, 3, 18], // Round 7
  [33, 3, 16], // Round 8
  [35, 3, 13], // Round 9
  [39, 3, 17], // Round 10
];

export async function POST(req: Request) {
  const forwarded = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip');
  const ip = forwarded ? forwarded.split(',')[0].trim() : 'unknown';
  let steamId: string | undefined;
  let score: number | undefined;
  let success = false;

  try {
    const body: StatsSubmission = await req.json();
    steamId = body.steamId;
    score = body.finalScore;
    const ticket = body.ticket;

    // Validate required fields
    if (
      !steamId ||
      score == null ||
      !ticket ||
      !body.difficulty ||
      !body.roundTimes ||
      !body.roundKills ||
      !body.gunStats ||
      !body.abilityStats ||
      !body.dataHMAC
    ) {
      logRequest({
        ipAddress: ip,
        steamId,
        levelName: LEVEL_NAME,
        difficulty: body.difficulty,
        score,
        rateLimited: false,
        success: false,
        requestResult: 'Missing parameters',
      }).catch(() => {});
      return NextResponse.json({}, { status: 400 });
    }

    // Verify HMAC signature
    const hmacValidation = verifyHMAC(body);
    if (!hmacValidation.valid) {
      logRequest({
        ipAddress: ip,
        steamId,
        levelName: LEVEL_NAME,
        difficulty: body.difficulty,
        score,
        rateLimited: false,
        success: false,
        requestResult: hmacValidation.reason || 'Invalid HMAC',
      }).catch(() => {});
      return NextResponse.json({}, { status: 403 });
    }

    // Validate stats ranges and consistency
    const statsValidation = validateStats(body);
    if (!statsValidation.valid) {
      logRequest({
        ipAddress: ip,
        steamId,
        levelName: LEVEL_NAME,
        difficulty: body.difficulty,
        score,
        rateLimited: false,
        success: false,
        requestResult: statsValidation.reason || 'Invalid stats',
      }).catch(() => {});
      return NextResponse.json({}, { status: 403 });
    }

    const ticketValidation = await validateSteamTicket(steamId, ticket);
    if (!ticketValidation.valid) {
      logRequest({
        ipAddress: ip,
        steamId,
        levelName: LEVEL_NAME,
        difficulty: body.difficulty,
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
        levelName: LEVEL_NAME,
        difficulty: body.difficulty,
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
        levelName: LEVEL_NAME,
        difficulty: body.difficulty,
        score,
        rateLimited: true,
        success: false,
        requestResult: 'Rate limited',
      }).catch(() => {});
      return NextResponse.json({}, { status: 429 });
    }

    // Pack stats into Steam metadata array
    const details = packStatsToMetadata(
      body.difficulty,
      body.roundKills,
      body.gunStats,
      body.abilityStats
    );

    const leaderboardId = getLeaderboardIdForDifficulty(body.difficulty);

    const params = new URLSearchParams({
      key: process.env[Constants.STEAM_WEB_API_KEY]!,
      appid: process.env[Constants.APP_ID_DEMO]!,
      leaderboardid: process.env[leaderboardId]!,
      steamid: steamId,
      score: score.toString(),
      scoremethod: Constants.STEAM_API_SCORE_METHOD_KEEP_BEST,
      'details[0]': details.join(','), // Steam API accepts comma-separated details
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
      levelName: LEVEL_NAME,
      difficulty: body.difficulty,
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
      levelName: LEVEL_NAME,
      difficulty: undefined,
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

function verifyHMAC(submission: StatsSubmission): { valid: boolean; reason?: string } {
  try {
    const secret = process.env.STATS_SECRET_KEY;
    if (!secret) {
      console.error('STATS_SECRET_KEY not configured');
      return { valid: false, reason: 'Server configuration error' };
    }

    // Create canonical data string (must match C# client order)
    const canonicalData = JSON.stringify({
      steamId: submission.steamId,
      difficulty: submission.difficulty,
      finalScore: submission.finalScore,
      roundTimes: submission.roundTimes,
      roundKills: submission.roundKills,
      gunStats: submission.gunStats,
      abilityStats: submission.abilityStats,
    });

    const computedHMAC = crypto.createHmac('sha256', secret).update(canonicalData).digest('hex');

    if (computedHMAC !== submission.dataHMAC.toLowerCase()) {
      return { valid: false, reason: 'HMAC mismatch' };
    }

    return { valid: true };
  } catch (error) {
    console.error('HMAC verification error:', error);
    return { valid: false, reason: 'HMAC verification failed' };
  }
}

function validateStats(submission: StatsSubmission): { valid: boolean; reason?: string } {
  // Validate difficulty
  const validDifficulties = ['easy', 'medium', 'hard', 'veryHard'];
  if (!validDifficulties.includes(submission.difficulty)) {
    return { valid: false, reason: `Invalid difficulty: ${submission.difficulty}` };
  }

  // Validate round times
  if (submission.roundTimes.length !== EXPECTED_ROUND_COUNT) {
    return {
      valid: false,
      reason: `Expected ${EXPECTED_ROUND_COUNT} rounds, got ${submission.roundTimes.length}`,
    };
  }

  // Validate roundKills array
  if (submission.roundKills.length !== EXPECTED_ROUND_COUNT) {
    return {
      valid: false,
      reason: `Expected ${EXPECTED_ROUND_COUNT} roundKills, got ${submission.roundKills.length}`,
    };
  }

  for (let i = 0; i < submission.roundTimes.length; i++) {
    const roundTime = submission.roundTimes[i];
    const roundKills = submission.roundKills[i];
    const [totalMonsters, mutants, lastSpawnTimeSec] = ROUND_SPAWN_DATA[i];

    // Validate minimum round time: last spawn request + spawn duration
    const minRoundTime = lastSpawnTimeSec * 1000 + SPAWN_DURATION_MS;
    if (roundTime < minRoundTime) {
      return {
        valid: false,
        reason: `Round ${i + 1} time ${roundTime}ms is faster than physically possible (min: ${minRoundTime}ms)`,
      };
    }

    // Validate max kills:
    if (roundKills > totalMonsters) {
      return {
        valid: false,
        reason: `Round ${i + 1} kills ${roundKills} exceeds maximum ${totalMonsters}`,
      };
    }

    // Validate kills aren't below lowest potential total monsters - mutants (mutants can self-destruct):
    const minimumKills = totalMonsters - mutants;
    if (roundKills < minimumKills) {
      return {
        valid: false,
        reason: `Round ${i + 1} has less kills than minimum possible: ${minimumKills}`,
      };
    }
  }

  // Verify finalScore matches sum of roundTimes
  const sumRoundTimes = submission.roundTimes.reduce((a, b) => a + b, 0);
  if (Math.abs(submission.finalScore - sumRoundTimes) > 100) {
    // Allow 100ms tolerance for rounding
    return {
      valid: false,
      reason: `finalScore (${submission.finalScore}) doesn't match sum of rounds (${sumRoundTimes})`,
    };
  }

  // Validate gun stats
  if (submission.gunStats.length !== EXPECTED_GUN_COUNT) {
    return {
      valid: false,
      reason: `Expected ${EXPECTED_GUN_COUNT} guns, got ${submission.gunStats.length}`,
    };
  }

  let totalKills = 0;
  let totalDamage = 0;

  for (const gun of submission.gunStats) {
    if (gun.kills < 0 || gun.kills > MAX_TOTAL_KILLS) {
      return { valid: false, reason: `${gun.name} kills out of range: ${gun.kills}` };
    }
    if (gun.damage < 0 || gun.damage > MAX_TOTAL_DAMAGE) {
      return { valid: false, reason: `${gun.name} damage out of range: ${gun.damage}` };
    }
    totalKills += gun.kills;
    totalDamage += gun.damage;
  }

  if (totalKills > MAX_TOTAL_KILLS) {
    return { valid: false, reason: `Total kills exceeds maximum: ${totalKills}` };
  }

  if (totalDamage > MAX_TOTAL_DAMAGE) {
    return { valid: false, reason: `Total damage exceeds maximum: ${totalDamage}` };
  }

  // Validate ability stats
  if (submission.abilityStats.length !== EXPECTED_ABILITY_COUNT) {
    return {
      valid: false,
      reason: `Expected ${EXPECTED_ABILITY_COUNT} abilities, got ${submission.abilityStats.length}`,
    };
  }

  let totalAbilityUses = 0;
  let totalAbilityUtility = 0;
  let totalAbilityKills = 0;

  for (const ability of submission.abilityStats) {
    if (ability.uses < 0 || ability.uses > MAX_ABILITY_USES) {
      return { valid: false, reason: `${ability.name} uses out of range: ${ability.uses}` };
    }
    if (ability.utility < 0 || ability.utility > MAX_UTILITY_STAT) {
      return { valid: false, reason: `${ability.name} utility out of range: ${ability.utility}` };
    }
    if (ability.kills < 0) {
      return { valid: false, reason: `${ability.name} has negative kills: ${ability.kills}` };
    }

    // Validate combustion: utility should equal kills (combustion_utility = combustion kills)
    if (ability.name === 'combustion' && ability.utility !== ability.kills) {
      return {
        valid: false,
        reason: `Combustion utility (${ability.utility}) must equal combustion kills (${ability.kills})`,
      };
    }

    totalAbilityUses += ability.uses;
    totalAbilityUtility += ability.utility;
    totalAbilityKills += ability.kills;
  }

  if (totalAbilityUses > MAX_ABILITY_USES) {
    return { valid: false, reason: `Total ability uses exceeds maximum: ${totalAbilityUses}` };
  }

  // Validate total kills: gun kills + ability kills should match sum of roundKills
  const sumRoundKills = submission.roundKills.reduce((a, b) => a + b, 0);
  const calculatedTotalKills = totalKills + totalAbilityKills;

  if (calculatedTotalKills !== sumRoundKills) {
    return {
      valid: false,
      reason: `Kill count mismatch: gun kills (${totalKills}) + ability kills (${totalAbilityKills}) = ${calculatedTotalKills}, but roundKills sum is ${sumRoundKills}`,
    };
  }

  return { valid: true };
}

function getLeaderboardIdForDifficulty(difficulty: string): string {
  const leaderboardMap: { [key: string]: string } = {
    easy: Constants.LEADERBOARD_DEMO_EASY_ID,
    medium: Constants.LEADERBOARD_DEMO_MEDIUM_ID,
    hard: Constants.LEADERBOARD_DEMO_HARD_ID,
    veryHard: Constants.LEADERBOARD_DEMO_VERY_HARD_ID,
  };
  return leaderboardMap[difficulty];
}

function packStatsToMetadata(
  difficulty: string,
  roundKills: number[],
  gunStats: GunStats[],
  abilityStats: AbilityStats[]
): number[] {
  const details = new Array(64).fill(0);

  // Pack gun stats (slots 0-23: 12 guns × 2 stats)
  const gunOrder = ['pistol', 'shotgun', 'rifle', 'launcher', 'minigun'];
  gunOrder.forEach((gunName, index) => {
    const gun = gunStats.find((g) => g.name === gunName);
    if (gun) {
      details[index * 2] = gun.kills;
      details[index * 2 + 1] = gun.damage;
    }
  });

  // Pack ability stats (slots 24-43: 10 abilities × 2 stats)
  const abilityOrder = ['blast', 'blade', 'barrier', 'combustion', 'jump', 'warp'];
  abilityOrder.forEach((abilityName, index) => {
    const ability = abilityStats.find((a) => a.name === abilityName);
    if (ability) {
      details[24 + index * 2] = ability.uses;
      details[24 + index * 2 + 1] = ability.utility;
    }
  });

  // Pack summary stats (slots 44-47)
  const totalKills = gunStats.reduce((sum, g) => sum + g.kills, 0);
  const totalDamage = gunStats.reduce((sum, g) => sum + g.damage, 0);
  const totalAbilityUses = abilityStats.reduce((sum, a) => sum + a.uses, 0);
  const totalAbilityUtility = abilityStats.reduce((sum, a) => sum + a.utility, 0);

  details[44] = totalKills;
  details[45] = totalDamage;
  details[46] = totalAbilityUses;
  details[47] = totalAbilityUtility;

  // Pack difficulty (slot 48): 0=easy, 1=medium, 2=hard, 3=veryHard
  const difficultyMap: { [key: string]: number } = {
    easy: 0,
    medium: 1,
    hard: 2,
    veryHard: 3,
  };
  details[48] = difficultyMap[difficulty] ?? 0;

  // Pack roundKills (slots 49-58: 10 rounds)
  for (let i = 0; i < Math.min(roundKills.length, 10); i++) {
    details[49 + i] = roundKills[i];
  }

  // Slots 59-63 remain unused for future expansion
  return details;
}
