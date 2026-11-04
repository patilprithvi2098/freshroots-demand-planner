import type { Metadata } from "next";
import { Sprout } from "lucide-react";

// Shown by the middleware when Supabase does not answer in time (for example a paused free-tier project
// waking up). Static: it must not touch the database itself.
export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Waking up · Freshroots Demand Planning",
};

export default function Unavailable() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      {/* React hoists this into <head>: retry automatically every 20 seconds. */}
      <meta httpEquiv="refresh" content="20; url=/overview" />
      <div className="w-full max-w-sm rounded-2xl border border-neutral-200 bg-white p-7 text-center shadow-sm">
        <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-700 text-white">
          <Sprout aria-hidden className="h-5 w-5" />
        </span>
        <h1 className="mt-4 text-xl font-semibold tracking-tight">The planning database is waking up</h1>
        <p className="mt-2 text-sm text-neutral-700">
          This usually takes under a minute. The page tries again by itself every 20 seconds.
        </p>
        <a
          href="/overview"
          className="mt-5 inline-flex items-center justify-center rounded-lg bg-emerald-700 px-3.5 py-2 text-sm font-medium text-white hover:bg-emerald-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
        >
          Try again
        </a>
      </div>
    </main>
  );
}
