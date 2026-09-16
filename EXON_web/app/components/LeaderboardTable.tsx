'use client';

import { useEffect, useState } from 'react';
import { LeaderboardEntry, formatMillisecondsAsTime } from '@/util/steam';

type LeaderboardData = Record<(typeof difficultyKeys)[number], LeaderboardEntry[]>;

const emptyLeaderboardData: LeaderboardData = {
  easy: [],
  medium: [],
  hard: [],
  veryHard: [],
};

let leaderboardDataPromise: Promise<LeaderboardData> | null = null;

function fetchLeaderboardData() {
  if (!leaderboardDataPromise) {
    leaderboardDataPromise = fetch('/api/leaderboard', { cache: 'no-store' })
      .then((response) => {
        if (!response.ok) throw new Error(`Leaderboard request failed: ${response.status}`);
        return response.json() as Promise<LeaderboardData>;
      })
      .catch((error) => {
        leaderboardDataPromise = null;
        throw error;
      });
  }

  return leaderboardDataPromise;
}

const difficulties = ['Easy', 'Medium', 'Hard', 'Very Hard'] as const;
const difficultyKeys = ['easy', 'medium', 'hard', 'veryHard'] as const;

export default function LeaderboardTable() {
  const [data, setData] = useState<LeaderboardData>(emptyLeaderboardData);
  const [isLoading, setIsLoading] = useState(true);
  const [currentDifficultyIndex, setCurrentDifficultyIndex] = useState(3); // Start with Very Hard

  useEffect(() => {
    let cancelled = false;

    fetchLeaderboardData()
      .then((leaderboard) => {
        if (!cancelled) setData(leaderboard);
      })
      .catch((error) => {
        console.error('Failed to load leaderboard:', error);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const currentDifficulty = difficultyKeys[currentDifficultyIndex];
  const currentEntries = data[currentDifficulty];

  // Pad entries to always show 10 rows
  const displayEntries = Array.from({ length: 10 }, (_, index) => {
    if (index < currentEntries.length) {
      return currentEntries[index];
    }
    return null;
  });

  const goToPrevious = () => {
    setCurrentDifficultyIndex((prev) => (prev === 0 ? difficulties.length - 1 : prev - 1));
  };

  const goToNext = () => {
    setCurrentDifficultyIndex((prev) => (prev === difficulties.length - 1 ? 0 : prev + 1));
  };

  return (
    <div className="bg-zinc-900/50 backdrop-blur-sm rounded-lg p-3 sm:p-4 border border-zinc-800 w-full xl:w-[300px] max-w-[600px] xl:max-w-[300px] mx-auto">
      <h1 className="text-center text-sm font-bold text-zinc-100 mb-2 whitespace-nowrap">
        Gauntlet Mode Leaderboard
      </h1>

      <div className="flex items-center justify-between mb-2">
        <button
          onClick={goToPrevious}
          className="text-zinc-400 hover:text-zinc-200 transition-colors p-1"
          aria-label="Previous difficulty"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 19l-7-7 7-7"
            />
          </svg>
        </button>

        <h2 className="w-20 text-center text-lg font-bold text-zinc-100 whitespace-nowrap">
          {isLoading ? '...loading' : difficulties[currentDifficultyIndex]}
        </h2>

        <button
          onClick={goToNext}
          className="text-zinc-400 hover:text-zinc-200 transition-colors p-1"
          aria-label="Next difficulty"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full table-fixed text-sm">
          <thead>
            <tr className="border-b border-zinc-700">
              <th className="w-12 text-left py-1.5 px-2 text-zinc-400 font-medium">Rank</th>
              <th className="text-left py-1.5 px-2 text-zinc-400 font-medium">Player</th>
              <th className="w-24 text-right py-1.5 px-2 text-zinc-400 font-medium">Score</th>
            </tr>
          </thead>
          <tbody>
            {displayEntries.map((entry, index) => (
              <tr
                key={index}
                className="border-b border-zinc-800 hover:bg-zinc-800/30 transition-colors"
              >
                <td className="py-1.5 px-2 text-zinc-300">{index + 1}</td>
                <td
                  className="py-1.5 px-2 text-zinc-300 truncate max-w-[120px] xl:max-w-[120px] sm:max-w-[300px]"
                  title={entry?.steamName}
                >
                  {entry ? entry.steamName : '--'}
                </td>
                <td className="py-1.5 px-2 text-zinc-300 text-right font-mono">
                  {entry ? formatMillisecondsAsTime(entry.score) : '--:--.--'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
