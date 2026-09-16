'use client';

import Image from 'next/image';
import { CSSProperties, useEffect, useRef, useState } from 'react';

const MIN_INTERVAL = 5000;
const MAX_INTERVAL = 7000;
const MIN_DURATION = 150;
const MAX_DURATION = 250;

function randomBetween(min: number, max: number) {
  return Math.random() * (max - min) + min;
}

export default function LogoGlitch() {
  const [isGlitching, setIsGlitching] = useState(false);
  const [glitchDuration, setGlitchDuration] = useState(MAX_DURATION);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    const scheduleGlitch = () => {
      timeoutRef.current = setTimeout(
        () => {
          const duration = randomBetween(MIN_DURATION, MAX_DURATION);
          setGlitchDuration(duration);
          setIsGlitching(true);
          timeoutRef.current = setTimeout(() => {
            setIsGlitching(false);
            scheduleGlitch();
          }, duration);
        },
        randomBetween(MIN_INTERVAL, MAX_INTERVAL)
      );
    };

    scheduleGlitch();

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  return (
    <div
      className={`animate-hue-rotate${isGlitching ? ' animate-logo-glitch' : ''}`}
      style={{ '--logo-glitch-duration': `${glitchDuration}ms` } as CSSProperties}
    >
      <Image
        src="/EXON_Logo.png"
        alt="EXON Logo"
        width={896}
        height={504}
        className="rounded-lg max-w-full h-auto"
      />
    </div>
  );
}
