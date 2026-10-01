import { useEffect, useMemo, useRef, useState } from "react";
import { createOmniGL, type OmniView } from "../gl/omniGL";
import { getJSON, cached } from "../data";

/* Inline: a picture that turns by itself. On phones it never takes a touch (the page scrolls
   through it). "크게 보기" opens a full-screen explorer where one finger turns and two pinch. */
export function OmniStage({ d }: { d: any }) {
  const [st, setSt] = useState<any>(() => cached("/api/omni-structure"));
  const [full, setFull] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { let on = true; getJSON("/api/omni-structure").then((j) => { if (on && j && j.ok) setSt(j); }).catch(() => { /* fall back to representative links */ }); return () => { on = false; }; }, []);
  const sc = useMemo(() => {
    const NO = window.NeuralObservatory;
    if (!NO || !NO.omniCore) return null;
    try { return NO.omniCore(d, st && st.ok ? st : null); } catch (e) { setErr(String(e)); return null; }
  }, [d, st]);
  if (!sc) return <div className="flex aspect-[4/3] items-center justify-center rounded border border-line text-[12px] text-ink-3">{err ? "그림을 만들지 못했습니다" : "구조 불러오는 중…"}</div>;
  const I = sc.info || {};
  return (
    <div>
      <div className="relative overflow-hidden rounded-md border border-line" style={{ background: "radial-gradient(120% 70% at 50% 112%,rgba(196,40,84,.42),rgba(120,30,90,.14) 45%,transparent 70%),radial-gradient(90% 80% at 50% 42%,#20112f,#120a1f 55%,#09060f 100%)" }}>
        <div className="bs-gl-inline relative aspect-square max-h-[460px] w-full sm:aspect-[16/10]">
          {!full && <GL sc={sc} interactive={false} />}
        </div>
        <div className="pointer-events-none absolute left-3 top-3 text-[11px] leading-tight text-[#e6cfe0]/70">
          <div className="bs-num">{(I.params || 0).toLocaleString("ko-KR")} 가중치 · {(I.splits || 0).toLocaleString("ko-KR")} 분기</div>
          <div>{I.full ? "전부 한 줄씩" : "대표 연결만(구조 응답 대기)"}</div>
        </div>
        <button onClick={() => setFull(true)} className="absolute bottom-3 right-3 rounded-sm bg-[#f4ecff] px-3 py-1.5 text-[12px] font-semibold text-[#1a0b24] shadow-[0_6px_20px_rgba(0,0,0,.35)]">크게 보기</button>
      </div>
      {full && <FullView sc={sc} onClose={() => setFull(false)} />}
    </div>
  );
}

function GL({ sc, interactive, onPick, spin = true, motion = true, apiRef }: { sc: any; interactive: boolean; onPick?: (id: number) => void; spin?: boolean; motion?: boolean; apiRef?: React.MutableRefObject<OmniView | null> }) {
  const host = useRef<HTMLDivElement>(null);
  const [fallback, setFallback] = useState(false);
  useEffect(() => {
    if (!host.current) return;
    const reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
    const view = createOmniGL(host.current, sc, { interactive, spin: spin && !reduce, motion: motion && !reduce, onPick: onPick ? (id) => onPick(id) : undefined });
    if (!view.ok) { setFallback(true); return; }
    if (apiRef) apiRef.current = view;
    return () => { view.destroy(); if (apiRef) apiRef.current = null; };
  }, [sc, interactive]);
  return <div ref={host} className="absolute inset-0">{fallback && <StaticCore sc={sc} />}</div>;
}

/* No WebGL: draw the same scene once with the 2D engine — a still image costs nothing after that. */
function StaticCore({ sc }: { sc: any }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current, NO = window.NeuralObservatory; if (!c || !NO || !NO.drawCore) return;
    const r = c.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 1.5);
    c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr);
    const ctx = c.getContext("2d"); if (!ctx) return;
    NO.drawCore(ctx, sc, { yaw: .4, pitch: .32, zoom: 1, panX: 0, panY: 0, selected: -1, motion: false, spin: false, glow: false, small: null, skip0: true }, r.width, r.height, 0);
  }, [sc]);
  return <canvas ref={ref} className="absolute inset-0 h-full w-full" />;
}

function FullView({ sc, onClose }: { sc: any; onClose: () => void }) {
  const api = useRef<OmniView | null>(null);
  const [spin, setSpin] = useState(true), [motion, setMotion] = useState(true);
  const [picked, setPicked] = useState<string>("선이 모인 자리를 누르면 그 뉴런의 연결만 밝게 남습니다.");
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", k);
    const html = document.documentElement, prev = html.style.overflow; html.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", k); html.style.overflow = prev; };
  }, []);
  const onPick = (id: number) => {
    if (id < 0) { setPicked("선택 해제"); return; }
    const vv = sc.val[id], nm = String(sc.name[id] || "").split(" — ")[0];
    let n = 0; for (let j = 0; j < sc.la.length; j++) if (sc.la[j] === id || sc.lb[j] === id) n++;
    setPicked(nm + " · 연결 " + n.toLocaleString("ko-KR") + "개" + (vv === vv ? " · 세기 " + Math.round(vv * 100) + "%" : ""));
  };
  const B = ({ on, children, onClick }: any) => <button onClick={onClick} className={"rounded-sm px-2.5 py-1.5 text-[12px] " + (on ? "bg-[#f4ecff] text-[#1a0b24]" : "bg-white/5 text-ink-2")}>{children}</button>;
  return (
    <div className="fixed inset-0 z-[2147483000] flex flex-col" style={{ background: "radial-gradient(120% 60% at 50% 110%,rgba(196,40,84,.45),transparent 65%),#0b0712", overscrollBehavior: "contain", touchAction: "none" }} role="dialog" aria-label="OMNI 3D 구조">
      <div className="flex items-center justify-between gap-3 px-4 pb-2" style={{ paddingTop: "max(12px, env(safe-area-inset-top))" }}>
        <div className="min-w-0"><div className="text-[13px] font-semibold">OMNI 3D</div><div className="truncate text-[11px] text-ink-3">한 손가락 돌리기 · 두 손가락 확대</div></div>
        <button onClick={onClose} className="rounded-sm bg-white/10 px-3 py-1.5 text-[13px]">닫기</button>
      </div>
      <div className="bs-gl-full relative min-h-0 flex-1"><GL sc={sc} interactive onPick={onPick} apiRef={api} /></div>
      <div className="px-4 pt-2" style={{ paddingBottom: "max(14px, env(safe-area-inset-bottom))" }}>
        <p className="mb-2 min-h-[18px] truncate text-[12px] text-ink-2">{picked}</p>
        <div className="flex flex-wrap gap-1.5">
          <B on={spin} onClick={() => { setSpin(!spin); api.current?.setSpin(!spin); }}>자동회전</B>
          <B on={motion} onClick={() => { setMotion(!motion); api.current?.setMotion(!motion); }}>신호 흐름</B>
          <B onClick={() => api.current?.zoomBy(1 / 1.25)}>−</B>
          <B onClick={() => api.current?.zoomBy(1.25)}>+</B>
          <B onClick={() => { api.current?.reset(); setPicked("처음 화면"); }}>맞춤</B>
        </div>
      </div>
    </div>
  );
}
