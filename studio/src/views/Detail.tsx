import { type ReactNode, useEffect, useRef, useState } from "react";
import * as Tabs from "@radix-ui/react-tabs";
import { MODELS, type ModelKey, stateOf, HZ, f1, pctv, n0, ago, toneColor } from "../models";
import { Badge, Bars, Empty, Facts, Kpis, type KpiT, Section } from "./ui";
import { OmniStage } from "./OmniStage";

type Built = { kpis: KpiT[]; structure: ReactNode; evidence: ReactNode; facts: [string, ReactNode][] };

const feats = (d: any) => (d.topFeatures || d.inputFeatures || []).filter((f: any) => f && f.name)
  .sort((a: any, b: any) => (b.strength || 0) - (a.strength || 0))
  .map((f: any) => ({ name: f.name, role: f.role, v: f.w != null ? f.w : (f.strength || 0), label: f.w != null ? (f.w >= 0 ? "+" : "") + f.w.toFixed(3) : undefined }));

function trees(d: any): Built {
  const t = d.trust || {};
  return {
    kpis: [
      { k: "검증 정확도", v: pctv(d.valAcc) },
      { k: "신뢰 하한", v: pctv(d.valAccLB), hint: t.mindAcc != null ? "위원장 하한 " + pctv(t.mindAcc) + " 대비" : undefined, tone: (t.trusted ? "ok" : "bad") },
      { k: "투표 가중", v: t.wGbdt != null ? f1(t.wGbdt, 2) : "—", hint: t.trusted ? "투표 중" : "억제(0)" },
      { k: "나무", v: n0(d.nTrees), hint: d.n ? "표본 " + n0(d.n) : undefined },
    ],
    structure: <Section title="갈림을 가장 많이 만든 입력" aside="분기 수 기준"><Bars rows={(d.topFeatures || []).map((f: any) => ({ name: f.name, role: f.role, v: f.splits || f.strength || 0, label: f.splits != null ? f.splits + "회" : undefined }))} /></Section>,
    evidence: <Section title="입력별 영향력" aside="최대 대비"><Bars rows={feats(d)} unit="%" /></Section>,
    facts: [["모델", d.model], ["학습", ago(d.trainedAt)], ["섀도우", d.shadow ? "예" : "아니오"], ["자기 정확도", pctv(t.selfAcc)]],
  };
}

