// Weekly units for one SKU (last 16 weeks). Dark bars: last 4 weeks. Dashed line: 12-week average.

export function SalesBars({ data, avg }: { data: { iso_week: string; units: number | null }[]; avg: number | null }) {
  const W = 560;
  const H = 170;
  const pad = { l: 40, r: 8, t: 10, b: 28 };
  const max = Math.max(1, ...data.map((d) => d.units ?? 0), avg ?? 0) * 1.12;
  const bw = (W - pad.l - pad.r) / Math.max(1, data.length);
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  const summary = data.map((d) => `${d.iso_week}: ${d.units == null ? "missing" : d.units}`).join(", ");
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Weekly units sold. ${summary}`}>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={pad.l} x2={W - pad.r} y1={y(max * f)} y2={y(max * f)} stroke="#e7e5e4" />
            <text x={pad.l - 6} y={y(max * f) + 4} fontSize="10" textAnchor="end" fill="#57534e">
              {Math.round(max * f).toLocaleString("en-IN")}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const x = pad.l + i * bw + 2;
          const recent = i >= data.length - 4;
          return (
            <g key={d.iso_week}>
              {d.units == null ? (
                <text x={x + (bw - 4) / 2} y={H - pad.b - 4} fontSize="11" textAnchor="middle" fill="#b45309">
                  ?
                </text>
              ) : (
                <rect x={x} y={y(d.units)} width={bw - 4} height={H - pad.b - y(d.units)} rx="3" fill={recent ? "#15803d" : "#bbdcc3"}>
                  <title>{`${d.iso_week}: ${d.units.toLocaleString("en-IN")} units`}</title>
                </rect>
              )}
              {i % 2 === data.length % 2 ? (
                <text x={x + (bw - 4) / 2} y={H - 10} fontSize="9.5" textAnchor="middle" fill="#57534e">
                  {d.iso_week.slice(5)}
                </text>
              ) : null}
            </g>
          );
        })}
        {avg != null ? <line x1={pad.l} x2={W - pad.r} y1={y(avg)} y2={y(avg)} stroke="#1c1917" strokeDasharray="5 4" /> : null}
      </svg>
      <figcaption className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-600">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-[#15803d]" /> Last 4 weeks
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-[#bbdcc3]" /> Earlier weeks
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-4 border-t-2 border-dashed border-neutral-900" /> 12-week average
        </span>
        <span>“?” = no data that week (not counted as zero)</span>
      </figcaption>
    </figure>
  );
}
