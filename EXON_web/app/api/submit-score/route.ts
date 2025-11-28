import { NextResponse } from 'next/server';
import { Constants } from '@/util/constants';

export async function POST(req: Request) {
  try {
    const { steamId, score } = await req.json();

    if (!steamId || score == null) {
      return NextResponse.json({ error: 'Missing parameters' }, { status: 400 });
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
