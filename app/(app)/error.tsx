"use client";

import { useEffect } from "react";
import { Card, btn } from "@/components/ui";

// A screen failed to load. Decisions already saved are safe, so say that and offer a retry.
export default function ScreenError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <Card className="mx-auto mt-10 max-w-md p-7 text-center">
      <h1 className="text-xl font-semibold tracking-tight">This screen didn&apos;t load</h1>
      <p className="mt-2 text-sm text-neutral-700">
        Your saved decisions are safe. Try again, and if it keeps happening, wait a minute: the database may be waking up.
      </p>
      <button type="button" onClick={reset} className={`${btn.primary} mt-5`}>
        Try again
      </button>
      {error.digest && <p className="mt-4 text-xs text-neutral-600">Reference: {error.digest}</p>}
    </Card>
  );
}
