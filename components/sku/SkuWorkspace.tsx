"use client";

// Holds the list of SKUs for a page and the pop-up for whichever one is open.
// Any component inside can call useSku().open(id) to show the details.

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { SkuRow } from "@/lib/skuRow";
import { SkuModal } from "./SkuModal";
import { OverrideDialog } from "./OverrideDialog";

interface Ctx {
  /** Open a SKU. `list` is the order of the list it was opened from, for next / previous. */
  open: (id: string, list?: string[]) => void;
  notify: (text: string, ok?: boolean) => void;
}

const SkuContext = createContext<Ctx | null>(null);

export function useSku(): Ctx {
  const c = useContext(SkuContext);
  if (!c) throw new Error("useSku must be used inside SkuWorkspace");
  return c;
}

export function SkuWorkspace({ rows, children }: { rows: SkuRow[]; children: ReactNode }) {
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(null);
  const [navIds, setNavIds] = useState<string[] | null>(null);
  const [dialog, setDialog] = useState<{ mode: "edit" | "reject"; row: SkuRow } | null>(null);
  const [toast, setToast] = useState<{ text: string; ok: boolean } | null>(null);

  const notify = useCallback((text: string, ok = true) => {
    setToast({ text, ok });
    window.setTimeout(() => setToast(null), 5000);
  }, []);

  const open = useCallback((id: string, list?: string[]) => {
    setNavIds(list ?? null);
    setOpenId(id);
  }, []);

  const row = rows.find((r) => r.id === openId) ?? null;
  // Next and previous follow the list the SKU was opened from, so Raghav can work through it in the pop-up.
  const ids = navIds && row && navIds.includes(row.id) ? navIds : rows.map((r) => r.id);
  const idx = row ? ids.indexOf(row.id) : -1;

  return (
    <SkuContext.Provider value={{ open, notify }}>
      {children}
      {row ? (
        <SkuModal
          key={row.id}
          row={row}
          position={{ index: idx, total: ids.length }}
          onPrev={idx > 0 ? () => setOpenId(ids[idx - 1]) : undefined}
          onNext={idx < ids.length - 1 ? () => setOpenId(ids[idx + 1]) : undefined}
          onClose={() => setOpenId(null)}
          onEdit={() => setDialog({ mode: "edit", row })}
          onReject={() => setDialog({ mode: "reject", row })}
          onDone={(text) => {
            notify(text);
            router.refresh();
          }}
        />
      ) : null}
      {dialog ? (
        <OverrideDialog
          mode={dialog.mode}
          row={dialog.row}
          onClose={() => setDialog(null)}
          onDone={(text) => {
            setDialog(null);
            notify(text);
            router.refresh();
          }}
        />
      ) : null}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
        {toast ? (
          <p
            role={toast.ok ? "status" : "alert"}
            className={`pointer-events-auto rounded-lg px-4 py-2.5 text-sm font-medium shadow-lg ${toast.ok ? "bg-neutral-900 text-white" : "bg-red-700 text-white"}`}
          >
            {toast.text}
          </p>
        ) : null}
      </div>
    </SkuContext.Provider>
  );
}
