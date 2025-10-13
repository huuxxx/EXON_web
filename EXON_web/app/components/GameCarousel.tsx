"use client";

import useEmblaCarousel from "embla-carousel-react";
import Image from "next/image";
import { useCallback } from "react";

const carouselImages = [
  "/RifleSequence.gif",
  "/biomeHell.png",
  "/biomeJungle.png",
  "/biomeDesert.png",
  "/biomeCastle.png"
];

export default function GameCarousel() {
  const [emblaRef, emblaApi] = useEmblaCarousel({ loop: true });

  const scrollPrev = useCallback(() => emblaApi?.scrollPrev(), [emblaApi]);
  const scrollNext = useCallback(() => emblaApi?.scrollNext(), [emblaApi]);

  return (
    <div className="max-w-5xl w-full px-4">
      <div className="overflow-hidden rounded-2xl" ref={emblaRef}>
        <div className="flex">
          {carouselImages.map((src, i) => (
            <div
              key={i}
              className="flex-[0_0_60%] relative aspect-[16/9] bg-zinc-900"
            >
              <Image
                src={src}
                alt={`Screenshot ${i + 1}`}
                fill
                className="object-cover rounded-2xl"
                priority={i === 0}
              />
            </div>
          ))}
        </div>
      </div>

      <div className="flex justify-center gap-4 mt-4">
        <button
          onClick={scrollPrev}
          className="bg-zinc-800 text-white px-3 py-1 rounded hover:bg-zinc-700"
        >
          ‹
        </button>
        <button
          onClick={scrollNext}
          className="bg-zinc-800 text-white px-3 py-1 rounded hover:bg-zinc-700"
        >
          ›
        </button>
      </div>
    </div>
  );
}
