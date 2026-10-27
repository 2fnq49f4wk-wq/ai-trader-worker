/* [V33.615] 후보 선별 · OMNI-Q — 매매법 AI 가 볼 종목(학습기 검증이 고른 폭)을 고르는 순위 모델. 데이터 /api/omni-status(omniQ) 그대로. */
import { type ReactNode } from "react";
import * as Tabs from "@radix-ui/react-tabs";
import { type Tone, f1, n0, ago } from "../models";
import { useEffect, useMemo, useState } from "react";
import { cached, getJSON } from "../data";
import { Badge, Bars, Empty, Facts, Kpis, Section } from "./ui";
import { ModelNet } from "./OmniStage";
import { omniqNet } from "../gl/netScenes";

const MK: Record<string, string> = { us: "미국", kr: "한국" };
export function oqState(j: any): { label: string; tone: Tone } {
  const q = (j && j.omniQ) || {};
  const ss = ["us", "kr"].flatMap((m) => [q[m] && q[m].view && q[m].view.state, q[m] && q[m].view && q[m].view.state20]).filter(Boolean);   // [V33.656] 20일 머리 잠정도 반영
  if (ss.includes("speak")) return { label: "발언", tone: "ok" };
  if (ss.includes("prov")) return { label: "잠정", tone: "warn" };
  if (ss.length) return { label: "섀도우", tone: "shade" };
  return { label: "대기", tone: "idle" };
}
const ST: Record<string, [string, Tone]> = { speak: ["발언", "ok"], prov: ["잠정", "warn"], shadow: ["섀도우", "shade"] };

/* [V33.684] ③ = 모의 시뮬레이션 · 맞춤 기준 — 실전 상한(하루 6 · 동시 10/8)으로 표본 밖 상위 10% 를 사고, 같은 날·같은 위험 묶음의 뽑히지 않은 종목과 비교 */
const pp = (x: any) => (typeof x === "number" && isFinite(x) ? (x >= 0 ? "+" : "") + (x * 100).toFixed(2) + "%" : "—");
const sim = (s: any, k: string) => { const e = s.early || {};
  const rg = Array.isArray(s.byReg) ? " · 국면 " + s.byReg.map((b: any) => (b.reg === s.regNow ? "▸" : "") + b.ko + " " + pp(b.mean)).join(" ") : "";
  return { k, v: "맞춤 초과 " + pp(s.mx), hint: n0(s.n) + "건 · 앞 " + n0(e.mN) + "달 t " + f1(e.mT, 1) + " (≥ " + (s.needT ?? 2) + ") · 최근 20% " + pp(s.lateMx) + " · 비용 뺀 " + pp(s.net) + rg, tone: (s.ok ? "ok" : "bad") as Tone }; };
function Gate({ g, label }: { g: any; label: string }) {
  if (!g) return <p className="py-2 text-[12px] text-ink-3">{label} — 없음</p>;
  const g1 = g.g1 || {}, g2 = g.g2 || {}, g3 = g.g3 || {}, fit = g.fit || {};
  return (
    <div className="mt-3">
      <div className="mb-2 text-[12.5px] font-semibold">{label}</div>
      <Kpis items={[
        { k: "① 상위 10% 승률 하한", v: g1.lb != null ? (g1.lb * 100).toFixed(1) + "%" : "—", hint: "t " + f1(g1.t, 1) + " (≥ " + (g1.needT ?? 3) + ")", tone: g1.ok ? "ok" : "bad" },
        { k: "② 비용 뺀 초과 구간", v: (g2.pos ?? "—") + " / " + ((g2.folds || []).length || "—"), hint: "필요 " + (g2.need ?? "—"), tone: g2.ok ? "ok" : "bad" },
        g3.kind === "sim" ? sim(g3, "③ 모의 시뮬레이션") : { k: "③ 실전 장부", v: n0(g3.days) + "일", hint: "필요 " + (g3.needDays ?? 30) + "일" + (g3.lb != null ? " · 하한 " + (g3.lb * 100).toFixed(1) + "%" : ""), tone: g3.ok ? "ok" : "shade" },
        { k: "적합 진단", v: fit.kind || "—", hint: (fit.inMu != null ? "안 " + (fit.inMu * 100).toFixed(1) + "% · 밖 " + (fit.outMu * 100).toFixed(1) + "%" : "") + (g.label === "matched" ? " · 학습 라벨 맞춤(같은 위험 묶음 대비)" : "") + (g.variant ? " · 점수 변형 " + ({ blend: "5·20일 혼합", neutral: "위험 묶음 중립", blendN: "혼합+중립" } as any)[g.variant] : ""), tone: fit.kind === "정상 범위" ? "ok" : "warn" },
        ...(g3.kind === "sim" && g.g3live ? [{ k: "실시간 장부(회수 감시)", v: n0(g.g3live.days) + "일 · " + pp(g.g3live.mx), hint: g.g3live.revoke ? "평균 초과 < 0 → 회수" : (g.g3live.needDays ?? 10) + "일부터 평균 초과 < 0 이면 회수", tone: (g.g3live.revoke ? "bad" : "ok") as Tone }] : []),
        ...(g.g3sim ? [sim(g.g3sim, "③ 모의(측정 · 판정 전)")] : []),
      ]} />
    </div>);
}

