/* [V33.615] 후보 선별 · OMNI-Q — 매매법 AI 가 볼 종목(그날 상위 20%)을 고르는 순위 모델. 데이터 /api/omni-status(omniQ) 그대로. */
import { type ReactNode } from "react";
import * as Tabs from "@radix-ui/react-tabs";
import { type Tone, f1, n0, ago } from "../models";
import { useMemo, useState } from "react";
import { Badge, Bars, Empty, Facts, Kpis, Section } from "./ui";
import { ModelNet } from "./OmniStage";
import { omniqNet } from "../gl/netScenes";

const MK: Record<string, string> = { us: "미국", kr: "한국" };
export function oqState(j: any): { label: string; tone: Tone } {
  const q = (j && j.omniQ) || {};
  const ss = ["us", "kr"].map((m) => q[m] && q[m].view && q[m].view.state).filter(Boolean);
  if (ss.includes("speak")) return { label: "발언", tone: "ok" };
  if (ss.includes("prov")) return { label: "잠정", tone: "warn" };
  if (ss.length) return { label: "섀도우", tone: "shade" };
  return { label: "대기", tone: "idle" };
}
const ST: Record<string, [string, Tone]> = { speak: ["발언", "ok"], prov: ["잠정", "warn"], shadow: ["섀도우", "shade"] };

function Gate({ g, label }: { g: any; label: string }) {
  if (!g) return <p className="py-2 text-[12px] text-ink-3">{label} — 없음</p>;
  const g1 = g.g1 || {}, g2 = g.g2 || {}, g3 = g.g3 || {}, fit = g.fit || {};
  return (
    <div className="mt-3">
      <div className="mb-2 text-[12.5px] font-semibold">{label}</div>
      <Kpis items={[
        { k: "① 상위 10% 승률 하한", v: g1.lb != null ? (g1.lb * 100).toFixed(1) + "%" : "—", hint: "t " + f1(g1.t, 1) + " (≥ " + (g1.needT ?? 3) + ")", tone: g1.ok ? "ok" : "bad" },
        { k: "② 비용 뺀 초과 구간", v: (g2.pos ?? "—") + " / " + ((g2.folds || []).length || "—"), hint: "필요 " + (g2.need ?? "—"), tone: g2.ok ? "ok" : "bad" },
        { k: "③ 실전 장부", v: n0(g3.days) + "일", hint: "필요 " + (g3.needDays ?? 30) + "일" + (g3.lb != null ? " · 하한 " + (g3.lb * 100).toFixed(1) + "%" : ""), tone: g3.ok ? "ok" : "shade" },
        { k: "적합 진단", v: fit.kind || "—", hint: fit.inMu != null ? "안 " + (fit.inMu * 100).toFixed(1) + "% · 밖 " + (fit.outMu * 100).toFixed(1) + "%" : undefined, tone: fit.kind === "정상 범위" ? "ok" : "warn" },
      ]} />
    </div>);
}

export function OmniQ({ d, head }: { d: any; head: ReactNode }) {
  const q = d.omniQ || {}, us = q.us, kr = q.kr;
  const [mk, setMk] = useState<"us" | "kr">(us ? "us" : "kr");
  const net = useMemo(() => omniqNet(d, mk), [d, mk]);
  if (!us && !kr) return <div>{head}<Empty>OMNI-Q 가 아직 올라오지 않았습니다.</Empty></div>;
  const st = (r: any) => (r && r.view && ST[r.view.state]) || ["—", "idle"] as [string, Tone];
  const groups = (us && us.featGroups) || (kr && kr.featGroups) || null;
  const top = (r: any) => ((r && r.featTop) || []).slice(0, 15).map((f: any) => ({ name: f.name, v: f.share }));
  return (
    <div>
      {head}
      <div className="mt-4"><Kpis items={[
        { k: "미국 5일 머리", v: st(us)[0], hint: us ? "피처 " + n0(us.nFeat) + " · " + n0(us.n) + "종목 · " + ago(us.view && us.view.scoredAt) : undefined, tone: st(us)[1] },
        { k: "한국 5일 머리", v: st(kr)[0], hint: kr ? "피처 " + n0(kr.nFeat) + " · " + n0(kr.n) + "종목 · " + ago(kr.view && kr.view.scoredAt) : undefined, tone: st(kr)[1] },
        { k: "매매법 AI 후보", v: "상위 " + Math.round((1 - ((us || kr).cand ?? 0.8)) * 100) + "%", hint: "그날 5일 점수 순위" },
        { k: "학습", v: ago((us || kr).trainedAt), hint: (us || kr).learner || "lgb" },
      ]} /></div>
      <Tabs.Root defaultValue="s" className="mt-5">
        <Tabs.List className="flex gap-5 border-b border-line">
          {[["s", "신경망"], ["e", "관문"], ["f", "상세"]].map(([v, t]) => (
            <Tabs.Trigger key={v} value={v} className="-mb-px border-b-2 border-transparent pb-2 text-[13px] text-ink-3 data-[state=active]:border-rose data-[state=active]:text-ink">{t}</Tabs.Trigger>))}
        </Tabs.List>
        <Tabs.Content value="s" className="pt-4 outline-none">
          <div className="mb-2 flex gap-1.5">{(["us", "kr"] as const).filter((m) => q[m]).map((m) => <button key={m} onClick={() => setMk(m)} className={"rounded-sm px-2.5 py-1 text-[12px] " + (mk === m ? "bg-ink text-bg" : "bg-bg-3 text-ink-2")}>{MK[m]}</button>)}</div>
          {net ? <ModelNet sc={net} name="OMNI-Q" /> : <Empty>신경망을 그릴 자료가 없습니다.</Empty>}
          {groups ? <Section title="피처 묶음" aside={"총 " + n0(Object.values(groups).reduce((a: number, b: any) => a + (+b || 0), 0)) + "개"}>
            <Bars rows={Object.keys(groups).map((k) => ({ name: k, v: +groups[k] || 0, label: n0(groups[k]) + "개" }))} />
          </Section> : <Empty>피처 묶음은 다음 학습 회차부터 표시됩니다.</Empty>}
          {top(us).length > 0 && <Section title="미국 — 많이 쓴 피처" aside="gain 비중"><Bars rows={top(us)} unit="%" max={10} /></Section>}
          {top(kr).length > 0 && <Section title="한국 — 많이 쓴 피처" aside="gain 비중"><Bars rows={top(kr)} unit="%" max={10} /></Section>}
        </Tabs.Content>
        <Tabs.Content value="e" className="pt-1 outline-none">
          {["us", "kr"].map((m) => q[m] ? (
            <Section key={m} title={MK[m]} aside={<Badge tone={st(q[m])[1]}>{st(q[m])[0]}</Badge>}>
              <Gate g={q[m].view && q[m].view.gate} label="5일 머리" /><Gate g={q[m].view && q[m].view.gate20} label="20일 머리" />
            </Section>) : null)}
        </Tabs.Content>
        <Tabs.Content value="f" className="pt-4 outline-none"><Facts rows={[
          ["역할", "매매법 AI 의 후보 선별 — 그날 5일 점수 상위 20% 종목만 매매법 AI 가 본다(단독 매수는 매매법 AI 주력 시장에서 퇴역)"],
          ["미국 상위 10", us && (us.top10 || []).join(" · ")], ["한국 상위 10", kr && (kr.top10 || []).join(" · ")],
          ["미국 채점일", us && us.day], ["한국 채점일", kr && kr.day],
        ]} /></Tabs.Content>
      </Tabs.Root>
    </div>);
}
