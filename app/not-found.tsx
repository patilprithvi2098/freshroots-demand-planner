import Link from "next/link";
import { Sprout } from "lucide-react";

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-2xl border border-neutral-200 bg-white p-7 text-center shadow-sm">
        <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-700 text-white">
          <Sprout aria-hidden className="h-5 w-5" />
        </span>
        <h1 className="mt-4 text-xl font-semibold tracking-tight">Page not found</h1>
        <p className="mt-2 text-sm text-neutral-700">This address doesn&apos;t match any screen in the planner.</p>
        <Link
          href="/"
          className="mt-5 inline-flex items-center justify-center rounded-lg bg-emerald-700 px-3.5 py-2 text-sm font-medium text-white hover:bg-emerald-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
        >
          Go to the planner
        </Link>
      </div>
    </main>
  );
}
