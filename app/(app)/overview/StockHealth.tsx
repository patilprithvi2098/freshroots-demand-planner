"use client";

import { useState } from "react";
import { CoverGauge } from "@/components/charts/CoverGauge";
import { SituationBadge } from "@/components/sku/labels";
import { SkuImage } from "@/components/sku/SkuImage";
import { useSku } from "@/components/sku/SkuWorkspace";
import { fmt1 } from "@/lib/format";
import { needsReview, shortName, type SkuRow } from "@/lib/skuRow";

const SCALE_MAX = 20; // weeks; anything beyond is pinned to the right edge and labelled

export function StockHealth({ rows }: { rows: SkuRow[] }) {
  const { open } = useSku();
  const [showAll, setShowAll] = useState(false);
  const atRisk = rows.filter(needsReview);
  const healthy = rows.filter((r) => !needsReview(r)).sort((a, b) => (a.weeks_cover ?? 0) - (b.weeks_cover ?? 0));
  const list = showAll ? [...atRisk, ...healthy] : atRisk;

  return (
    <div>
      {list.length === 0 ? (
        <p className="rounded-xl bg-emerald-50 px-4 py-6 text-center text-sm text-emerald-900">All {rows.length} SKUs are inside their safe range.</p>
      ) : (
        <ul className="divide-y divide-neutral-100">
          {list.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => open(r.id, list.map((x) => x.id))}
                className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 rounded-lg px-2 py-2.5 text-left hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-emerald-700 sm:grid-cols-[minmax(0,16rem)_minmax(0,1fr)_3.5rem]"
              >
                <span className="flex min-w-0 items-center gap-3">
                  <SkuImage skuId={r.sku_id} name={r.sku_name} size="sm" />
                  <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{shortName(r.sku_name)}</span>
                  <span className="mt-0.5 flex items-center gap-1.5">
                    <SituationBadge flag={r.flag} short />
                    {r.is_exception ? (
                      <span className="whitespace-nowrap rounded-full bg-violet-50 px-1.5 py-0.5 text-[11px] font-medium text-violet-900 ring-1 ring-inset ring-violet-300">Judgement</span>
                    ) : null}
                  </span>
                  </span>
                </span>
                <span className="col-span-2 row-start-2 sm:col-span-1 sm:row-start-auto">
                  <CoverGauge cover={r.weeks_cover} window={r.window} scaleMax={SCALE_MAX} size="sm" />
                </span>
                <span className="tabular col-start-2 row-start-1 text-right text-sm font-semibold sm:col-start-auto sm:row-start-auto">
                  {fmt1(r.weeks_cover)}
                  <span className="block text-[11px] font-normal text-neutral-600">weeks</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {healthy.length ? (
        <button type="button" onClick={() => setShowAll((v) => !v)} className="mt-3 text-sm font-medium text-emerald-800 hover:underline">
          {showAll ? "Show only SKUs that need attention" : `Show the ${healthy.length} healthy SKUs too`}
        </button>
      ) : null}
    </div>
  );
}
