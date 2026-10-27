import { useEffect, useMemo, useRef, useState } from "react";

/* Layer tabs → that layer's nodes with their role. Choosing a node lights its connections in the
   picture (one redraw). Plain DOM, at most a few dozen rows at a time.
   [V33.692] 사용자 10/27 "노드 역할 보는 게 너무 불편" — ① 고른 노드 카드(역할 전문·숫자·연결) ② 밑줄 탭 + 지우기 있는 찾기
   ③ 줄마다 층 색 점 · 역할 두 줄 · 숫자 값 ④ 그림에서 고른 노드는 목록 맨 위에 고정하고 그 줄로 스크롤. */
const split = (s: string) => { const t = String(s || ""), i = t.indexOf(" — "); return i < 0 ? [t, ""] : [t.slice(0, i), t.slice(i + 3)]; };
export const nodeTitle = (sc: any, id: number) => split(sc.name[id])[0] || "선이 모인 자리";
export const nodeRole = (sc: any, id: number) => (sc.role && sc.role[id]) || split(sc.name[id])[1];
export function linkCount(sc: any, id: number) { let n = 0; const a = sc.la, b = sc.lb; for (let j = 0; j < a.length; j++) if (a[j] === id || b[j] === id) n++; return n; }

/* 고른 노드 카드의 덧붙임(모델이 아는 값) — 2×2 제원 · 검증 막대(값 · 문턱 표시) */
export type NodeMeter = { k: string; v: string; frac: number; mark?: number; warn?: boolean };
export type NodeExtra = (sc: any, id: number) => { specs?: { k: string; v: string }[]; meters?: NodeMeter[]; state?: { label: string; tone: "ok" | "warn" | "shade" } } | null;

// 층 색 — 그림의 반지름 색 경사와 같은 자리(바깥 파랑 → 안 보라 → 머리 분홍 → 나무 하늘)
const KIND_DOT = ["#a1cfff", "#b98cf5", "#ff6892", "#ff6892", "#bedeff", "#8f8a9a"];
const clamp2 = { display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as const, overflow: "hidden" };