const BUILD: Record<string, (d: any, ov: any) => Built> = {
  mind: (d) => ({
    kpis: [
      { k: "검증 정확도", v: pctv(d.valAcc), hint: "규칙엔진 " + pctv(d.ruleAcc) },
      { k: "신뢰 하한", v: pctv(d.valAccLB), tone: "ok" },
      { k: "학습 창", v: n0(d.trainWindow || d.n), hint: "전체 풀 " + n0(d.poolSamples) },
      { k: "전문가", v: String((d.experts || []).length) + "개", hint: "FM k=" + (d.fmK ?? "—") },
    ],
    structure: <Section title="전문가 결합 가중" aside="스태킹 계수(±)"><Bars signed rows={(d.experts || []).map((e: any) => ({ name: e.name, v: e.weight, label: (e.weight >= 0 ? "+" : "") + e.weight.toFixed(3) }))} /></Section>,
    evidence: <Section title="입력별 영향력" aside="최대 대비"><Bars rows={feats(d)} unit="%" /></Section>,
    facts: [["로그손실", f1(d.valLogLoss, 4)], ["FM 단독", pctv(d.fmAcc)], ["실시간 감시", d.guard ? (d.guard.distrust ? "불신" : "정상") + " · " + (d.guard.liveN ?? 0) + "건" : null], ["학습", ago(d.trainedAt)]],
  }),
  gbdt: trees, xgb: trees, lgb: trees, cat: trees,
  memo: (d) => ({
    kpis: [
      { k: "검증 정확도", v: pctv(d.valAcc), hint: "기준율 " + pctv(d.baseRate) },
      { k: "홀드아웃 IC t", v: f1(d.valICt, 2), hint: "문턱 1.65", tone: d.valICt >= 1.65 ? "ok" : "bad" },
      { k: "전진 IC t", v: f1(d.fwdICt, 2), hint: n0(d.fwdN) + "건 · " + (d.fwdDays ?? "—") + "일" },
      { k: "원형", v: String(d.K ?? "—"), hint: "학습 " + n0(d.n) + "행" },
    ],
    structure: <Section title="기억된 상황(원형) — 승률 높은 순" aside="원형마다 학습 행 수">
      <ul className="divide-y divide-line border-y border-line">
        {(d.protos || []).slice(0, 8).map((p: any) => (
          <li key={p.i} className="py-2.5">
            <div className="flex items-baseline justify-between gap-3 text-[12.5px]"><span className="bs-num text-ink">#{p.i}</span><span className="bs-num text-ink-2">승률 {pctv(p.winRate)} · 평균 {f1(p.avgPnl, 2)}% · {n0(p.n)}행</span></div>
            <div className="mt-1 flex flex-wrap gap-1">{(p.marks || []).map((m: any) => <span key={m.name} className="bs-num rounded-sm bg-bg-3 px-1.5 py-[1px] text-[10.5px] text-ink-2">{m.name} {m.z > 0 ? "+" : ""}{m.z}</span>)}</div>
          </li>))}
      </ul></Section>,
    evidence: <Empty>원형 모델은 입력별 가중을 따로 갖지 않습니다 — 위 원형의 특징(z)이 근거입니다.</Empty>,
    facts: [["합류 판정", d.admit && d.admit.why], ["메모", d.note]],
  }),
  seq: (d) => ({
    kpis: [
      { k: "검증 정확도", v: pctv(d.valAcc) },
      { k: "신뢰 하한", v: pctv(d.valAccLB), hint: "블록 IC t " + f1(d.valICt, 2), tone: d.trusted ? "warn" : "bad" },
      { k: "투표 지분", v: f1(d.w, 3), hint: d.trusted ? "잠정 합류" : "보류" },
      { k: "구조", v: `${d.layers}×${d.heads}`, hint: `블록×헤드 · L=${d.L} · d=${d.d}` },
    ],
    structure: <Section title="어텐션 — 어느 봉이 어느 봉을 보는가" aside="행=보는 봉 · 열=보이는 봉"><Attn d={d} /></Section>,
    evidence: <Section title="입력별 영향력" aside="최대 대비"><Bars rows={feats(d)} unit="%" /></Section>,
    facts: [["합류 경로", d.admitWhy], ["파라미터", n0(d.params)], ["검증 표본", n0(d.valN)], ["정합", d.probeMaxDiff != null ? "오차 " + d.probeMaxDiff + " (" + d.probeN + "건)" : null], ["학습", ago(d.trainedAt)]],
  }),
  dualbull: dual, dualbear: dual,
  omni: (d) => {
    const ok = (d.headsOk || []).length, H = d.heads || [];
    return {
      kpis: [
        { k: "쓸 수 있는 지평", v: ok + " / " + H.length, tone: ok ? "ok" : "shade", hint: ok ? "문턱 통과" : "섀도우 — 매매에 안 씀" },
        { k: "전진 정확도", v: d.fwdAcc != null ? f1(d.fwdAcc) + "%" : "—", hint: "무실력 50% · " + n0(d.fwdN) + "건", tone: d.fwdAcc > 50 ? "ok" : "bad" },
        { k: "학습 / 홀드아웃", v: shortN(d.nTrain) + " / " + shortN(d.nHold), hint: n0(d.nSym) + "종목" },
        { k: "학습·추론 정합", v: d.probeMaxDiff != null && d.probeMaxDiff <= 1e-9 ? "일치" : "확인", hint: "오차 " + (d.probeMaxDiff != null ? d.probeMaxDiff.toExponential(0) : "—"), tone: "ok" },
      ],
      structure: <>
        <OmniStage d={d} />
        <Section title="지평별 성적" aside="홀드아웃 정확도 · 무실력 대비"><Horizons heads={H} /></Section>
      </>,
      evidence: <>
        <Section title="입력 묶음이 만든 갈림" aside="gain 비중"><Bars rows={(d.groups || []).map((g: any) => ({ name: g.name, v: g.share }))} unit="%" /></Section>
        <Section title="가장 많이 쓴 입력" aside="gain 비중"><Bars rows={(d.top || []).map((g: any) => ({ name: g.name, v: g.share }))} unit="%" /></Section>
      </>,
      facts: [["라벨", d.label === "xsec" ? "동료 대비 상대(같은 시각 중앙값보다 잘할 확률)" : d.label], ["나무", n0(d.nTrees) + "그루 · 마디 " + n0(d.nodes) + " · 조기종료 " + (d.bestIter ?? "—")],
        ["나무 구성", d.gbdt ? d.gbdt.name + " — " + d.gbdt.why : null], ["시드", (d.seeds ?? "—") + "개 · 불일치 " + f1(d.seedDisagree, 4)],
        ["패널", d.panelDay ? d.panelDay + " · " + n0(d.panelN) + "종목" : "없음"], ["판", "v" + (d.v ?? "—") + (d.featVerOk ? " (맞음)" : " (불일치)")], ["학습", ago(d.trainedAt)]],
    };
  },
};