export function OmniQ({ d, head }: { d: any; head: ReactNode }) {
  const q = d.omniQ || {}, us = q.us, kr = q.kr;
  const [mk, setMk] = useState<"us" | "kr">(us ? "us" : "kr");
  const [oqs, setOqs] = useState<any>(null);   // [V33.631] 실제 모델 구조(/api/omniq-struct) — 없으면 요약 그림
  const [pbv, setPbv] = useState<any>(() => cached("/api/playbook"));   // [V33.656] 매매법 AI 가 실제로 쓰는 후보 폭(학습기 검증이 고름)
  useEffect(() => { let on = true; getJSON("/api/playbook").then((j) => { if (on && j) setPbv(j); }).catch(() => {}); return () => { on = false; }; }, []);
  useEffect(() => { let on = true; setOqs(cached("/api/omniq-struct?mkt=" + mk)); getJSON("/api/omniq-struct?mkt=" + mk).then((j) => { if (on) setOqs(j && !j.empty ? j : null); }).catch(() => {}); return () => { on = false; }; }, [mk]);
  const net = useMemo(() => omniqNet(d, mk, oqs && !oqs.empty ? oqs : null), [d, mk, oqs]);
  /* [V33.685] 고른 노드 카드 — 머리(5일·20일)는 관문 막대 · 피처는 gain·분기 · 묶음은 피처 수(그림이 아는 실제 값만) */
  const extra = useMemo(() => (sc: any, id: number) => {
    const nm = String(sc.name[id] || ""), role = String((sc.role && sc.role[id]) || ""), v = q[mk] && q[mk].view;
    const hm = /^머리 · (5일|20일) 순위/.exec(nm);
    if (hm && v) {
      const g = hm[1] === "5일" ? v.gate : v.gate20, s0 = hm[1] === "5일" ? v.state : v.state20;
      if (!g) return null;
      const g1 = g.g1 || {}, g2 = g.g2 || {}, g3 = g.g3 || {}, sim3 = g3.kind === "sim" ? g3 : g.g3sim;
      const meters: any[] = [
        { k: "① 상위 10% 승률 (하한)", v: g1.mu != null ? (g1.mu * 100).toFixed(1) + "% (" + (g1.lb * 100).toFixed(1) + "%)" : "—", frac: g1.mu != null ? (g1.mu - .45) / .15 : 0, mark: (.5 - .45) / .15 },
        { k: "① t (기준 " + (g1.needT ?? 3) + ")", v: f1(g1.t, 2), frac: (+g1.t || 0) / 20, mark: (g1.needT ?? 3) / 20 },
        sim3 ? { k: "③ 모의 시뮬레이션 · 맞춤 초과" + (g3.kind === "sim" ? "" : "(측정)"), v: pp(sim3.mx) + (sim3.ok ? " ✓" : " ✗"), frac: .5 + (+sim3.mx || 0) * 50, mark: .5, warn: !sim3.ok }
             : { k: "③ 모의 시뮬레이션 · 맞춤 기준", v: "측정 대기", frac: 0, warn: true },
      ];
      return { state: { label: (ST[s0] || ["—"])[0], tone: s0 === "speak" ? "ok" : s0 === "prov" ? "warn" : "shade" } as any,
        specs: [{ k: "② 비용 뺀 초과 구간", v: (g2.pos ?? "—") + " / " + ((g2.folds || []).length || "—") }, { k: "실시간 장부", v: (g.g3live ? n0(g.g3live.days) : n0(g3.days)) + "일" },
                { k: "오늘 국면", v: (sim3 && sim3.byReg && (sim3.byReg.find((b: any) => b.reg === sim3.regNow) || {}).ko) || "—" }, { k: "적합 진단", v: (g.fit && g.fit.kind) || "—" }], meters };
    }
    const fm = /gain 비중 ([\d.]+)%(?: · 분기 (\d+)회)?/.exec(role);
    if (fm) return { specs: [{ k: "gain 비중", v: fm[1] + "%" }, { k: "분기", v: fm[2] != null ? fm[2] + "회" : "—" }, { k: "묶음", v: role.split(" · ")[0] }, { k: "시장", v: MK[mk] }],
      state: fm[2] === "0" ? { label: "이 모델에선 안 씀", tone: "shade" } as any : undefined };
    return null;
  }, [q, mk]);
  if (!us && !kr) return <div>{head}<Empty>OMNI-Q 가 아직 올라오지 않았습니다.</Empty></div>;
  const st = (r: any) => (r && r.view && ST[r.view.state]) || ["—", "idle"] as [string, Tone];
  /* [V33.656] 시장 상태 = 5일·20일 머리 중 나은 쪽 · 5일/20일을 같이 적는다(20일 머리가 잠정인데 '섀도우' 로만 보이던 문제) */
  const RK: Record<string, number> = { speak: 3, prov: 2, shadow: 1 };
  const st2 = (r: any): [string, Tone] => { const v = r && r.view; if (!v) return ["—", "idle"];
    const b = v.state20 && (RK[v.state20] || 0) > (RK[v.state] || 0) ? v.state20 : v.state; return [(ST[v.state] || ["—"])[0] + " / " + (ST[v.state20] || ["—"])[0], (ST[b] || ["—", "idle"])[1] as Tone]; };
  const cd = (m: "us" | "kr") => { const v = pbv && pbv.markets && pbv.markets[m] && pbv.markets[m].daily && pbv.markets[m].daily.val; if (!v) return null;
    return v.candQ ? (v.candHead && v.candHead !== "5" ? (v.candHead === "avg" ? "평균" : v.candHead + "일") : "5일") + " 상위 " + Math.round((1 - v.candQ) * 100) + "%" : "거름 없음"; };
  const groups = (us && us.featGroups) || (kr && kr.featGroups) || null;
  const top = (r: any) => ((r && r.featTop) || []).slice(0, 15).map((f: any) => ({ name: f.name, v: f.share }));
  return (
    <div>
      {head}
      <div className="mt-4"><Kpis items={[
        { k: "미국 5일 / 20일 머리", v: st2(us)[0], hint: us ? "피처 " + n0(us.nFeat) + " · " + n0(us.n) + "종목 · " + ago(us.view && us.view.scoredAt) : undefined, tone: st2(us)[1] },
        { k: "한국 5일 / 20일 머리", v: st2(kr)[0], hint: kr ? "피처 " + n0(kr.nFeat) + " · " + n0(kr.n) + "종목 · " + ago(kr.view && kr.view.scoredAt) : undefined, tone: st2(kr)[1] },
        { k: "매매법 AI 후보", v: cd("us") || cd("kr") ? "美 " + (cd("us") || "—") : "—", hint: cd("kr") ? "韓 " + cd("kr") + " · 학습기 검증이 고른 폭" : "학습기 검증이 고른 폭" },
        { k: "학습", v: ago((us || kr).trainedAt), hint: (us || kr).learner || "lgb" },
      ]} /></div>
      <Tabs.Root defaultValue="s" className="mt-5">
        <Tabs.List className="flex gap-5 border-b border-line">
          {[["s", "신경망"], ["e", "관문"], ["f", "상세"]].map(([v, t]) => (
            <Tabs.Trigger key={v} value={v} className="-mb-px border-b-2 border-transparent pb-2 text-[13px] text-ink-3 data-[state=active]:border-rose data-[state=active]:text-ink">{t}</Tabs.Trigger>))}
        </Tabs.List>
        <Tabs.Content value="s" className="pt-4 outline-none">
          <div className="mb-2 flex gap-1.5">{(["us", "kr"] as const).filter((m) => q[m]).map((m) => <button key={m} onClick={() => setMk(m)} className={"rounded-sm px-2.5 py-1 text-[12px] " + (mk === m ? "bg-ink text-bg" : "bg-bg-3 text-ink-2")}>{MK[m]}</button>)}</div>
          {net ? <ModelNet sc={net} name="OMNI-Q" extra={extra} /> : <Empty>신경망을 그릴 자료가 없습니다.</Empty>}
          {groups ? <Section title="피처 묶음" aside={"총 " + n0(Object.values(groups).reduce((a: number, b: any) => a + (+b || 0), 0)) + "개"}>
            <Bars rows={Object.keys(groups).map((k) => ({ name: k, v: +groups[k] || 0, label: n0(groups[k]) + "개" }))} />
          </Section> : <Empty>피처 묶음은 다음 학습 회차부터 표시됩니다.</Empty>}
          {top(us).length > 0 && <Section title="미국 — 많이 쓴 피처" aside="gain 비중"><Bars rows={top(us)} unit="%" max={10} /></Section>}
          {top(kr).length > 0 && <Section title="한국 — 많이 쓴 피처" aside="gain 비중"><Bars rows={top(kr)} unit="%" max={10} /></Section>}
        </Tabs.Content>
        <Tabs.Content value="e" className="pt-1 outline-none">
          {["us", "kr"].map((m) => q[m] ? (
            <Section key={m} title={MK[m]} aside={<Badge tone={st2(q[m])[1]}>{st2(q[m])[0]}</Badge>}>
              <Gate g={q[m].view && q[m].view.gate} label="5일 머리" /><Gate g={q[m].view && q[m].view.gate20} label="20일 머리" />
            </Section>) : null)}
        </Tabs.Content>
        <Tabs.Content value="f" className="pt-4 outline-none"><Facts rows={[
          ["역할", "① 매매법 AI 의 후보 선별(美 " + (cd("us") || "—") + " · 韓 " + (cd("kr") || "—") + ") ② 자체 진입 — 잠정·발언 머리의 상위 10% 를 산다(잠정은 절반 크기 · 하루 3건 · 동시 6종목)"],
          ["5일 머리 학습 라벨", "美 " + (us && us.y5 === "blend" ? "5일·20일 순위 혼합" : "5일 순위") + " · 韓 " + (kr && kr.y5 === "blend" ? "5일·20일 순위 혼합(갈아타기 비용 ↓ · 관문 ② 1/4 → 3/4)" : "5일 순위") + " — 판정은 둘 다 5일 수익"],
          ["상태 뜻", "섀도우 = 기록만 · 발언 = 관문 ①② + ③ 모의 시뮬레이션(같은 날·같은 위험 묶음 대비 초과 · 앞 80% 달 t ≥ 2 · 최근 20% 초과 > 0 · 어느 국면도 확실히 지지 않음 · 오늘 국면 초과 > 0) 통과 → 정규 크기 · 실시간 장부 10일 이상 평균 초과 < 0 이면 회수 (종전 방식 회차는 잠정 = ①② 강함 → 절반 크기)"],
          ["미국 상위 10", us && (us.top10 || []).join(" · ")], ["한국 상위 10", kr && (kr.top10 || []).join(" · ")],
          ["미국 채점일", us && us.day], ["한국 채점일", kr && kr.day],
        ]} /></Tabs.Content>
      </Tabs.Root>
    </div>);
}
