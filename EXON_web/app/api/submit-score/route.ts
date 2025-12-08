import { NextResponse } from 'next/server';
import { Constants } from '@/util/constants';
import { Redis } from '@upstash/redis';
import { isSteamIdBanned, banSteamId, logRequest } from '@/util/db';
import { verifyToken } from '@/app/api/auth/get-token/route';
import { checkRateLimit, validateSteamTicket } from '@/util/auth';

interface GunStats {
  name: string; // pistol, shotgun, rifle, launcher, minigun, RESERVED1, RESERVED2, RESERVED3
  kills: number;
  damage: number;
  acquisitions: number; // packed by client
}

interface AbilityStats {
  name: string; // blast, blade, barrier, combustion, RESERVED1
  kills: number;
  uses: number;
  utility: number; // nanite, healing, absorbed, kills
  damage: number;
  acquisitions: number; // packed by client
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
  warpAcquisitions: number; // packed by client
  jumpAcquisitions: number; // packed by client
  miscellaneousAcquisitions: number; // packed by client
  token: string; // JWT token from /api/auth/get-token
}

interface SubmitScoreResult {
  Success: boolean;
  ScoreChanged: boolean;
  PreviousRank: number;
  NewRank: number;
  Banned: boolean;
}

const RATE_LIMIT_WINDOW_SEC = 600; // 10 minutes
const MAX_SUBMISSIONS_PER_WINDOW = 3; // 3 full completions per 10 minutes
const redis = Redis.fromEnv();