export function NodeRoles({ sc, sel, onSel, dark, extra }: { sc: any; sel: number; onSel: (id: number) => void; dark?: boolean; extra?: NodeExtra }) {
  const layers = useMemo(() => (sc.groups || []).filter((g: any) => g.ids && g.ids.length && g.kind <= 4), [sc]);
  const home = (id: number) => layers.findIndex((g: any) => (g.list || g.ids).includes(id));
  const [li, setLi] = useState(() => { const k = sel >= 0 ? home(sel) : -1; return k >= 0 ? k : 0; });
  const [shown, setShown] = useState(12);
  const [qry, setQry] = useState("");
  const listRef = useRef<HTMLUListElement>(null);
  useEffect(() => { if (sel < 0) return; const k = home(sel); if (k >= 0 && k !== li) { setLi(k); setShown(12); } }, [sel]);
  useEffect(() => { if (sel < 0 || !listRef.current) return; const el = listRef.current.querySelector('[data-on="1"]'); if (el) (el as HTMLElement).scrollIntoView({ block: "nearest" }); }, [sel, li]);
  const g = layers[li];
  const links = useMemo(() => (sel >= 0 ? linkCount(sc, sel) : 0), [sc, sel]);
  const ex = useMemo(() => (sel >= 0 && extra ? extra(sc, sel) : null), [sc, sel, extra]);
  const allIds: number[] = useMemo(() => { const o: number[] = []; for (const L of layers) for (const id of (L.list || L.ids)) o.push(id); return o; }, [layers]);
  if (!g) return null;
  const c = dark ? { card: "bg-white/[.06] border-white/10", ink: "text-[#f4ecff]", ink2: "text-[#e6cfe0]/80", ink3: "text-[#e6cfe0]/55", line: "border-white/10", hov: "hover:bg-white/[.05]", on: "bg-[#ff5c86]/[.12] ring-1 ring-[#ff5c86]/40", input: "bg-white/5 text-[#f4ecff] placeholder:text-[#e6cfe0]/40", track: "bg-white/10" }
    : { card: "bg-bg-2 border-line", ink: "text-ink", ink2: "text-ink-2", ink3: "text-ink-3", line: "border-line", hov: "hover:bg-bg-2", on: "bg-rose/10 ring-1 ring-rose/40", input: "bg-bg-2 text-ink placeholder:text-ink-3", track: "bg-bg-3" };
  const ql = qry.trim().toLowerCase();
  const ids: number[] = ql ? allIds.filter((id) => (nodeTitle(sc, id) + " " + nodeRole(sc, id)).toLowerCase().includes(ql)) : (g.list || g.ids);
  let vis = ids.slice(0, shown);
  const pinned = sel >= 0 && !vis.includes(sel) && ids.includes(sel);
  if (pinned) vis = [sel].concat(vis);
  const v = (id: number) => { const x = sc.val[id]; return x === x ? Math.min(1, Math.abs(x)) : null; };
  const kindOf = (id: number) => { const L = layers.find((G: any) => (G.list || G.ids).includes(id)); return L ? L.kind : 5; };
  const selLayer = sel >= 0 ? layers[home(sel)] : null;
  return (
    <div className="flex flex-col gap-3">
      {/* ① 고른 노드 */}
      {sel >= 0 ? (
        <section className={"rounded-md border px-3.5 py-3 " + c.card} aria-label="고른 노드">
          <div className="flex items-start gap-2.5">
            <i className="mt-1.5 block h-2 w-2 shrink-0 rounded-full" style={{ background: KIND_DOT[kindOf(sel)] }} />
            <div className="min-w-0 flex-1">
              <div className={"text-[10.5px] tracking-wide " + c.ink3}>{selLayer ? selLayer.label : "노드"}{ex && ex.state ? " · " : ""}{ex && ex.state && <span className={ex.state.tone === "warn" ? "text-warn" : ex.state.tone === "shade" ? "text-shade" : "text-ok"}>{ex.state.label}</span>}</div>
              <b className={"bs-num block break-all text-[14px] leading-snug " + c.ink}>{nodeTitle(sc, sel)}</b>
            </div>
            <button onClick={() => onSel(-1)} aria-label="선택 해제" className={"-mr-1 -mt-0.5 shrink-0 rounded-sm px-2 py-1 text-[15px] leading-none " + c.ink3 + " " + c.hov}>×</button>
          </div>
          {nodeRole(sc, sel) && <p className={"mt-2 text-[12.5px] leading-relaxed " + c.ink2}>{nodeRole(sc, sel)}</p>}
          {ex && ex.specs && ex.specs.length > 0 && (
            <dl className={"mt-2.5 grid grid-cols-2 gap-px overflow-hidden rounded-sm " + (dark ? "bg-white/10" : "bg-line")}>
              {ex.specs.map((s2, k) => <div key={k} className={"px-2.5 py-1.5 " + (dark ? "bg-[#140c1c]" : "bg-bg")}><dt className={"text-[10.5px] " + c.ink3}>{s2.k}</dt><dd className={"bs-num truncate text-[12.5px] " + c.ink}>{s2.v}</dd></div>)}
            </dl>)}
          {ex && ex.meters && ex.meters.map((m, k) => (
            <div key={k} className="mt-2.5">
              <div className={"flex justify-between gap-3 text-[11.5px] " + c.ink2}><span>{m.k}</span><span className={"bs-num " + (m.warn ? "text-warn" : c.ink)}>{m.v}</span></div>
              <div className={"relative mt-1 h-[5px] rounded-sm " + c.track}>
                <span className={"absolute inset-y-0 left-0 rounded-sm " + (m.warn ? "bg-warn" : "bg-rose")} style={{ width: Math.max(0, Math.min(1, m.frac)) * 100 + "%" }} />
                {m.mark != null && <span className={"absolute -bottom-[3px] -top-[3px] w-[2px] " + (dark ? "bg-[#f4ecff]" : "bg-ink")} style={{ left: m.mark * 100 + "%" }} />}
              </div>
            </div>))}
          <p className={"mt-2.5 text-[11px] " + c.ink3}>연결 <span className="bs-num">{links.toLocaleString("ko-KR")}</span>개 — 그림에서 이 노드의 선만 밝게 남았습니다.</p>
        </section>
      ) : (
        <p className={"rounded-md border border-dashed px-3.5 py-3 text-[12px] leading-snug " + c.line + " " + c.ink3}>그림이나 아래 목록에서 노드를 고르면 역할 · 숫자 · 연결이 여기 나옵니다.</p>
      )}

      {/* ② 층 탭 + 찾기 */}
      <div role="tablist" aria-label="층" className={"flex gap-0.5 overflow-x-auto border-b " + c.line}>
        {layers.map((L: any, k: number) => {
          const on = k === li && !ql;
          return (
            <button key={k} role="tab" aria-selected={on} onClick={() => { setLi(k); setShown(12); setQry(""); }}
              className={"-mb-px flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-2.5 pb-2 pt-1 text-[12.5px] " + (on ? "border-rose " + c.ink : "border-transparent " + c.ink3)}>
              <i className="block h-1.5 w-1.5 rounded-full" style={{ background: KIND_DOT[L.kind] || KIND_DOT[5] }} />{L.label}<span className="bs-num opacity-70">{(L.list || L.ids).length}</span>
            </button>);
        })}
      </div>
      <div className="relative">
        <svg aria-hidden viewBox="0 0 16 16" className={"pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 " + c.ink3} fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="7" cy="7" r="4.5" /><path d="m10.5 10.5 3 3" /></svg>
        <input value={qry} onChange={(e) => { setQry(e.target.value); setShown(30); }} placeholder={"노드 찾기 — 이름·역할 (전체 " + allIds.length.toLocaleString("ko-KR") + "개)"} aria-label="노드 찾기"
          className={"w-full rounded-sm border py-2 pl-8 pr-8 text-[12.5px] outline-none " + c.line + " " + c.input} />
        {qry && <button onClick={() => setQry("")} aria-label="찾기 지우기" className={"absolute right-1 top-1/2 -translate-y-1/2 rounded-sm px-2 py-1 text-[14px] leading-none " + c.ink3}>×</button>}
      </div>
      <p className={"text-[11.5px] leading-snug " + c.ink3}>{ql ? "찾은 노드 " + ids.length.toLocaleString("ko-KR") + "개" : g.desc}</p>

      {/* ③ 목록 */}
      <ul ref={listRef} className="flex flex-col gap-0.5">
        {vis.map((id, n) => {
          const x = v(id), on = id === sel;
          return (
            <li key={id + (n === 0 && pinned ? "p" : "")}>
              <button data-on={on ? "1" : "0"} onClick={() => onSel(on ? -1 : id)}
                className={"grid w-full grid-cols-[8px_minmax(0,1fr)_auto] items-start gap-2.5 rounded-sm px-2 py-2 text-left " + (on ? c.on : c.hov)}>
                <i className="mt-[5px] block h-2 w-2 rounded-full" style={{ background: KIND_DOT[kindOf(id)] }} />
                <span className="min-w-0">
                  <span className={"bs-num block truncate text-[12.5px] " + (on ? "text-rose" : c.ink)}>{nodeTitle(sc, id)}{on && pinned && n === 0 ? <span className={"ml-1.5 text-[10.5px] " + c.ink3}>고른 노드</span> : null}</span>
                  {nodeRole(sc, id) && <span className={"mt-0.5 block text-[11.5px] leading-snug " + c.ink3} style={clamp2}>{nodeRole(sc, id)}</span>}
                </span>
                <span className="flex w-12 flex-col items-end gap-1 pt-0.5">
                  <span className={"bs-num text-[11px] " + c.ink2}>{x != null ? Math.round(x * 100) + "%" : "—"}</span>
                  <span className={"relative h-[4px] w-full rounded-sm " + c.track}>{x != null && <span className="absolute inset-y-0 left-0 rounded-sm bg-rose" style={{ width: x * 100 + "%" }} />}</span>
                </span>
              </button>
            </li>);
        })}
      </ul>
      {ids.length > shown && <button onClick={() => setShown(shown + 30)} className={"rounded-sm border py-2 text-[12px] " + c.line + " " + c.ink2 + " " + c.hov}>{Math.min(30, ids.length - shown)}개 더 보기 <span className={c.ink3}>(남은 {(ids.length - shown).toLocaleString("ko-KR")})</span></button>}
    </div>
  );
}
