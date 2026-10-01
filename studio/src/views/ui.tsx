import { type ReactNode, useState } from "react";
import { type Tone, toneColor } from "../models";

export function Dot({ tone, ring }: { tone: Tone; ring?: boolean }) {
  const c = toneColor[tone];
  return <span className="inline-block h-[7px] w-[7px] shrink-0 rounded-full" style={ring ? { boxShadow: `inset 0 0 0 1.5px ${c}` } : { background: c }} />;
}

export function Badge({ tone, children }: { tone: Tone; children: ReactNode }) {
  const c = toneColor[tone];
  return (
    <span className="inline-flex items-center gap-1.5 rounded-sm px-1.5 py-[2px] text-[11px] font-medium" style={{ color: c, background: `color-mix(in srgb, ${c} 13%, transparent)` }}>
      <Dot tone={tone} ring={tone === "shade"} />{children}
    </span>
  );
}

/* One number with its context. `ref` draws a hairline marker (e.g. the threshold the value must beat). */
export type KpiT = { k: string; v: string; hint?: string; tone?: Tone };
export function Kpis({ items }: { items: KpiT[] }) {
  return (
    <dl className="grid grid-cols-2 gap-px border-y border-line bg-line sm:grid-cols-4">
      {items.slice(0, 4).map((it, i) => (
        <div key={i} className="bg-bg px-3 py-3 first:pl-0 sm:[&:nth-child(4n+1)]:pl-0 [&:nth-child(2n+1)]:pl-0 sm:[&:nth-child(2n+1)]:pl-3">
          <dt className="text-[11px] text-ink-3">{it.k}</dt>
          <dd className="bs-num mt-1 text-[19px] leading-none" style={it.tone ? { color: toneColor[it.tone] } : undefined}>{it.v}</dd>
          {it.hint && <p className="mt-1.5 text-[11px] leading-snug text-ink-3">{it.hint}</p>}
        </div>
      ))}
    </dl>
  );
}

/* Horizontal strength bars — name · role · bar · value. Signed values draw from a centre line. */
export function Bars({ rows, signed, max = 10, unit = "" }: { rows: { name: string; role?: string; v: number; label?: string }[]; signed?: boolean; max?: number; unit?: string }) {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, max);
  const m = Math.max(1e-9, ...rows.map((r) => Math.abs(r.v)));
  return (
    <div>
      <ul className="divide-y divide-line">
        {shown.map((r, i) => {
          const w = Math.abs(r.v) / m * 100;
          return (
            <li key={r.name + i} className="grid grid-cols-[minmax(0,1fr)_92px_52px] items-center gap-3 py-2">
              <div className="min-w-0">
                <div className="bs-num truncate text-[12.5px] text-ink">{r.name}</div>
                {r.role && <div className="truncate text-[11px] text-ink-3">{r.role}</div>}
              </div>
              <div className="relative h-[5px] rounded-sm bg-bg-3">
                {signed ? (
                  <>
                    <span className="absolute inset-y-[-3px] left-1/2 w-px bg-line" />
                    <span className="absolute inset-y-0 rounded-sm" style={r.v >= 0 ? { left: "50%", width: w / 2 + "%", background: "var(--bs-ok)" } : { right: "50%", width: w / 2 + "%", background: "var(--bs-bad)" }} />
                  </>
                ) : (
                  <span className="absolute inset-y-0 left-0 rounded-sm bg-rose" style={{ width: w + "%" }} />
                )}
              </div>
              <div className="bs-num text-right text-[12px] text-ink-2">{r.label ?? (r.v * (unit === "%" ? 100 : 1)).toFixed(unit === "%" ? 1 : 2) + unit}</div>
            </li>
          );
        })}
      </ul>
      {rows.length > max && (
        <button className="mt-2 text-[12px] text-ink-2 underline decoration-line underline-offset-4" onClick={() => setAll(!all)}>
          {all ? "접기" : `${rows.length - max}개 더 보기`}
        </button>
      )}
    </div>
  );
}

export function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="mt-6">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h4 className="text-[12px] font-semibold tracking-tight text-ink-2">{title}</h4>
        {aside && <div className="text-[11px] text-ink-3">{aside}</div>}
      </div>
      {children}
    </section>
  );
}

/* Key–value lines for the "상세" tab — dense facts, no decoration. */
export function Facts({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="divide-y divide-line border-y border-line">
      {rows.filter((r) => r[1] != null && r[1] !== "").map(([k, v], i) => (
        <div key={i} className="grid grid-cols-[120px_minmax(0,1fr)] gap-3 py-2 text-[12.5px]">
          <dt className="text-ink-3">{k}</dt><dd className="min-w-0 break-words text-ink-2">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="py-10 text-center text-[13px] text-ink-3">{children}</div>;
}
