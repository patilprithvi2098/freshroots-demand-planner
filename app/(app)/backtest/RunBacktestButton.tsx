"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { btn } from "@/components/ui";
import { runBacktestAction } from "../actions";

export function RunBacktestButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        className={btn.primary}
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const res = await runBacktestAction();
            if (res.ok) router.refresh();
            else setError(res.error);
          })
        }
      >
        {pending ? "Replaying…" : "Run backtest"}
      </button>
      {error ? (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
