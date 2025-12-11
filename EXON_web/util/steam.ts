import { Constants } from './constants';

export interface LeaderboardEntry {
  rank: number;
  steamName: string;
  score: number;
}

/**
 * Format milliseconds as MM:SS.CS (minutes:seconds.centiseconds)
 */
export function formatMillisecondsAsTime(milliseconds: number): string {
  const totalSeconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const centiseconds = Math.floor((milliseconds % 1000) / 10);

  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${centiseconds.toString().padStart(2, '0')}`;
}

/**
 * Generate fake leaderboard entries to fill up to 10 entries
 */
function generateFakeEntries(
  existingEntries: LeaderboardEntry[],
  baseScore: number
): LeaderboardEntry[] {
  const useFakeData = process.env.USE_FAKE_LEADERBOARD_DATA === 'true';

  if (!useFakeData || existingEntries.length >= 10) {
    return existingEntries;
  }

  const fakeNames = [
    'SpeedRunner123',
    'ProGamer2024',
    'NinjaKiller',
    'EXONMaster',
    'QuickFingers',
    'TimeAttacker',
    'RushPlayer',
    'FastLegend',
    'SpeedDemon',
    'BlitzKrieg',
  ];

  const entries = [...existingEntries];
  const startRank =
    existingEntries.length > 0 ? existingEntries[existingEntries.length - 1].rank + 1 : 1;

  for (let i = entries.length; i < 10; i++) {
    const randomVariation = Math.floor(Math.random() * 30000) + i * 5000;
    entries.push({
      rank: startRank + (i - existingEntries.length),
      steamName: fakeNames[i % fakeNames.length] + (i > 9 ? `_${i}` : ''),
      score: baseScore + randomVariation,
    });
  }

  return entries;
}

/**
 * Fetch Steam usernames for a list of Steam IDs
 */
async function getSteamUsernames(steamIds: string[], apiKey: string): Promise<Map<string, string>> {
  if (steamIds.length === 0) return new Map();

  const url = 'https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/';
  const params = new URLSearchParams({
    key: apiKey,
    steamids: steamIds.join(','),
  });

  try {
    const response = await fetch(`${url}?${params.toString()}`);
    if (!response.ok) {
      console.error(`Failed to fetch Steam usernames: ${response.status}`);
      return new Map();
    }
    const data = await response.json();

    const userMap = new Map<string, string>();
    if (data?.response?.players) {
      for (const player of data.response.players) {
        userMap.set(player.steamid, player.personaname || player.steamid);
      }
    }
    return userMap;
  } catch (error) {
    console.error('Error fetching Steam usernames:', error);
    return new Map();
  }
}

export async function getTop10ScoresAllDifficulties(): Promise<{
  easy: LeaderboardEntry[];
  medium: LeaderboardEntry[];
  hard: LeaderboardEntry[];
  veryHard: LeaderboardEntry[];
}> {
  const apiKey = process.env[Constants.STEAM_WEB_API_KEY];
  const appId = process.env[Constants.APP_ID_DEMO];

  const leaderboardIds = {
    easy: process.env[Constants.LEADERBOARD_DEMO_EASY_ID],
    medium: process.env[Constants.LEADERBOARD_DEMO_MEDIUM_ID],
    hard: process.env[Constants.LEADERBOARD_DEMO_HARD_ID],
    veryHard: process.env[Constants.LEADERBOARD_DEMO_VERY_HARD_ID],
  };

  if (!apiKey || !appId) {
    throw new Error('Missing Steam API credentials');
  }

  const fetchLeaderboard = async (
    leaderboardId: string | undefined
  ): Promise<LeaderboardEntry[]> => {
    if (!leaderboardId) {
      return [];
    }

    const url = 'https://partner.steam-api.com/ISteamLeaderboards/GetLeaderboardEntries/v1/';
    const params = new URLSearchParams({
      key: apiKey!,
      appid: appId!,
      leaderboardid: leaderboardId,
      rangestart: '1',
      rangeend: '10',
      datarequest: Constants.STEAM_API_DATA_REQUEST_GLOBAL,
    });

    try {
      const response = await fetch(`${url}?${params.toString()}`);
      if (!response.ok) {
        console.error(`Failed to fetch leaderboard ${leaderboardId}: ${response.status}`);
        return [];
      }
      const data = await response.json();

      // Check different possible response structures
      let entries = null;
      if (data?.leaderboardEntryInformation?.leaderboardEntries) {
        entries = data.leaderboardEntryInformation.leaderboardEntries;
      } else if (data?.leaderboardEntries?.entries) {
        entries = data.leaderboardEntries.entries;
      } else if (data?.response?.leaderboardEntries) {
        entries = data.response.leaderboardEntries;
      } else if (data?.entries) {
        entries = data.entries;
      } else if (Array.isArray(data)) {
        entries = data;
      }

      if (entries && Array.isArray(entries)) {
        return entries.map((entry: any) => ({
          rank: entry.rank || entry.globalRank || 0,
          steamName: entry.steamID || entry.steamIDUser || entry.steamId || entry.name || 'Unknown',
          score: entry.score || 0,
        }));
      }

      console.log('No entries found in response');
      return [];
    } catch (error) {
      console.error(`Error fetching leaderboard ${leaderboardId}:`, error);
      return [];
    }
  };

  const [easy, medium, hard, veryHard] = await Promise.all([
    fetchLeaderboard(leaderboardIds.easy),
    fetchLeaderboard(leaderboardIds.medium),
    fetchLeaderboard(leaderboardIds.hard),
    fetchLeaderboard(leaderboardIds.veryHard),
  ]);

  // Collect all unique Steam IDs
  const allSteamIds = new Set<string>();
  [...easy, ...medium, ...hard, ...veryHard].forEach((entry) => {
    if (entry.steamName && entry.steamName !== 'Unknown') {
      allSteamIds.add(entry.steamName);
    }
  });

  // Fetch usernames for all Steam IDs
  const usernameMap = await getSteamUsernames(Array.from(allSteamIds), apiKey);

  // Replace Steam IDs with usernames
  const mapNames = (entries: LeaderboardEntry[]) =>
    entries.map((entry) => ({
      ...entry,
      steamName: usernameMap.get(entry.steamName) || entry.steamName,
    }));

  // Apply fake data padding if enabled
  const easyWithFake = generateFakeEntries(mapNames(easy), 180000);
  const mediumWithFake = generateFakeEntries(mapNames(medium), 240000);
  const hardWithFake = generateFakeEntries(mapNames(hard), 300000);
  const veryHardWithFake = generateFakeEntries(mapNames(veryHard), 360000);

  return {
    easy: easyWithFake,
    medium: mediumWithFake,
    hard: hardWithFake,
    veryHard: veryHardWithFake,
  };
}
