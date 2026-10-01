import { useEffect, useMemo, useState } from "react";

/* Layer chips → that layer's nodes with their role. Choosing a node lights its connections in the
   picture (one redraw). Plain DOM, at most a few dozen rows at a time. */
const split = (s: string) => { const t = String(s || ""), i = t.indexOf(" — "); return i < 0 ? [t, ""] : [t.slice(0, i), t.slice(i + 3)]; };
export const nodeTitle = (sc: any, id: number) => split(sc.name[id])[0] || "선이 모인 자리";
export const nodeRole = (sc: any, id: number) => (sc.role && sc.role[id]) || split(sc.name[id])[1];
export function linkCount(sc: any, id: number) { let n = 0; const a = sc.la, b = sc.lb; for (let j = 0; j < a.length; j++) if (a[j] === id || b[j] === id) n++; return n; }

export function NodeRoles({ sc, sel, onSel, dark }: { sc: any; sel: number; onSel: (id: number) => void; dark?: boolean }) {
  const layers = useMemo(() => (sc.groups || []).filter((g: any) => g.ids && g.ids.length && g.kind <= 4), [sc]);
  const home = (id: number) => layers.findIndex((g: any) => (g.list || g.ids).includes(id));
  const [li, setLi] = useState(() => { const k = sel >= 0 ? home(sel) : -1; return k >= 0 ? k : 0; });
  const [shown, setShown] = useState(8);
  useEffect(() => { if (sel < 0) return; const k = home(sel); if (k >= 0 && k !== li) { setLi(k); setShown(8); } }, [sel]);
  const g = layers[li];
  const links = useMemo(() => (sel >= 0 ? linkCount(sc, sel) : 0), [sc, sel]);
  if (!g) return null;
  const ids: number[] = g.list || g.ids;
  const c = dark ? { card: "bg-white/5", ink: "text-[#f4ecff]", ink2: "text-[#e6cfe0]/80", ink3: "text-[#e6cfe0]/55", on: "bg-[#f4ecff] text-[#1a0b24]", off: "bg-white/5 text-[#e6cfe0]/80", line: "border-white/10" }
    : { card: "bg-bg-2", ink: "text-ink", ink2: "text-ink-2", ink3: "text-ink-3", on: "bg-ink text-bg", off: "bg-bg-3 text-ink-2", line: "border-line" };
  const v = (id: number) => { const x = sc.val[id]; return x === x ? Math.min(1, Math.abs(x)) : null; };
  return (
    <div>
      {sel >= 0 && (
        <div className={"mb-3 rounded-sm px-3 py-2.5 " + c.card}>
          <div className="flex items-baseline justify-between gap-3">
            <b className={"bs-num min-w-0 truncate text-[13px] " + c.ink}>{nodeTitle(sc, sel)}</b>
            <button onClick={() => onSel(-1)} className={"shrink-0 text-[11px] underline underline-offset-4 " + c.ink3}>선택 해제</button>
          </div>
          {nodeRole(sc, sel) && <p className={"mt-1 text-[12px] leading-snug " + c.ink2}>{nodeRole(sc, sel)}</p>}
          <p className={"mt-1 text-[11px] " + c.ink3}>연결 {links.toLocaleString("ko-KR")}개 — 그림에서 이 노드의 선만 밝게 남았습니다.</p>
        </div>
      )}
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {layers.map((L: any, k: number) => (
          <button key={k} onClick={() => { setLi(k); setShown(8); }} className={"shrink-0 whitespace-nowrap rounded-sm px-2.5 py-1 text-[12px] " + (k === li ? c.on : c.off)}>
            {L.label} <span className="bs-num opacity-70">{(L.list || L.ids).length}</span>
          </button>))}
      </div>
      {g.desc && <p className={"mt-2 text-[12px] leading-snug " + c.ink2}>{g.desc}</p>}
      <ul className={"mt-2 divide-y border-y " + c.line + " " + (dark ? "divide-white/10" : "divide-line")}>
        {ids.slice(0, shown).map((id) => { const x = v(id), on = id === sel;
          return (
            <li key={id}>
              <button onClick={() => onSel(on ? -1 : id)} className={"grid w-full grid-cols-[minmax(0,1fr)_56px] items-center gap-3 py-2 text-left " + (on ? "opacity-100" : "")}>
                <span className="min-w-0">
                  <span className={"bs-num block truncate text-[12.5px] " + (on ? "text-rose" : c.ink)}>{nodeTitle(sc, id)}</span>
                  {nodeRole(sc, id) && <span className={"block truncate text-[11px] " + c.ink3}>{nodeRole(sc, id)}</span>}
                </span>
                <span className={"relative h-[5px] rounded-sm " + (dark ? "bg-white/10" : "bg-bg-3")}>{x != null && <span className="absolute inset-y-0 left-0 rounded-sm bg-rose" style={{ width: x * 100 + "%" }} />}</span>
              </button>
            </li>); })}
      </ul>
      {ids.length > shown && <button onClick={() => setShown(shown + 30)} className={"mt-2 text-[12px] underline underline-offset-4 " + c.ink2}>{Math.min(30, ids.length - shown)}개 더 보기 (남은 {ids.length - shown})</button>}
    </div>
  );
}
