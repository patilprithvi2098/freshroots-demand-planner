// Weeks of cover against the SKU's safe window: a green band from min to max weeks, and a marker for today.
// Below the band = running out; above it = too much stock.

export function coverTone(cover: number | null, window: { min: number; max: number }) {
  if (cover == null) return "unknown" as const;
  if (cover < window.min) return "low" as const;
  if (cover > window.max) return "high" as const;
  return "ok" as const;
}

const MARKER = { low: "bg-red-600", high: "bg-amber-500", ok: "bg-emerald-600", unknown: "bg-neutral-400" };

export function CoverGauge({
  cover,
  window,
  scaleMax,
  size = "md",
  label,
}: {
  cover: number | null;
  window: { min: number; max: number };
  /** Fixed right edge of the scale, so gauges in a list line up. Covers beyond it are pinned to the edge. */
  scaleMax?: number;
  size?: "sm" | "md";
  label?: string;
}) {
  const max = scaleMax ?? Math.max(window.max * 1.4, cover ?? 0, 1);
  const pct = (v: number) => `${Math.min(100, (v / max) * 100)}%`;
  const tone = coverTone(cover, window);
  const h = size === "sm" ? "h-2" : "h-3";
  return (
    <div
      className="relative w-full"
      role="img"
      aria-label={label ?? `${cover == null ? "Unknown" : cover.toFixed(1)} weeks of cover; safe range ${window.min} to ${window.max} weeks`}
    >
      <div className={`relative ${h} w-full overflow-hidden rounded-full bg-neutral-200`}>
        <div className="absolute inset-y-0 bg-emerald-200" style={{ left: pct(window.min), width: `calc(${pct(window.max)} - ${pct(window.min)})` }} />
      </div>
      {cover != null ? (
        <div
          className={`absolute top-1/2 ${size === "sm" ? "h-3.5 w-1.5" : "h-5 w-2"} -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-white ${MARKER[tone]}`}
          style={{ left: pct(Math.min(cover, max)) }}
        />
      ) : null}
    </div>
  );
}
