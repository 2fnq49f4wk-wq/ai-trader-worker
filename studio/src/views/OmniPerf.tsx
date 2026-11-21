/* [V33.851] 작동 화면 아래 = OMNI 성능 지표만(사용자 11/17 "모델 구조는 매매법 AI 아래 한 칸 · OMNI 성능 보는 지표만 · 간단히").
   노드·역할은 위 AI 코어(OMNI 구체)에서 본다. 자료 = /api/omni-status(omniQ) 그대로 · 전체 모델 구조는 버튼으로 연다. */
import { useEffect, useState } from "react";
import { type Tone, f1, n0, ago } from "../models";
import { cached, getJSON, nnPath } from "../data";
import { Badge, Empty } from "./ui";

const TC: Record<string, string> = { ok: "var(--bs-ok)", warn: "var(--bs-warn)", bad: "var(--bs-bad)", shade: "var(--bs-ink2)", idle: "var(--bs-ink3)" };
import { Gate } from "./OmniQ";

const ST: Record<string, [string, Tone]> = { speak: ["발언", "ok"], prov: ["잠정", "warn"], shadow: ["섀도우", "shade"] };
const RK: Record<string, number> = { speak: 3, prov: 2, shadow: 1 };
const MK: Record<string, string> = { us: "미국", kr: "한국" };
const pct = (x: any) => (typeof x === "number" && isFinite(x) ? (x * 100).toFixed(1) + "%" : "—");
const pp = (x: any) => (typeof x === "number" && isFinite(x) ? (x >= 0 ? "+" : "") + (x * 100).toFixed(2) + "%" : "—");

export function OmniPerf({ onFull }: { onFull: () => void }) {
  const [d, setD] = useState<any>(() => cached(nnPath("omniq")));
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => { let on = true; getJSON(nnPath("omniq")).then((j) => { if (on && j) setD(j); }).catch(() => { /* */ }); return () => { on = false; }; }, []);
  const q = (d && d.omniQ) || {};
  const mks = (["us", "kr"] as const).filter((m) => q[m]);
  const best = (v: any): [string, Tone] => { if (!v) return ["—", "idle"]; const b = v.state20 && (RK[v.state20] || 0) > (RK[v.state] || 0) ? v.state20 : v.state; return (ST[b] || ["—", "idle"]) as [string, Tone]; };
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-[12.5px] text-ink-3">OMNI-Q 후보 선별 모델의 성능 관문 — 노드·역할은 위 AI 코어에서 점을 눌러 봅니다</div>
        <button onClick={onFull} className="rounded-sm border border-line bg-bg-3 px-3 py-1.5 text-[12px] text-ink-2 hover:text-ink">전체 모델 구조 열기</button>
      </div>
      {!mks.length ? <Empty>OMNI-Q 성능 자료를 불러오는 중입니다.</Empty> : mks.map((m) => {
        const r = q[m], v = (r && r.view) || {}, g = v.gate || {}, g20 = v.gate20 || {}, s = best(v);
        const head = (gg: any, name: string, st: string) => {
          const g1 = gg.g1 || {}, g2 = gg.g2 || {}, g3 = gg.g3 || {}, sim = g3.kind === "sim" ? g3 : gg.g3sim;
          return { k: name + " · " + ((ST[st] || ["—"])[0]), v: pct(g1.mu), hint: "상위 10% 승률 · 하한 " + pct(g1.lb) + " · t " + f1(g1.t, 1) + " · 구간 " + (g2.pos ?? "—") + "/" + ((g2.folds || []).length || "—") + (sim ? " · 모의 초과 " + pp(sim.mx) : "") + (sim && sim.stopSim ? " · 실전 손절 넣으면 " + pp(sim.stopSim.mx) : "")   /* [V33.863] 손절 모의(측정 · 판정 불변) */, tone: ((ST[st] || ["", "idle"])[1]) as Tone };
        };
        return (
          <section key={m} className="bs-perf rounded-[14px] border border-line bg-bg-2 p-4">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <b className="text-[14px]">{MK[m]}</b><Badge tone={s[1]}>{s[0]}</Badge>
              <span className="text-[11.5px] text-ink-3">피처 {n0(r.nFeat)} · {n0(r.n)}종목 · 채점 {ago(v.scoredAt)} · 학습 {ago(r.trainedAt)}</span>
              <button onClick={() => setOpen(open === m ? null : m)} className="ml-auto text-[12px] text-ink-3 hover:text-ink">{open === m ? "관문 접기" : "관문 자세히"}</button>
            </div>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {[head(g, "5일 머리", v.state), head(g20, "20일 머리", v.state20)].map((it) => (
                <div key={it.k} className="bs-tile rounded-[12px] border border-line px-3.5 py-3">
                  <div className="text-[11.5px] text-ink-2">{it.k}</div>
                  <div className="bs-num mt-1 text-[24px] font-semibold leading-none" style={{ color: TC[it.tone] }}>{it.v}</div>
                  <p className="mt-2 text-[11.5px] leading-snug text-ink-2">{it.hint}</p>
                </div>))}
            </div>
            {open === m && <div className="mt-2"><Gate g={v.gate} label="5일 머리" /><Gate g={v.gate20} label="20일 머리" /></div>}
          </section>);
      })}
    </div>);
}