function shortN(v: any) { if (v == null) return "—"; v = +v; return v >= 1e6 ? (v / 1e6).toFixed(1) + "M" : v >= 1e3 ? Math.round(v / 1e3) + "K" : String(v); }

function dual(d: any): Built {
  const noSkill = d.baseRate != null ? Math.max(d.baseRate, 1 - d.baseRate) : null;
  return {
    kpis: [
      { k: "검증 정확도", v: pctv(d.valAcc), hint: noSkill != null ? "무실력 " + pctv(noSkill) : undefined },
      { k: "블록 IC", v: f1(d.valICBlock, 3), hint: "t " + f1(d.valICt, 2) + " (문턱 " + f1(d.tMinUsed, 2) + ")", tone: d.holdPass ? "ok" : "bad" },
      { k: "전진 IC t", v: f1(d.fwdICt, 2), hint: n0(d.fwdN) + "건 · " + (d.fwdDays ?? "—") + "일" },
      { k: "결합 머리", v: String(d.head || "—").toUpperCase(), hint: d.admit && d.admit.admit ? "합류" : "보류" },
    ],
    structure: <Section title="머리 넷 중 무엇을 쓰나" aside="IC 하한이 가장 높은 머리">
      <table className="w-full text-[12.5px]"><thead><tr className="text-left text-[11px] text-ink-3"><th className="py-1.5 font-normal">머리</th><th className="font-normal">정확도</th><th className="font-normal">IC</th><th className="font-normal">t</th><th className="font-normal">IC 하한</th></tr></thead>
        <tbody className="bs-num">{(d.heads || []).map((h: any) => (
          <tr key={h.head} className="border-t border-line" style={h.win ? { color: "var(--bs-ok)" } : { color: "var(--bs-ink2)" }}>
            <td className="py-2">{h.head}{h.win ? " ✓" : ""}</td><td>{pctv(h.acc)}</td><td>{f1(h.ic, 3)}</td><td>{f1(h.icT, 2)}</td><td>{f1(h.icLB, 3)}</td></tr>))}</tbody></table>
    </Section>,
    evidence: <Section title="방향별 계수" aside="+ 오를 쪽 · − 내릴 쪽"><Bars signed rows={(d.topFeatures || []).map((f: any) => ({ name: f.name, role: f.role, v: f.w, label: (f.w >= 0 ? "+" : "") + (+f.w).toFixed(3) }))} /></Section>,
    facts: [["합류 판정", d.admit && d.admit.why], ["기준율", pctv(d.baseRate)], ["검증 표본", n0(d.valN) + " (원본 " + n0(d.valNRaw) + ")"], ["메모", d.note], ["학습", ago(d.trainedAt)]],
  };
}

