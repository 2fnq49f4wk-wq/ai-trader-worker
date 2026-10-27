import { useEffect, useMemo, useRef, useState } from "react";

/* Layer tabs → that layer's nodes with their role. Choosing a node lights its connections in the
   picture (one redraw). Plain DOM, at most a few dozen rows at a time.
   [V33.692] 사용자 10/27 "노드 역할 보는 게 너무 불편" — ① 고른 노드 카드(역할 전문·숫자·연결) ② 밑줄 탭 + 지우기 있는 찾기
   ③ 줄마다 층 색 점 · 역할 두 줄 · 숫자 값 ④ 그림에서 고른 노드는 목록 맨 위에 고정하고 그 줄로 스크롤.
   [V33.693] 사용자 10/27 "노드 역할 보는 거 두뇌관측 v3 처럼" — 신상서(NODE DOSSIER) 형식: 코드 표 · 층/상태 알약 · 제원 칸 ·
   VERIFICATION 막대 · LINKED(이웃 노드 칩 → 누르면 그 노드로) · 층 칩. 구체처럼 늘 어두운 보라 바탕(밝은 테마에서도 같은 판). */
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
  // 이웃 = 고른 노드와 선으로 이어진 노드(층에 속한 것 · 선 굵기 순) — LINKED 칩
  const nb = useMemo(() => { if (sel < 0) return { n: 0, ids: [] as number[] }; const a = sc.la, b = sc.lb, w = sc.ls, m = new Map<number, number>(); let n = 0;
    for (let j = 0; j < a.length; j++) { const o = a[j] === sel ? b[j] : b[j] === sel ? a[j] : -1; if (o < 0) continue; n++; const x = w ? +w[j] || 0 : 0; if ((m.get(o) ?? -1) < x) m.set(o, x); }
    const inL = new Set<number>(); for (const L of layers) for (const id of (L.list || L.ids)) inL.add(id);
    return { n, ids: [...m.entries()].filter(([id]) => inL.has(id)).sort((p, q) => q[1] - p[1]).map(([id]) => id) }; }, [sc, sel, layers]);
  const ex = useMemo(() => (sel >= 0 && extra ? extra(sc, sel) : null), [sc, sel, extra]);
  const allIds: number[] = useMemo(() => { const o: number[] = []; for (const L of layers) for (const id of (L.list || L.ids)) o.push(id); return o; }, [layers]);
  if (!g) return null;
  const ql = qry.trim().toLowerCase();
  const ids: number[] = ql ? allIds.filter((id) => (nodeTitle(sc, id) + " " + nodeRole(sc, id)).toLowerCase().includes(ql)) : (g.list || g.ids);
  let vis = ids.slice(0, shown);
  const pinned = sel >= 0 && !vis.includes(sel) && ids.includes(sel);
  if (pinned) vis = [sel].concat(vis);
  const v = (id: number) => { const x = sc.val[id]; return x === x ? Math.min(1, Math.abs(x)) : null; };
  const kindOf = (id: number) => { const L = layers.find((G: any) => (G.list || G.ids).includes(id)); return L ? L.kind : 5; };
  const hk = sel >= 0 ? home(sel) : -1, selLayer = hk >= 0 ? layers[hk] : null;
  const code = selLayer ? "L" + (hk + 1) + "·" + String((selLayer.list || selLayer.ids).indexOf(sel) + 1).padStart(2, "0") : "—";
  const tone = ex && ex.state ? ex.state.tone : "ok";
  const pill = tone === "warn" ? "bg-[#ff6892]/[.16] text-[#ffb3c7]" : tone === "shade" ? "bg-dz-c/[.12] text-dz-4" : "bg-[#a1cfff]/[.14] text-[#bfe0ff]";
  const mono = { fontFamily: "'JetBrains Mono',ui-monospace,'SF Mono',Menlo,monospace" };
  return (
    <div className={"flex flex-col gap-3 text-dz-3" + (dark ? "" : " rounded-md border border-dz-c/20 p-3.5")} style={dark ? undefined : { background: "linear-gradient(180deg,#170c24,#0c0714)" }}>
      {/* ① 신상서 */}
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-[10.5px] tracking-[.26em] text-dz-1" style={mono}><i className="block h-1.5 w-1.5 rounded-full bg-[#ff6892] shadow-[0_0_8px_#ff6892]" />NODE DOSSIER</span>
        {sel >= 0 && <span className="rounded-[4px] border border-dz-p/45 px-2 py-0.5 text-[11.5px] text-dz-p" style={mono}>{code}</span>}
      </div>
      {sel >= 0 ? (
        <section className="flex flex-col gap-2.5" aria-label="고른 노드">
          <div className="flex items-start gap-2">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
              <span className="rounded-[4px] bg-dz-c/[.12] px-2 py-0.5 text-[11.5px] text-dz-4"><i className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle" style={{ background: KIND_DOT[kindOf(sel)] }} />{selLayer ? selLayer.label : "노드"}</span>
              {ex && ex.state && <span className={"rounded-[4px] px-2 py-0.5 text-[11.5px] " + pill}>{ex.state.label}</span>}
            </div>
            <button onClick={() => onSel(-1)} aria-label="선택 해제" className="-mr-1 -mt-0.5 shrink-0 rounded-sm px-2 py-1 text-[15px] leading-none text-dz-1 hover:bg-white/[.06]">×</button>
          </div>
          <b className="block break-all text-[17px] font-semibold leading-snug text-[#fbf4fd]">{nodeTitle(sc, sel)}</b>
          {nodeRole(sc, sel) && <p className="text-[12.5px] leading-relaxed text-dz-2">{nodeRole(sc, sel)}</p>}
          {ex && ex.specs && ex.specs.length > 0 && (
            <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-dz-c/[.16] bg-dz-c/[.16]">
              {ex.specs.map((s2, k) => <div key={k} className="min-w-0 bg-[#120a1d] px-3 py-2"><dt className="text-[10.5px] text-dz-1">{s2.k}</dt><dd className="truncate text-[13px] font-semibold text-dz-5" style={mono}>{s2.v}</dd></div>)}
            </dl>)}
          {ex && ex.meters && ex.meters.length > 0 && (
            <div className="flex flex-col gap-2">
              <div className="text-[10px] tracking-[.22em] text-dz-1" style={mono}>VERIFICATION</div>
              {ex.meters.map((m, k) => (
                <div key={k}>
                  <div className="flex justify-between gap-3 text-[11.5px] text-dz-2"><span>{m.k}</span><span className={m.warn ? "text-[#ffb3c7]" : "text-dz-5"} style={mono}>{m.v}</span></div>
                  <div className="relative mt-1 h-[5px] rounded-sm bg-dz-c/[.12]">
                    <span className="absolute inset-y-0 left-0 rounded-sm" style={{ width: Math.max(0, Math.min(1, m.frac)) * 100 + "%", background: m.warn ? "linear-gradient(90deg,#db45ab,#ff6892)" : "linear-gradient(90deg,#9c61f5,#a1cfff)" }} />
                    {m.mark != null && <span className="absolute -bottom-[3px] -top-[3px] w-[2px] bg-dz-p" style={{ left: m.mark * 100 + "%" }} />}
                  </div>
                </div>))}
            </div>)}
          <div className="flex flex-col gap-1.5">
            <div className="text-[10px] tracking-[.22em] text-dz-1" style={mono}>LINKED · {nb.n.toLocaleString("ko-KR")}</div>
            {nb.ids.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {nb.ids.slice(0, 10).map((id) => <button key={id} onClick={() => onSel(id)} title={nodeTitle(sc, id)} className="max-w-[170px] truncate rounded-[5px] border border-dz-c/25 bg-dz-c/[.06] px-2 py-1 text-[11.5px] text-[#ebddf4] hover:border-dz-c"><i className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle" style={{ background: KIND_DOT[kindOf(id)] }} />{nodeTitle(sc, id)}</button>)}
                {nb.ids.length > 10 && <span className="self-center text-[11px] text-dz-1" style={mono}>+{nb.ids.length - 10}</span>}
              </div>) : null}
          </div>
        </section>
      ) : (
        <p className="rounded-md border border-dashed border-dz-c/25 px-3.5 py-3 text-[12px] leading-snug text-dz-1">그림이나 목록에서 노드를 고르면 역할 · 검증 · 연결이 여기 나옵니다.</p>
      )}

      <div className="h-px bg-dz-c/[.16]" />

      {/* ② 층 칩 + 찾기 */}
      <div role="tablist" aria-label="층" className="flex flex-wrap gap-1.5">
        {layers.map((L: any, k: number) => {
          const on = k === li && !ql;
          return (
            <button key={k} role="tab" aria-selected={on} onClick={() => { setLi(k); setShown(12); setQry(""); }}
              className={"flex items-center gap-1.5 whitespace-nowrap rounded-[5px] border px-2.5 py-1 text-[12px] " + (on ? "border-dz-p bg-[#ffcfb5]/[.12] text-[#ffe6d8]" : "border-dz-c/25 text-dz-2 hover:border-dz-c/60")}>
              <i className="block h-1.5 w-1.5 rounded-full" style={{ background: KIND_DOT[L.kind] || KIND_DOT[5] }} />{L.label}<span className="opacity-75" style={mono}>{(L.list || L.ids).length}</span>
            </button>);
        })}
      </div>
      <div className="relative">
        <svg aria-hidden viewBox="0 0 16 16" className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-dz-1" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="7" cy="7" r="4.5" /><path d="m10.5 10.5 3 3" /></svg>
        <input value={qry} onChange={(e) => { setQry(e.target.value); setShown(30); }} placeholder={"노드 찾기 — 이름·역할 (전체 " + allIds.length.toLocaleString("ko-KR") + "개)"} aria-label="노드 찾기"
          className="w-full rounded-md border border-dz-c/25 bg-dz-c/[.05] py-2 pl-8 pr-8 text-[12.5px] text-dz-3 outline-none placeholder:text-dz-1/70 focus:border-dz-c/60" />
        {qry && <button onClick={() => setQry("")} aria-label="찾기 지우기" className="absolute right-1 top-1/2 -translate-y-1/2 rounded-sm px-2 py-1 text-[14px] leading-none text-dz-1">×</button>}
      </div>
      <p className="text-[11.5px] leading-snug text-dz-1">{ql ? "찾은 노드 " + ids.length.toLocaleString("ko-KR") + "개" : g.desc}</p>

      {/* ③ 목록 */}
      <ul ref={listRef} className="flex flex-col">
        {vis.map((id, n) => {
          const x = v(id), on = id === sel;
          return (
            <li key={id + (n === 0 && pinned ? "p" : "")} className="border-t border-dz-c/10">
              <button data-on={on ? "1" : "0"} onClick={() => onSel(on ? -1 : id)}
                className={"grid w-full grid-cols-[8px_minmax(0,1fr)_auto] items-start gap-2.5 rounded-sm px-1.5 py-2 text-left " + (on ? "bg-[#ffcfb5]/[.08]" : "hover:bg-white/[.04]")}>
                <i className="mt-[5px] block h-2 w-2 rounded-full" style={{ background: KIND_DOT[kindOf(id)] }} />
                <span className="min-w-0">
                  <span className={"block truncate text-[12.5px] " + (on ? "font-semibold text-dz-p" : "text-dz-3")} style={mono}>{nodeTitle(sc, id)}{on && pinned && n === 0 ? <span className="ml-1.5 text-[10.5px] text-dz-1">고른 노드</span> : null}</span>
                  {nodeRole(sc, id) && <span className="mt-0.5 block text-[11.5px] leading-snug text-dz-1" style={clamp2}>{nodeRole(sc, id)}</span>}
                </span>
                <span className="flex w-12 flex-col items-end gap-1 pt-0.5">
                  <span className="text-[10.5px] text-dz-4" style={mono}>{x != null ? Math.round(x * 100) + "%" : "—"}</span>
                  <span className="relative h-[4px] w-full rounded-sm bg-dz-c/[.12]">{x != null && <span className="absolute inset-y-0 left-0 rounded-sm" style={{ width: x * 100 + "%", background: on ? "#ffcfb6" : "linear-gradient(90deg,#9c61f5,#a1cfff)" }} />}</span>
                </span>
              </button>
            </li>);
        })}
      </ul>
      {ids.length > shown && <button onClick={() => setShown(shown + 30)} className="rounded-md border border-dz-c/25 py-2 text-[12px] text-dz-2 hover:border-dz-c/60">{Math.min(30, ids.length - shown)}개 더 보기 <span className="text-dz-1">(남은 {(ids.length - shown).toLocaleString("ko-KR")})</span></button>}
    </div>
  );
}
