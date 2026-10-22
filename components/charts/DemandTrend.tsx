// Total weekly units across all SKUs. Festival-month weeks are shaded.

export function DemandTrend({ data }: { data: { iso_week: string; units: number; festival: boolean }[] }) {
  if (data.length === 0) return <p className="text-sm text-neutral-600">No sales uploaded yet.</p>;
  const W = 460;
  const H = 190;
  const pad = { l: 50, r: 12, t: 12, b: 28 };
  const max = Math.max(1, ...data.map((d) => d.units)) * 1.1;
  const step = (W - pad.l - pad.r) / Math.max(1, data.length - 1);
  const x = (i: number) => pad.l + i * step;
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  const line = data.map((d, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(d.units)}`).join(" ");
  const area = `${line} L${x(data.length - 1)},${H - pad.b} L${x(0)},${H - pad.b} Z`;
  const last4 = data.slice(-4).reduce((a, d) => a + d.units, 0) / Math.min(4, data.length);
  const prev = data.slice(-16, -4);
  const base = prev.length ? prev.reduce((a, d) => a + d.units, 0) / prev.length : last4;
  const change = base ? last4 / base - 1 : 0;
  return (
    <figure>
      <p className="mb-2 text-sm text-neutral-700">
        Last 4 weeks average <strong>{Math.round(last4).toLocaleString("en-IN")}</strong> units a week,{" "}
        <strong className={change > 0 ? "text-emerald-700" : "text-red-700"}>
          {change >= 0 ? "+" : ""}
          {(change * 100).toFixed(1)}%
        </strong>{" "}
        against the 12 weeks before.
      </p>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Total weekly units, ${data[0].iso_week} to ${data[data.length - 1].iso_week}`}>
        {data.map((d, i) =>
          d.festival ? <rect key={d.iso_week} x={x(i) - step / 2} y={pad.t} width={step} height={H - pad.t - pad.b} fill="#fef3c7" /> : null,
        )}
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={pad.l} x2={W - pad.r} y1={y(max * f)} y2={y(max * f)} stroke="#e7e5e4" />
            <text x={pad.l - 6} y={y(max * f) + 4} fontSize="12" textAnchor="end" fill="#57534e">
              {Math.round(max * f).toLocaleString("en-IN")}
            </text>
          </g>
        ))}
        <path d={area} fill="#15803d" opacity="0.12" />
        <path d={line} fill="none" stroke="#15803d" strokeWidth="2.5" strokeLinejoin="round" />
        {data.map((d, i) => (
          <g key={d.iso_week}>
            <circle cx={x(i)} cy={y(d.units)} r="3" fill="#15803d">
              <title>{`${d.iso_week}: ${d.units.toLocaleString("en-IN")} units${d.festival ? " (festival month)" : ""}`}</title>
            </circle>
            {i % 4 === (data.length - 1) % 4 ? (
              <text x={x(i)} y={H - 8} fontSize="12" textAnchor="middle" fill="#57534e">
                {d.iso_week.slice(5)}
              </text>
            ) : null}
          </g>
        ))}
      </svg>
      <figcaption className="mt-1 flex items-center gap-1.5 text-xs text-neutral-600">
        <span className="h-2.5 w-4 rounded-sm bg-amber-100 ring-1 ring-amber-200" /> Festival month (+25% demand applied in the rules)
      </figcaption>
    </figure>
  );
}