function Horizons({ heads }: { heads: any[] }) {
  const lo = 45, hi = 60, sc = (v: number) => Math.max(0, Math.min(100, (v - lo) / (hi - lo) * 100));
  const whys = Array.from(new Set(heads.filter((h) => !h.ok && h.why).map((h) => h.why)));
  const common = whys.length === 1 ? whys[0] : null;
  return (
    <>
    {common && <p className="mb-2 text-[12px] text-shade">모든 지평: {common}</p>}
    <ul className="divide-y divide-line border-y border-line">
      {heads.map((h) => (
        <li key={h.hz} className="grid grid-cols-[44px_minmax(0,1fr)_58px] items-center gap-3 py-2.5">
          <span className="text-[13px] font-semibold">{HZ[h.hz] || h.hz}</span>
          <div className="relative h-[6px] rounded-sm bg-bg-3">
            {h.acc != null && <span className="absolute inset-y-0 left-0 rounded-sm" style={{ width: sc(h.acc) + "%", background: h.ok ? "var(--bs-ok)" : "var(--bs-shade)" }} />}
            {h.noSkill != null && <span className="absolute -top-[3px] h-[12px] w-[2px] bg-ink-3" style={{ left: sc(h.noSkill) + "%" }} title={"무실력 " + h.noSkill + "%"} />}
          </div>
          <span className="bs-num text-right text-[12px] text-ink-2">{h.acc != null ? f1(h.acc) + "%" : "—"}</span>
          <span />
          <p className="col-span-2 -mt-1 text-[11px] leading-snug text-ink-3">{[h.ok ? "문턱 통과" : common ? "" : (h.why || "문턱 미달"), h.auc != null ? "AUC " + h.auc.toFixed(3) : "", h.n != null ? n0(h.n) + "행" : ""].filter(Boolean).join(" · ")}</p>
        </li>))}
    </ul>
    </>
  );
}

function Attn({ d }: { d: any }) {
  const [blk, setBlk] = useState(0), [head, setHead] = useState(-1);
  const ref = useRef<HTMLCanvasElement>(null);
  const A = d.attnByBlock || [];
  useEffect(() => {
    const c = ref.current; if (!c || !A[blk]) return;
    const heads = head < 0 ? A[blk] : [A[blk][head]], L = (heads[0] || []).length; if (!L) return;
    const W = c.clientWidth, cell = W / L, dpr = Math.min(devicePixelRatio || 1, 2);
    c.width = Math.round(W * dpr); c.height = Math.round(W * dpr); const x = c.getContext("2d")!; x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, W, W);
    for (let r = 0; r < L; r++) {
      const row = Array.from({ length: L }, (_, k) => heads.reduce((s: number, h: any) => s + ((h && h[r] && h[r][k]) || 0), 0) / heads.length);
      const m = Math.max(...row), mn = Math.min(...row), sp = Math.max(1e-9, m - mn);   // 행마다 최소~최대로 펼친다(고르게 보면 다 같은 색)
      for (let k = 0; k < L; k++) { const q = (row[k] - mn) / sp; x.fillStyle = `rgba(255,92,134,${(.04 + .96 * q * q).toFixed(3)})`; x.fillRect(k * cell + .5, r * cell + .5, cell - 1, cell - 1); }
    }
  }, [blk, head, d]);
  if (!A.length) return <Empty>어텐션 표본이 없습니다.</Empty>;
  const Chip = ({ on, onClick, children }: any) => <button onClick={onClick} className={"rounded-sm px-2 py-1 text-[11.5px] " + (on ? "bg-ink text-bg" : "bg-bg-3 text-ink-2")}>{children}</button>;
  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-1.5">
        {A.map((_: any, i: number) => <Chip key={i} on={blk === i} onClick={() => setBlk(i)}>블록 {i + 1}</Chip>)}
        <span className="mx-1 w-px bg-line" />
        <Chip on={head < 0} onClick={() => setHead(-1)}>헤드 평균</Chip>
        {(A[blk] || []).map((_: any, i: number) => <Chip key={i} on={head === i} onClick={() => setHead(i)}>헤드 {i + 1}</Chip>)}
      </div>
      <canvas ref={ref} className="aspect-square w-full max-w-[360px] rounded-sm bg-bg-2" />
      <p className="mt-2 text-[11px] text-ink-3">왼쪽 위가 가장 오래된 봉, 오른쪽 아래가 최근 봉입니다. 진할수록 그 봉을 많이 봅니다(행마다 최대 대비).</p>
    </div>
  );
}

