import type { Metadata } from "next";
import Link from "next/link";
import { Press_Start_2P, VT323 } from "next/font/google";
import { getSession } from "@/lib/session";
import "./globals.css";

const press = Press_Start_2P({ weight: "400", subsets: ["latin"], variable: "--font-press" });
const vt = VT323({ weight: "400", subsets: ["latin"], variable: "--font-vt" });

export const metadata: Metadata = {
  title: "Commute Pain Tracker",
  description: "Real Hyderabad commute times, logged every 30 min. Find out when NOT to leave office.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const me = await getSession();
  return (
    <html lang="en" className={`${press.variable} ${vt.variable}`}>
      <body className="min-h-dvh flex flex-col">
        <header className="sticky top-0 z-10 border-b-[3px] border-ink bg-butter">
          <nav className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
            <Link href="/leave" className="font-pixel text-[11px] leading-tight sm:text-sm">
              🛺 COMMUTE<br className="sm:hidden" /> PAIN
            </Link>
            <span className="ml-auto flex flex-wrap justify-end gap-2">
              <Link href="/leave" className="chip press bg-mint">LEAVE NOW?</Link>
              <Link href="/leaderboard" className="chip press bg-pink">LEADERBOARD</Link>
              <Link href={me ? "/me" : "/"} className="chip press bg-sky">{me ? `@${me.name}` : "PRESS START"}</Link>
            </span>
          </nav>
        </header>
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">{children}</main>
        <footer className="mx-auto max-w-5xl px-4 pb-8 text-center text-mute">
          <span className="blink font-pixel text-[10px]">INSERT COIN</span> · made with 🫠 in Hyderabad traffic · data via TomTom
        </footer>
      </body>
    </html>
  );
}
