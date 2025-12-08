import Link from 'next/link';
import Image from 'next/image';
import React from 'react';
import Particles from './components/particles';
import GameCarousel from './components/GameCarousel';
import { getTop10ScoresAllDifficulties } from '@/util/steam';
import LeaderboardTable from './components/LeaderboardTable';

const navigation = [
  { name: 'Steam', href: 'https://store.steampowered.com/app/3356980?beta=0' },
  { name: 'Discord', href: 'https://discord.gg/xGZsuJm5h7' },
  { name: 'Blog', href: 'https://hux-dev.com/blogs/EXON/' },
];

// Force dynamic rendering - fetch fresh data on every request
export const dynamic = 'force-dynamic';

export default async function Home() {
  const leaderboardData = await getTop10ScoresAllDifficulties();

  return (
    <>
      <div className="container mx-auto px-4 overflow-x-hidden -mt-12">
        {/* Large screen: Logo centered with leaderboard absolutely positioned */}
        <div className="relative flex justify-center items-center mb-2">
          <div className="animate-hue-rotate">
            <Image
              src="/EXON_Logo.png"
              alt="EXON Logo"
              width={896}
              height={504}
              className="rounded-lg max-w-full h-auto"
            />
          </div>
          {/* Leaderboard absolutely positioned to the right on extra large screens */}
          <div className="hidden xl:block absolute right-0 top-16">
            <LeaderboardTable data={leaderboardData} />
          </div>
        </div>

        <div className="flex flex-col items-center">
          <nav className="animate-fade-in bg-gradient-to-tl from-black via-zinc-600/20 mb-3">
            <ul className="flex items-center justify-center gap-8">
              {navigation.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="text-sm duration-500 text-zinc-500 hover:text-zinc-300"
                >
                  {item.name}
                </Link>
              ))}
            </ul>
          </nav>

          <GameCarousel />

          <div className="hidden w-screen h-px animate-glow md:block animate-fade-left bg-gradient-to-r from-zinc-300/0 via-zinc-300/50 to-zinc-300/0" />

          <Particles className="absolute inset-0 -z-10 animate-fade-in" quantity={100} />

          <div className="hidden w-screen h-px animate-glow md:block animate-fade-right bg-gradient-to-r from-zinc-300/0 via-zinc-300/50 to-zinc-300/0" />

          <div className="text-center animate-fade-in mt-5 mb-8">
            <h2 className="text-sm text-zinc-500 whitespace-pre-line">
              <p>
                Adventure through the far reaches of a foreign universe, discover ancient artifacts
                of unimaginable power, shatter demonic forces with brutal weapons and devastating
                abilities.
              </p>
            </h2>
          </div>

          {/* Large and below: Leaderboard below everything */}
          <div className="xl:hidden w-full max-w-md mx-auto">
            <LeaderboardTable data={leaderboardData} />
          </div>
        </div>
      </div>
    </>
  );
}