function Overview({ ov }: { ov: any }) {
  const R = ov.roster || [], C = ov.combine || {}, T = ov.tally || {};
  const exp = new Map<string, any>(); [...(ov.experts || []), ...(ov.dual || [])].forEach((e: any) => exp.set(e.name, e));
  const voting = R.filter((r: any) => r.state === "on" || r.state === "prov");
  const Step = ({ n, t, children }: any) => (
    <li className="relative border-l border-line pb-5 pl-5 last:pb-0">
      <span className="bs-num absolute -left-[9px] top-0 flex h-[18px] w-[18px] items-center justify-center rounded-full bg-bg-3 text-[10px] text-ink-2">{n}</span>
      <h5 className="text-[13px] font-semibold">{t}</h5><div className="mt-1.5 text-[12.5px] text-ink-2">{children}</div>
    </li>);
  return (
    <ol className="mt-1">
      <Step n="1" t={`모델마다 확률을 낸다 — 지금 ${voting.length}개가 반영`}>
        <ul className="divide-y divide-line border-y border-line">
          {R.map((r: any) => { const s = stateOf(r), e = exp.get(r.key) || {};
            return (<li key={r.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-2">
              <div className="min-w-0"><div className="truncate text-[12.5px] text-ink">{r.name}</div><div className="truncate text-[11px] text-ink-3">{r.why}</div></div>
              <div className="text-right"><Badge tone={s.tone}>{s.label}</Badge><div className="bs-num mt-0.5 text-[11px] text-ink-3">{[e.accLB != null ? "하한 " + e.accLB + "%" : e.valAcc != null ? "정확도 " + e.valAcc + "%" : "", r.mult != null && r.mult !== 1 && r.mult > 0 ? "×" + (+r.mult).toFixed(2) : ""].filter(Boolean).join(" · ")}</div></div>
            </li>); })}
        </ul>
      </Step>
      <Step n="2" t="실력(IC)만큼 가중해 합친다">
        IC 온도 <b className="bs-num text-ink">{C.icTemp ?? "—"}</b> · IC 범위 <span className="bs-num">{(C.icClamp || []).join(" ~ ")}</span> · 위원 {C.trimMin ?? "—"}명 이상이면 양끝 <span className="bs-num">{C.trimFrac != null ? Math.round(C.trimFrac * 100) + "%" : "—"}</span>를 잘라낸다(한 위원이 끌고 가지 않게).
      </Step>
      <Step n="3" t="확률을 실제 빈도에 맞춘다(보정)">
        {C.cal ? <>방식 <b className="text-ink">{C.cal.mode}</b> · 보정 오차 <span className="bs-num">{C.cal.eceRaw}% → <b className="text-ink">{C.cal.ece}%</b></span></> : "—"}
      </Step>
      <Step n="4" t="관측만 하는 모델">
        OMNI — {ov.omni ? (ov.omni.headsOk || []).length + " / " + (ov.omni.heads || []).length + " 지평 통과 · 실거래에 쓰지 않고 성적만 잰다" : "없음"}
      </Step>
      <p className="mt-4 text-[11px] text-ink-3">좌석 {T.seats ?? "—"} · 정식 {T.on ?? "—"} · 잠정 {T.prov ?? "—"} · 지금 투표 {T.live ?? "—"}</p>
    </ol>
  );
}

export function Detail({ model, d, ov, onRefresh, busy }: { model: ModelKey; d: any; ov: any; onRefresh: () => void; busy: boolean }) {
  const meta = MODELS.find((m) => m.key === model)!;
  const rost = ((d && d.roster) || (ov && ov.roster) || []).find((r: any) => r.key === meta.roster);
  const s = stateOf(rost);
  const head = (
    <header className="flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2"><h3 className="text-[22px] font-semibold tracking-tight">{meta.name}</h3>{model !== "overview" && <Badge tone={s.tone}>{s.label}</Badge>}</div>
        <p className="mt-0.5 text-[13px] text-ink-2">{meta.what}</p>
        {rost && rost.why && <p className="mt-1 text-[12px]" style={{ color: toneColor[s.tone] }}>{rost.why}</p>}
      </div>
      <button onClick={onRefresh} disabled={busy} className="shrink-0 rounded-sm border border-line px-2.5 py-1 text-[12px] text-ink-2 disabled:opacity-40">{busy ? "불러오는 중" : "새로고침"}</button>
    </header>
  );
  if (!d) return <div>{head}<Empty>불러오는 중…</Empty></div>;
  if (model === "overview") {
    const T = d.tally || {}, C = d.combine || {};
    return (<div>{head}<div className="mt-4"><Kpis items={[
      { k: "투표 중", v: (T.live ?? "—") + "명", hint: "좌석 " + (T.seats ?? "—") + " · 정식 " + (T.on ?? "—") + " · 잠정 " + (T.prov ?? "—") },
      { k: "보정 오차", v: C.cal ? C.cal.ece + "%" : "—", hint: C.cal ? "보정 전 " + C.cal.eceRaw + "%" : undefined, tone: "ok" },
      { k: "입력 칸", v: String(d.inputDim ?? "—"), hint: "피처 판 v" + (d.featVer ?? "—") },
      { k: "일봉 캐시", v: n0(d.cache && d.cache.dailyN), hint: (d.cache && d.cache.dailyDays) ? d.cache.dailyDays + "일" : undefined },
    ]} /></div><div className="mt-6"><Overview ov={d} /></div></div>);
  }
  if (!d.trained) return <div>{head}<Empty>{d.why || "아직 학습된 모델이 없습니다."}</Empty></div>;
  const b = (BUILD[model] || trees)(d, ov);
  return (
    <div>
      {head}
      <div className="mt-4"><Kpis items={b.kpis} /></div>
      <Tabs.Root defaultValue="s" className="mt-5">
        <Tabs.List className="flex gap-5 border-b border-line">
          {[["s", "구조"], ["e", "근거"], ["f", "상세"]].map(([v, t]) => (
            <Tabs.Trigger key={v} value={v} className="-mb-px border-b-2 border-transparent pb-2 text-[13px] text-ink-3 data-[state=active]:border-rose data-[state=active]:text-ink">{t}</Tabs.Trigger>))}
        </Tabs.List>
        <Tabs.Content value="s" className="pt-4 outline-none">{b.structure}</Tabs.Content>
        <Tabs.Content value="e" className="pt-1 outline-none">{b.evidence}</Tabs.Content>
        <Tabs.Content value="f" className="pt-4 outline-none"><Facts rows={b.facts} /></Tabs.Content>
      </Tabs.Root>
    </div>
  );
}
