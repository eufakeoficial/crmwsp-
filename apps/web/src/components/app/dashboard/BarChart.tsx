import { barScale } from "./dashboard-utils";

export interface BarPoint {
  label: string;
  value: number;
}

/** Dependency-free SVG bar chart. `format` renders the tooltip value of each bar. */
export function BarChart({ points, format, title }: { points: BarPoint[]; format: (v: number) => string; title: string }) {
  const W = 600;
  const H = 140;
  const scale = barScale(points.map((p) => p.value));
  const slot = points.length ? W / points.length : W;
  const bar = Math.max(1, slot * 0.7);
  return (
    <svg viewBox={`0 0 ${W} ${H + 18}`} role="img" aria-label={title} className="h-44 w-full">
      <line x1="0" y1={H} x2={W} y2={H} stroke="currentColor" strokeOpacity="0.15" />
      {points.map((p, i) => {
        const h = Math.max(p.value > 0 ? 2 : 0, (scale[i] ?? 0) * (H - 4));
        return (
          <rect key={`${p.label}-${i}`} x={i * slot + (slot - bar) / 2} y={H - h} width={bar} height={h} rx="2" className="fill-lime">
            <title>{`${p.label}: ${format(p.value)}`}</title>
          </rect>
        );
      })}
      {points.length ? (
        <>
          <text x="0" y={H + 14} className="fill-muted text-[11px]">{points[0]?.label}</text>
          <text x={W} y={H + 14} textAnchor="end" className="fill-muted text-[11px]">{points[points.length - 1]?.label}</text>
        </>
      ) : null}
    </svg>
  );
}
