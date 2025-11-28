import { NextResponse } from 'next/server';
import { Constants } from '@/util/constants';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const rangestart = searchParams.get('rangestart');
    const rangeend = searchParams.get('rangeend');

    if (rangestart == null || rangeend == null) {
      return NextResponse.json({ error: 'Missing parameters' }, { status: 400 });
    }

    const url = `https://partner.steam-api.com/ISteamLeaderboards/GetLeaderboardEntries/v1/`;

    const params = new URLSearchParams({
      key: process.env[Constants.STEAM_WEB_API_KEY]!,
      appid: process.env[Constants.APP_ID_DEMO]!,
      leaderboardid: process.env[Constants.LEADERBOARD_TEST_ID]!,
      rangestart,
      rangeend,
      datarequest: Constants.STEAM_API_DATA_REQUEST_GLOBAL,
    });

    const steamRes = await fetch(`${url}?${params.toString()}`);
    const raw = await steamRes.text();
    let json: any = null;
    console.log('get scores: ', json ?? raw);
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