// Validation constants
const MIN_TOTAL_DAMAGE = 100000;
const MAX_TOTAL_DAMAGE = 200000;
const MAX_TOTAL_KILLS = 255 + 10; // Sum of ROUND_SPAWN_DATA[0] +10 extra for potential counting discrepancies
const MAX_ABILITY_USES = 150;
const MAX_UTILITY_STAT = 50000;
const EXPECTED_ROUND_COUNT = 10;
const EXPECTED_GUN_COUNT = 8; // Including 3 reserved slots
const EXPECTED_ABILITY_COUNT = 5; // blast, blade, barrier, combustion, RESERVED1 (jump/warp/misc in acquisitions)
const SPAWN_DURATION_MS = 2300; // Time for enemy to fully spawn
const LEVEL_NAME = 'demo'; // Current level name

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
  const ipAddress = forwarded ? forwarded.split(',')[0].trim() : 'unknown';
  let steamId: string | undefined;
  let score: number | undefined;
  let success = false;

  try {
    const body: StatsSubmission = await req.json();
    steamId = body.steamId;
    score = body.finalScore;
    const ticket = body.ticket;

    const jsonBody = JSON.stringify(body);
    console.log(`submit-score received: ${jsonBody}`);

    // 1. Rate limit check - IP and Steam ID
    const ipLimiterKey = `ip:${ipAddress}`;
    const steamLimiterKey = `steam:${steamId}`;

    const ipRateLimited = await checkRateLimit(
      ipLimiterKey,
      RATE_LIMIT_WINDOW_SEC,
      MAX_SUBMISSIONS_PER_WINDOW
    );
    if (ipRateLimited.limited) {
      console.log(`🚫 Rate limited (IP): ${ipAddress} | Steam ID: ${steamId || 'unknown'}`);
      console.log(`Details: Rate limited, retryAfter: ${ipRateLimited.retryAfter}`);
      await logRequest({
        ipAddress: ipAddress,
        steamId,
        levelName: LEVEL_NAME,
        difficulty: body.difficulty,
        score,
        rateLimited: true,
        success: false,
        requestResult: 'Rate limited (IP)',
      }).catch(() => {});
      const response: SubmitScoreResult = {
        Success: false,
        ScoreChanged: false,
        PreviousRank: 0,
        NewRank: 0,
        Banned: false,
      };
      return NextResponse.json(response, { status: 429 });
    }

    const steamRateLimited = await checkRateLimit(
      steamLimiterKey,
      RATE_LIMIT_WINDOW_SEC,
      MAX_SUBMISSIONS_PER_WINDOW
    );
    if (steamRateLimited.limited) {
      console.log(`🚫 Rate limited (Steam ID): ${steamId} | IP: ${ipAddress}`);
      console.log(`Details: Rate limited, retryAfter: ${steamRateLimited.retryAfter}`);
      await logRequest({
        ipAddress: ipAddress,
        steamId,
        levelName: LEVEL_NAME,
        difficulty: body.difficulty,
        score,
        rateLimited: true,
        success: false,
        requestResult: 'Rate limited (Steam ID)',
      }).catch(() => {});
      const response: SubmitScoreResult = {
        Success: false,
        ScoreChanged: false,
        PreviousRank: 0,
        NewRank: 0,
        Banned: false,
      };
      return NextResponse.json(response, { status: 429 });
    }

    // 2. Essential validation (auto-ban - legitimate client always sends these)
    if (!steamId || !ticket) {
      console.log(
        `🚫 AUTO-BAN: Missing required fields | Steam ID: ${steamId || 'unknown'} | IP: ${ipAddress}`
      );
      console.log('Details: Missing required fields - steamId and ticket are required');
      if (steamId) {
        await banSteamId(steamId, ipAddress, 'Missing required fields (tampered client)');
      }
      await logRequest({
        ipAddress: ipAddress,
        steamId,
        levelName: LEVEL_NAME,
        difficulty: body.difficulty,
        score,
        rateLimited: false,
        success: false,
        requestResult: 'Missing steamId or ticket - AUTO BAN',
      }).catch(() => {});
      const response: SubmitScoreResult = {
        Success: false,
        ScoreChanged: false,
        PreviousRank: 0,
        NewRank: 0,
        Banned: true,
      };
      return NextResponse.json(response, { status: 400 });
    }

    // 3. Steam ticket validation
    const ticketValidation = await validateSteamTicket(steamId, ticket);
    if (!ticketValidation.valid) {
      console.log(
        `🚫 Invalid Steam ticket: ${steamId} | IP: ${ipAddress} | Reason: ${ticketValidation.reason}`
      );
      console.log(`Details: Steam ticket validation failed - ${ticketValidation.reason}`);
      await logRequest({
        ipAddress: ipAddress,
        steamId,
        levelName: LEVEL_NAME,
        difficulty: body.difficulty,
        score,
        rateLimited: false,
        success: false,
        requestResult: ticketValidation.reason || 'Invalid ticket',
      }).catch(() => {});
      const response: SubmitScoreResult = {
        Success: false,
        ScoreChanged: false,
        PreviousRank: 0,
        NewRank: 0,
        Banned: false,
      };
      return NextResponse.json(response, { status: 403 });
    }

    // 4. DB ban check
    const banned = await isSteamIdBanned(steamId);
    if (banned) {
      console.log(`🚫 Banned user attempted access: ${steamId} | IP: ${ipAddress}`);
      console.log('Details: Steam ID is banned');
      await logRequest({
        ipAddress: ipAddress,
        steamId,
        levelName: LEVEL_NAME,
        difficulty: body.difficulty,
        score,
        rateLimited: false,
        success: false,
        requestResult: 'Banned Steam ID',
      }).catch(() => {});
      const response: SubmitScoreResult = {
        Success: false,
        ScoreChanged: false,
        PreviousRank: 0,
        NewRank: 0,
        Banned: true,
      };
      return NextResponse.json(response, { status: 403 });
    }

    // 5. Validate all data fields (auto-ban - legitimate client always sends complete data)
    if (
      score == null ||
      !body.difficulty ||
      !body.roundTimes ||
      !body.roundKills ||
      !body.gunStats ||
      !body.abilityStats ||
      !body.token
    ) {
      console.log(`🚫 AUTO-BAN: Missing data fields | Steam ID: ${steamId} | IP: ${ipAddress}`);
      console.log(
        'Details: Missing parameters - Required: finalScore, difficulty, roundTimes, roundKills, gunStats, abilityStats, token'
      );
      await banSteamId(steamId, ipAddress, 'Missing data fields (tampered client)');
      await logRequest({
        ipAddress: ipAddress,
        steamId,
        levelName: LEVEL_NAME,
        difficulty: body.difficulty,
        score,
        rateLimited: false,
        success: false,
        requestResult: 'Missing parameters - AUTO BAN',
      }).catch(() => {});
      const response: SubmitScoreResult = {
        Success: false,
        ScoreChanged: false,
        PreviousRank: 0,
        NewRank: 0,
        Banned: true,
      };
      return NextResponse.json(response, { status: 400 });
    }

    // 6. Verify JWT token (auto-ban - legitimate client always sends valid token)
    const tokenValidation = verifyToken(body.token);
    if (!tokenValidation.valid) {
      console.log(
        `🚫 AUTO-BAN: Invalid token | Steam ID: ${steamId} | IP: ${ipAddress} | Reason: ${tokenValidation.reason}`
      );
      console.log(`Details: Token validation failed - ${tokenValidation.reason}`);
      await banSteamId(steamId, ipAddress, 'Invalid JWT token (tampered client)');
      await logRequest({
        ipAddress: ipAddress,
        steamId,
        levelName: LEVEL_NAME,
        difficulty: body.difficulty,
        score,
        rateLimited: false,
        success: false,
        requestResult: tokenValidation.reason || 'Invalid token - AUTO BAN',
      }).catch(() => {});
      const response: SubmitScoreResult = {
        Success: false,
        ScoreChanged: false,
        PreviousRank: 0,
        NewRank: 0,
        Banned: true,
      };
      return NextResponse.json(response, { status: 403 });
    }

    // 6b. Verify token steamId matches submission steamId (auto-ban)
    if (tokenValidation.payload?.steamId !== steamId) {
      console.log(
        `🚫 AUTO-BAN: Token/Steam ID mismatch | Token: ${tokenValidation.payload?.steamId} | Submission: ${steamId} | IP: ${ipAddress}`
      );
      console.log('Details: Token validation failed - Steam ID mismatch');
      await banSteamId(steamId, ipAddress, 'Token Steam ID mismatch (tampered client)');
      await logRequest({
        ipAddress: ipAddress,
        steamId,
        levelName: LEVEL_NAME,
        difficulty: body.difficulty,
        score,
        rateLimited: false,
        success: false,
        requestResult: 'Token Steam ID mismatch - AUTO BAN',
      }).catch(() => {});
      const response: SubmitScoreResult = {
        Success: false,
        ScoreChanged: false,
        PreviousRank: 0,
        NewRank: 0,
        Banned: true,
      };
      return NextResponse.json(response, { status: 403 });
    }

    // 6c. Check token nonce hasn't been used (prevent replay attacks)
    const nonce = tokenValidation.payload!.nonce;
    const nonceKey = `token:nonce:${nonce}`;
    const nonceExists = await redis.exists(nonceKey);

    if (nonceExists) {
      console.log(
        `🚫 AUTO-BAN: Token replay attempt | Steam ID: ${steamId} | IP: ${ipAddress} | Nonce: ${nonce}`
      );
      console.log('Details: Token validation failed - Token already used');
      await banSteamId(steamId, ipAddress, 'Token replay attack (tampered client)');
      await logRequest({
        ipAddress: ipAddress,
        steamId,
        levelName: LEVEL_NAME,
        difficulty: body.difficulty,
        score,
        rateLimited: false,
        success: false,
        requestResult: 'Token replay - AUTO BAN',
      }).catch(() => {});
      const response: SubmitScoreResult = {
        Success: false,
        ScoreChanged: false,
        PreviousRank: 0,
        NewRank: 0,
        Banned: true,
      };
      return NextResponse.json(response, { status: 403 });
    }

    // Mark token nonce as used (store until token expiry + buffer)
    const tokenTTL = tokenValidation.payload!.exp - Math.floor(Date.now() / 1000) + 60; // +60s buffer
    await redis.setex(nonceKey, tokenTTL, '1');

    // 7. Validate stats ranges and consistency
    const statsValidation = validateStats(body);
    if (!statsValidation.valid) {
      console.log(
        `🚫 Invalid stats: ${steamId} | IP: ${ipAddress} | Reason: ${statsValidation.reason}`
      );
      console.log(`Details: Stats validation failed - ${statsValidation.reason}`);
      await logRequest({
        ipAddress: ipAddress,
        steamId,
        levelName: LEVEL_NAME,
        difficulty: body.difficulty,
        score,
        rateLimited: false,
        success: false,
        requestResult: statsValidation.reason || 'Invalid stats',
      }).catch(() => {});
      const response: SubmitScoreResult = {
        Success: false,
        ScoreChanged: false,
        PreviousRank: 0,
        NewRank: 0,
        Banned: false,
      };
      return NextResponse.json(response, { status: 403 });
    }

    // Pack stats into Steam metadata array
    const details = packStatsToMetadata(body.gunStats, body.abilityStats);

    // Add acquisition flags (indices 49-51)
    details[49] = body.jumpAcquisitions;
    details[50] = body.warpAcquisitions;
    details[51] = body.miscellaneousAcquisitions;
    // Indices 52-53 are reserved

    // Add round timers (indices 54-63)
    body.roundTimes.forEach((time, index) => {
      details[54 + index] = time;
    });

    console.log(`📊 Details array length: ${details.length}`);
    const leaderboardId = getLeaderboardIdForDifficulty(body.difficulty);

    const params = new URLSearchParams({
      key: process.env[Constants.STEAM_WEB_API_KEY]!,
      appid: process.env[Constants.APP_ID_DEMO]!,
      leaderboardid: process.env[leaderboardId]!,
      steamid: steamId,
      score: score.toString(),
      scoremethod: Constants.STEAM_API_SCORE_METHOD_KEEP_BEST,
      details: details.join(','),
    });

    console.log(`📊 Details param being sent to Steam: ${params.get('details')}`);

    const mockMode = process.env[Constants.MOCK_STEAM_API] === 'true';
    let json: any = null;
    let raw: string = '';
    const steamUrl = `https://partner.steam-api.com/ISteamLeaderboards/SetLeaderboardScore/v1/`;

    const submitToSteam = async (params: URLSearchParams) => {
      const steamRes = await fetch(steamUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        },
        body: params.toString(),
      });
      const rawResponse = await steamRes.text();
      return {
        json: JSON.parse(rawResponse),
        raw: rawResponse,
        success: steamRes.ok,
      };
    };

    if (mockMode) {
      console.log(`🧪 MOCK MODE: Simulating Steam API call for ${steamId}`);
      json = generateMockSteamResponse(steamId, score, true);
      success = true;
    } else {
      const result = await submitToSteam(params);
      json = result.json;
      raw = result.raw;
      success = result.success;

      // Failsafe: If Steam returns result code 8 (invalid parameter), retry without details
      if (json?.result?.result === 8) {
        console.log(`🔄 Retrying submission without details field due to result code 8`);

        const paramsWithoutDetails = new URLSearchParams({
          key: process.env[Constants.STEAM_WEB_API_KEY]!,
          appid: process.env[Constants.APP_ID_DEMO]!,
          leaderboardid: process.env[leaderboardId]!,
          steamid: steamId,
          score: score.toString(),
          scoremethod: Constants.STEAM_API_SCORE_METHOD_KEEP_BEST,
        });

        const retryResult = await submitToSteam(paramsWithoutDetails);
        json = retryResult.json;
        raw = retryResult.raw;
        success = retryResult.success;

        console.log('🔄 Retry response: ', json ?? raw);
      }
    }

    if (success) {
      console.log(
        `✅ Successful submission: ${steamId} | IP: ${ipAddress} | Difficulty: ${body.difficulty} | Score: ${score}ms`
      );
    } else {
      console.log(`❌ Steam API error: ${steamId} | IP: ${ipAddress}`);
    }
    console.log('submit-score Steam response: ', json ?? raw);

    await logRequest({
      ipAddress: ipAddress,
      steamId,
      levelName: LEVEL_NAME,
      difficulty: body.difficulty,
      score,
      rateLimited: false,
      success: success,
      requestResult: success ? 'Success' : 'Steam API error',
    }).catch(() => {});

    const leaderboardEntry = json?.result;
    const response: SubmitScoreResult = {
      Success: success,
      ScoreChanged: leaderboardEntry?.score_changed || false,
      PreviousRank: leaderboardEntry?.global_rank_previous || 0,
      NewRank: leaderboardEntry?.global_rank_new || 0,
      Banned: false,
    };

    return NextResponse.json(response, { status: 200 });
  } catch (err: any) {
    console.log(
      `❌ Parse error: ${steamId || 'unknown'} | IP: ${ipAddress} | Error: ${err.message}`
    );
    console.log(`Details: Parse error - ${err.message}`);
    await logRequest({
      ipAddress: ipAddress,
      steamId: steamId,
      levelName: LEVEL_NAME,
      difficulty: undefined,
      score: score,
      rateLimited: false,
      success: false,
      requestResult: 'Parse error',
    }).catch(() => {});
    const response: SubmitScoreResult = {
      Success: false,
      ScoreChanged: false,
      PreviousRank: 0,
      NewRank: 0,
      Banned: false,
    };
    return NextResponse.json(response, { status: 400 });
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

    // Validate kills aren't below lowest potential total monsters - mutants (mutants can self-destruct):
    const minimumKills = totalMonsters - mutants;
    if (roundKills < minimumKills) {
      return {
        valid: false,
        reason: `Round ${i + 1} has less kills than minimum possible: ${minimumKills}`,
      };
    }

    // Validate kills don't exceed maximum
    if (roundKills > totalMonsters) {
      return {
        valid: false,
        reason: `Round ${i + 1} kills ${roundKills} exceeds reasonable maximum: ${totalMonsters}`,
      };
    }
  }

  // Verify finalScore matches sum of roundTimes, within 1000ms tolerance
  const sumRoundTimes = submission.roundTimes.reduce((a, b) => a + b, 0);
  if (Math.abs(submission.finalScore - sumRoundTimes) > 1000) {
    return {
      valid: false,
      reason: `finalScore (${submission.finalScore}) doesn't match sum of rounds (${sumRoundTimes})`,
    };
  }

  if (submission.gunStats.length !== EXPECTED_GUN_COUNT) {
    return {
      valid: false,
      reason: `Expected ${EXPECTED_GUN_COUNT} guns, got ${submission.gunStats.length}`,
    };
  }

  let totalGunKills = 0;
  let totalGunDamage = 0;

  for (const gun of submission.gunStats) {
    if (gun.kills < 0 || gun.kills > MAX_TOTAL_KILLS) {
      return { valid: false, reason: `${gun.name} kills out of range: ${gun.kills}` };
    }
    if (gun.damage < 0 || gun.damage > MAX_TOTAL_DAMAGE) {
      return { valid: false, reason: `${gun.name} damage out of range: ${gun.damage}` };
    }
    totalGunKills += gun.kills;
    totalGunDamage += gun.damage;
  }

  if (totalGunKills > MAX_TOTAL_KILLS) {
    return { valid: false, reason: `Total gun kills exceeds maximum: ${totalGunKills}` };
  }

  if (totalGunDamage > MAX_TOTAL_DAMAGE) {
    return { valid: false, reason: `Total damage exceeds maximum: ${totalGunDamage}` };
  }

  if (totalGunDamage < MIN_TOTAL_DAMAGE) {
    return { valid: false, reason: `Total damage below minimum: ${totalGunDamage}` };
  }

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

    totalAbilityUses += ability.uses;
    totalAbilityUtility += ability.utility;
    totalAbilityKills += ability.kills;
  }

  if (totalAbilityUses > MAX_ABILITY_USES) {
    return { valid: false, reason: `Total ability uses exceeds maximum: ${totalAbilityUses}` };
  }

  const totalKillsCombined = totalGunKills + totalAbilityKills;

  if (totalKillsCombined > MAX_TOTAL_KILLS) {
    return {
      valid: false,
      reason: `Kill count suspiciously high: ${totalKillsCombined} exceeds maximum allowed ${MAX_TOTAL_KILLS}`,
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

function packStatsToMetadata(gunStats: GunStats[], abilityStats: AbilityStats[]): number[] {
  const details = new Array(64).fill(0);

  // Pack gun stats: 8 guns × 3 fields = 24 slots (indices 0-23)
  const gunOrder = [
    'pistol',
    'shotgun',
    'rifle',
    'launcher',
    'minigun',
    'reserved1',
    'reserved2',
    'reserved3',
  ];
  gunOrder.forEach((gunName, index) => {
    const gun = gunStats.find((g) => g.name === gunName);
    if (gun) {
      const offset = index * 3;
      details[offset] = gun.kills;
      details[offset + 1] = gun.damage;
      details[offset + 2] = gun.acquisitions;
    }
  });

  // Pack ability stats: 5 abilities × 5 fields = 25 slots (indices 24-48)
  const abilityOrder = ['blast', 'blade', 'barrier', 'combustion', 'reserved1'];
  abilityOrder.forEach((abilityName, index) => {
    const ability = abilityStats.find((a) => a.name === abilityName);
    if (ability) {
      const offset = 24 + index * 5;
      details[offset] = ability.kills;
      details[offset + 1] = ability.uses;
      details[offset + 2] = ability.utility;
      details[offset + 3] = ability.damage;
      details[offset + 4] = ability.acquisitions;
    }
  });
  return details;
}

function generateMockSteamResponse(steamId: string, score: number, isNewBest: boolean) {
  const mockResponse = {
    result: {
      score_changed: isNewBest,
      global_rank_previous: isNewBest
        ? Math.floor(Math.random() * 100) + 50
        : Math.floor(Math.random() * 100) + 10,
      global_rank_new: isNewBest
        ? Math.floor(Math.random() * 50) + 1
        : Math.floor(Math.random() * 100) + 10,
      leaderboard_entry_count: Math.floor(Math.random() * 500) + 100,
    },
  };

  if (!isNewBest) {
    mockResponse.result.global_rank_new = mockResponse.result.global_rank_previous;
  }

  return mockResponse;
}
