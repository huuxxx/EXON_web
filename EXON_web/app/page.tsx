import Link from "next/link";
import Image from "next/image";
import React from "react";
import Particles from "./components/particles";

const navigation = [
  { name: "Steam", href: "https://store.steampowered.com/app/3356980?beta=0" },
  { name: "Discord", href: "https://discord.gg/xGZsuJm5h7" },
  { name: "Blog", href: "https://hux-dev.com/blogs/EXON/" },
];

export default function Home() {
  return (
    <>
      <div className="flex justify-center items-center mt-[-50px]">
        <Image
          src="/EXON_Logo.png"
          alt="EXON Logo"
          width={896}
          height={504}
        />
      </div>

      <div className="flex flex-col items-center">
        <nav className="animate-fade-in bg-gradient-to-tl from-black via-zinc-600/20">
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

        <div className="hidden w-screen h-px animate-glow md:block animate-fade-left bg-gradient-to-r from-zinc-300/0 via-zinc-300/50 to-zinc-300/0" />

        <Particles
          className="absolute inset-0 -z-10 animate-fade-in"
          quantity={100}
        />

        <div className="p-10">
          <Image
            src="/RifleSequence.gif"
            alt="EXON Gameplay"
            width={320}
            height={180}
          />
        </div>

        <div className="hidden w-screen h-px animate-glow md:block animate-fade-right bg-gradient-to-r from-zinc-300/0 via-zinc-300/50 to-zinc-300/0" />

        <div className="text-center animate-fade-in">
          <h2 className="text-sm text-zinc-500 whitespace-pre-line">
            <p>
              Blast your way through hordes of demonic forces in an exotic universe with an arsenal of powerful weapons and abilities.
            </p>
            <br />
            <p>
            Demo available now on Steam!
            </p>
          </h2>
        </div>
      </div>
    </>
  );
}
