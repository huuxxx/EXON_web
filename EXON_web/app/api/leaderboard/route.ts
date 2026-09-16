import { NextResponse } from 'next/server';
import { getTop10ScoresAllDifficulties } from '@/util/steam';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  try {
    const leaderboardData = await getTop10ScoresAllDifficulties();

    return NextResponse.json(leaderboardData, {
      headers: {
        'Cache-Control': 'no-store, max-age=0',
      },
    });
  } catch (error) {
    console.error('Failed to load leaderboard:', error);
    return NextResponse.json({ error: 'Failed to load leaderboard' }, { status: 500 });
  }
}
