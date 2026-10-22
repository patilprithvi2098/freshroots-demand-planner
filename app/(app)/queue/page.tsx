import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadPlanning } from "@/lib/services/overview";
import { fmtDate } from "@/lib/format";
import { EmptyState } from "@/components/ui";
import { SkuWorkspace } from "@/components/sku/SkuWorkspace";
import { parseView } from "@/lib/reviewViews";
import { QueueClient } from "./QueueClient";

export default async function QueuePage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  await requireRole(["planner"]);
  const { view } = await searchParams;
  const p = await loadPlanning(await createClient());

  if (!p.run) {
    return (
      <>
        <h1 className="mb-6 text-2xl font-semibold tracking-tight">Review</h1>
        <EmptyState title="Nothing to review yet">
          Upload this week&apos;s SAP files and run planning from the{" "}
          <Link className="font-medium text-emerald-800 underline" href="/overview">
            Overview
          </Link>
          .
        </EmptyState>
      </>
    );
  }

  const initial = parseView(view);
  return (
    <SkuWorkspace rows={p.rows}>
      <div className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight">Review</h1>
        <p className="mt-1 text-sm text-neutral-600">
          Stock as of {fmtDate(p.run.as_of_date)}. Approve what looks right, change or reject the rest, then send to procurement. Nothing is ordered
          until you send it.
        </p>
      </div>
      <QueueClient runId={p.run.id} rows={p.rows} initialView={initial} pendingAi={p.rows.some((r) => r.ai_status === "pending")} />
    </SkuWorkspace>
  );
}
