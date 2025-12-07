'use client';

import { useState } from 'react';
import { LeaderboardEntry, formatMillisecondsAsTime } from '@/util/steam';

interface LeaderboardTableProps {
  data: {
    easy: LeaderboardEntry[];
    medium: LeaderboardEntry[];
    hard: LeaderboardEntry[];
    veryHard: LeaderboardEntry[];
  };
}

const difficulties = ['Easy', 'Medium', 'Hard', 'Very Hard'] as const;
const difficultyKeys = ['easy', 'medium', 'hard', 'veryHard'] as const;

export default function LeaderboardTable({ data }: LeaderboardTableProps) {
  const [currentDifficultyIndex, setCurrentDifficultyIndex] = useState(3); // Start with Very Hard

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

        <h2 className="text-lg font-bold text-zinc-100">{difficulties[currentDifficultyIndex]}</h2>

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
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-700">
              <th className="text-left py-1.5 px-2 text-zinc-400 font-medium">Rank</th>
              <th className="text-left py-1.5 px-2 text-zinc-400 font-medium">Player</th>
              <th className="text-right py-1.5 px-2 text-zinc-400 font-medium">Score</th>
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
