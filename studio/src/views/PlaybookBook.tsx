/* [V33.620] 매매법 하나하나 — 사용자 10/15 "모델 구조 보는 거 매매법 각각 새로 디자인 · 지금 보기 매우 불편".
   왼쪽(위) = 매매법 카드(지금 뜸·고름·조율·문제) · 오른쪽(아래) = 고른 매매법: 진입 → 거르개 → 매수 → 청산 흐름 · 진단(청산 사유·국면별) ·
   조율이 걸어온 길 · 판정 구간 기본 vs 조율. 값은 /api/playbook 그대로(지어내지 않는다). */
import { useMemo, useState } from "react";

const NAMES: Record<string, string> = {
  TREND_ALIGN: "추세 정렬", TR_BREAKOUT: "20일 돌파", RS_LEADER: "상대강도 상위", VT_TREND: "저변동 추세", TR_PULLBACK: "추세 눌림목", MA_PULLBACK: "20일선 지지",
  SN_RSI2: "RSI2 반등", HA_REV: "하이킨아시 전환", BB_LOW: "볼린저 하단", STOCH_CROSS: "스토캐스틱 교차", STOCH_OS_EXIT: "스토캐스틱 과매도 이탈",
  VOL_BREAKOUT: "거래량 돌파", VOL_REVERT: "거래량 급락 반등", SQUEEZE: "스퀴즈 돌파", XS_ARB: "5일 낙폭 과대", DUAL_MOM: "듀얼 모멘텀", HERD_REBOUND: "거래량 2차 파동",
  OS_DEEP: "깊은 과매도 반등", CAPIT_REV: "투매 반등", ICHIMOKU: "이치모쿠 구름 돌파", KELTNER: "켈트너 채널 돌파", DONCHIAN: "돈치안 55일 돌파", MACD_X: "MACD 교차",
  ENVELOPE: "이격도 반등", ELDER_RAY: "엘더 레이", WILLR: "윌리엄스 %R", CCI_REV: "CCI 반등", PSAR: "파라볼릭 SAR", TRIPLE_SCR: "삼중창",
  ORB: "시가 범위 돌파", DIP_REV: "장중 눌림 반등", STOCH5: "5분 스토캐스틱", MOM3: "5분 3봉 상승", VWAP_RE: "VWAP 회복", GAP_FILL: "갭 메우기", PIVOT_BNC: "피봇 지지 반등",
};
/* 진입 조건(학습기 strategy_catalog · intra_fires 와 같은 뜻을 사람 말로) */
const ENTRY: Record<string, string> = {
  TREND_ALIGN: "20>50>200일선 정배열 · 종가가 20일선 위 · RSI14 45~72",
  TR_BREAKOUT: "20일 최고 종가 돌파 · 50일선 위 · 양봉 · 거래량 1.5배 이상",
  RS_LEADER: "전 종목 중 상대강도(수익률 순위) 상위 — 학습기가 매일 횡단면으로 판정",
  VT_TREND: "50일선 위 · 20일선>50일선 · ATR 4% 미만 · 20일 수익 플러스(조용한 상승)",
  TR_PULLBACK: "20일선>50일선 추세 중 20일선 ±4% 까지 눌린 뒤 양봉 · RSI14 37~68",
  MA_PULLBACK: "정배열 중 저가가 20일선을 건드리고 종가는 그 위 양봉",
  SN_RSI2: "200일선 위 상승 추세에서 RSI2 ≤ 12 · 종가 5일선 아래(단기 과매도)",
  HA_REV: "하이킨아시 음봉 두 개 뒤 첫 양봉 · 50일선 −3% 위",
  BB_LOW: "볼린저 하단 이하 · RSI14 20~38 · 양봉",
  STOCH_CROSS: "슬로우 스토캐스틱 과매도(%K ≤ 30)에서 %K 가 %D 상향 교차",
  STOCH_OS_EXIT: "%K 가 20 아래에서 위로 올라서는 양봉",
  VOL_BREAKOUT: "거래량 2배 이상 · 20일 최고 종가 돌파 · 50일선 위",
  VOL_REVERT: "거래량 3배 · 당일 −4~−18% · 저가권 마감 · RSI2 ≤ 8 · 200일선 위",
  SQUEEZE: "볼린저 폭이 120일 하위 10% 로 좁아진 뒤 상단 돌파",
  XS_ARB: "5일 낙폭이 전 종목 중 과대한 종목(롱 다리만) — 학습기 횡단면 판정",
  DUAL_MOM: "절대(수익 > 0) · 상대(전 종목 순위) 모멘텀 동시 — 학습기 횡단면 판정",
  HERD_REBOUND: "최근 6일 안 거래량 2.5배 양봉 뒤 고점 −5~−12% 조정 · 오늘 양봉",
  OS_DEEP: "RSI2 ≤ 5 · 볼린저 하단 아래 · 5일 −7% 이하 · RSI14 ≤ 35(추세 무관 · 폭락장)",
  CAPIT_REV: "거래량 2배 · 당일 −5~−25% · 20일선 −10% 이하(투매일 종가 매수)",
  ICHIMOKU: "종가가 구름 상단을 처음 넘음 · 전환선 > 기준선 · 구름 두께 5% 이하",
  KELTNER: "EMA20 + 2×ATR10 상단을 처음 넘는 양봉",
  DONCHIAN: "지난 55일 최고가를 처음 넘음(터틀)",
  MACD_X: "0선 아래 골든크로스 또는 0선 상향 돌파(시그널 위)",
  ENVELOPE: "어제 20일선 −7% 아래 · 오늘 그 선 위로 회복한 양봉",
  ELDER_RAY: "EMA13 상승 중 베어 파워(저가 − EMA13) 음수에서 반등",
  WILLR: "윌리엄스 %R 이 −80 이하에서 위로",
  CCI_REV: "CCI(20) 가 −100 이하에서 위로",
  PSAR: "파라볼릭 SAR 이 가격 아래로 뒤집힘(상승 전환)",
  TRIPLE_SCR: "EMA65(≈13주) 상승 · 어제 %K ≤ 30 · 오늘 어제 고가 돌파",
  ORB: "개장 첫 30분 고가를 위로 돌파",
  DIP_REV: "당일 고점 −1% 아래에서 반등 봉",
  STOCH5: "5분 스토캐스틱 과매도(≤ 25)에서 %K 상향 교차",
  MOM3: "5분봉 3개 연속 상승 · 합계 +0.5% 이상",
  VWAP_RE: "VWAP 아래에서 위로 회복",
  GAP_FILL: "−1.5% 이상 하락 갭 · 첫 1시간 안에 첫 봉 고가 회복",
  PIVOT_BNC: "전일 피봇 1차 지지(S1) 를 건드리고 반등 봉",
};
const FLT: Record<string, string> = { trend: "200일선 위만", noBear: "약세·폭락장 제외", calm: "ATR ≤ 4% · 당일 −4% 이상", up20: "20일선 > 50일선",
  notExt: "20일선 +8% 이내(과열 제외)", dip5: "5일 수익 ≤ 0(눌림 뒤)", rsiMid: "RSI14 40~65" };
const RCC: Record<string, string> = { 손절: "var(--bs-bad)", 본전: "var(--bs-ink3)", 익절: "var(--bs-ok)", 평균회귀: "#39d0ff", "기간 손실": "#f5c451", "보유 만기": "#a78bfa" };
const nm = (k: string) => NAMES[k] || k;
const pc = (v: any, d = 2) => (v == null || isNaN(+v) ? "—" : (+v > 0 ? "+" : "") + (+v).toFixed(d) + "%");
const tone = (v: any) => (v == null ? undefined : +v > 0 ? "var(--bs-ok)" : +v < 0 ? "var(--bs-bad)" : undefined);
type Mk = "us" | "kr";

function exitChips(p: any, intra: boolean): string[] {
  if (!p) return [];
  if (intra) return ["손절 −" + p.sl + "%", p.tpAt === "pc" ? "익절 전일 종가" : p.tpAt === "piv" ? "익절 피봇" : p.tpPct ? "익절 +" + p.tpPct + "%" : "익절 없음", p.bars ? "최대 " + p.bars * 5 + "분" : "장 끝까지", "장 마감 10분 전 정리"];
  const out = ["손절 min(" + p.stop + "%, ATR×" + (p.atr >= 99 ? "∞" : p.atr) + ")"];
  out.push(p.tpPct ? "익절 +" + p.tpPct + "%" : p.tpR ? "익절 " + p.tpR + "R" : "익절 없음");
  if (p.bePct) out.push("+" + p.bePct + "% 에 본전"); else if (p.be) out.push(p.be + "R 에 본전");
  if (p.mr) out.push("평균회귀 청산(MA5 위 · RSI2 ≥ 65)");
  if (p.tstop) out.push(p.tstop + "일 지나 손실이면 정리");
  out.push("최대 " + p.hold + "거래일");
  return out;
}

function Bar({ v, max, color }: { v: number; max: number; color?: string }) {
  return <span className="inline-block h-[7px] rounded-sm align-middle" style={{ width: Math.max(2, Math.min(100, (Math.abs(v) / (max || 1)) * 100)) + "%", background: color || "var(--bs-ink3)" }} />;
}

function Diag({ dg, title }: { dg: any; title: string }) {
  if (!dg) return <p className="text-[12px] text-ink-3">{title} — 진단 표본 부족(30건 미만)</p>;
  const rc = Object.entries(dg.rc || {}) as [string, number[]][];
  const rg = Object.entries(dg.reg || {}) as [string, number[]][];
  const mx = Math.max(...rg.map(([, x]) => Math.abs(x[1])), 0.5);
  return (
    <div>
      <div className="mb-2 text-[11px] text-ink-3">{title}</div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[["거래", dg.n.toLocaleString("ko-KR")], ["평균 순초과", pc(dg.mean)], ["승률", dg.win + "%"], ["이익 / 손실", pc(dg.avgW, 1) + " / " + pc(dg.avgL, 1)]].map(([k, v], i) => (
          <div key={i} className="rounded border border-line px-2.5 py-2"><div className="text-[10.5px] text-ink-3">{k}</div><div className="bs-num text-[15px]" style={{ color: i === 1 ? tone(dg.mean) : undefined }}>{v}</div></div>))}
      </div>
      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <div>
          <div className="mb-1 text-[11px] text-ink-3">어떻게 끝났나(비중 · 평균)</div>
          <div className="flex h-[10px] overflow-hidden rounded-sm">{rc.map(([k, x]) => <span key={k} title={k + " " + x[0] + "%"} style={{ width: x[0] + "%", background: RCC[k] || "var(--bs-ink3)" }} />)}</div>
          <table className="mt-2 w-full text-[11.5px]"><tbody className="bs-num">{rc.map(([k, x]) => (
            <tr key={k} className="border-t border-line"><td className="py-1"><span className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ background: RCC[k] }} />{k}</td><td className="text-right">{x[0]}%</td><td className="text-right" style={{ color: tone(x[1]) }}>{pc(x[1])}</td></tr>))}</tbody></table>
        </div>
        <div>
          <div className="mb-1 text-[11px] text-ink-3">국면별 평균</div>
          <table className="w-full text-[11.5px]"><tbody className="bs-num">{rg.map(([k, x]) => (
            <tr key={k} className="border-t border-line"><td className="w-[80px] py-1">{k}</td><td><Bar v={x[1]} max={mx} color={tone(x[1])} /></td><td className="w-[64px] text-right" style={{ color: tone(x[1]) }}>{pc(x[1])}</td><td className="w-[54px] text-right text-ink-3">{x[0]}</td></tr>))}</tbody></table>
        </div>
      </div>
    </div>);
}

export function PlaybookBook({ d }: { d: any }) {
  const [mk, setMk] = useState<Mk>(d.markets?.us ? "us" : "kr");
  const [f, setF] = useState("all");
  const M = d.markets?.[mk] || {};
  const D = M.daily?.pb || {}, I = M.intra?.pb || {};
  const tune = M.daily?.val?.tune || {}, gate = M.daily?.gate || {}, rule = M.daily?.val?.rule || {};
  const live = (d.live?.[mk]?.items || []) as any[];
  const by = M.daily?.val?.byPb || {};
  const rows = useMemo(() => [...Object.keys(D), ...Object.keys(I)].map((k) => {
    const isI = k in I, t = tune[k] || {};
    const fired = live.filter((x) => (x.fired || []).includes(k)), chosen = live.filter((x) => x.pb === k);
    const g = gate[k], off = !!(rule.gate && Array.isArray(g) && g[0] >= 15 && g[1] < 0);
    return { k, isI, p: isI ? I[k] : D[k], t, fired, chosen, off, sel: +(by[k] || 0), probs: (t.problems || []).length, tuned: t.prof === "tuned" };
  }).sort((a, b) => b.chosen.length - a.chosen.length || b.fired.length - a.fired.length || b.sel - a.sel), [D, I, tune, gate, rule, live, by]);
  const shown = rows.filter((r) => f === "all" || (f === "d" && !r.isI) || (f === "i" && r.isI) || (f === "p" && r.probs) || (f === "t" && r.tuned));
  const [sel, setSel] = useState<string | null>(null);
  const cur = rows.find((r) => r.k === sel) || shown[0];
  if (!rows.length) return <p className="text-[12px] text-ink-3">매매법 표가 아직 없습니다.</p>;
  const chip = (on: boolean, txt: string, onClick: () => void) => <button onClick={onClick} className={"rounded-sm px-2.5 py-1 text-[12px] " + (on ? "bg-ink text-bg" : "bg-bg-3 text-ink-2")}>{txt}</button>;
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {(["us", "kr"] as Mk[]).filter((m) => d.markets?.[m]).map((m) => chip(mk === m, m === "us" ? "미국" : "한국", () => setMk(m)))}
        <span className="mx-1 h-4 w-px bg-line" />
        {[["all", "전체 " + rows.length], ["d", "일봉"], ["i", "5분"], ["p", "문제 있음 " + rows.filter((r) => r.probs).length], ["t", "조율됨 " + rows.filter((r) => r.tuned).length]].map(([v, t]) => chip(f === v, t, () => setF(v)))}
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,330px)_minmax(0,1fr)]">
        <div className="bs-rail grid max-h-[720px] auto-rows-min grid-cols-2 gap-1.5 overflow-y-auto pr-1 lg:grid-cols-1">
          {shown.map((r) => (
            <button key={r.k} onClick={() => setSel(r.k)} className={"rounded border px-2.5 py-2 text-left " + (cur && cur.k === r.k ? "border-rose bg-bg-3" : "border-line")}>
              <div className="flex items-center gap-1.5"><span className="truncate text-[13px] text-ink">{nm(r.k)}</span><span className="ml-auto shrink-0 text-[10px] text-ink-3">{r.isI ? "5분" : "일봉"}</span></div>
              <div className="bs-num mt-1 flex flex-wrap gap-x-2.5 text-[11px] text-ink-3">
                <span>뜸 <b className={r.fired.length ? "text-ink" : ""}>{r.fired.length}</b></span><span>고름 <b className={r.chosen.length ? "text-ink" : ""}>{r.chosen.length}</b></span>
                {r.tuned && <span style={{ color: "var(--bs-ok)" }}>조율</span>}{r.probs > 0 && <span style={{ color: "var(--bs-warn, #f5c451)" }}>문제 {r.probs}</span>}{r.off && <span style={{ color: "var(--bs-bad)" }}>쉼</span>}
              </div>
            </button>))}
        </div>
        {cur && <Detail r={cur} mk={mk} gate={gate[cur.k]} gateOn={!!rule.gate} />}
      </div>
    </div>);
}

function Detail({ r, mk, gate, gateOn }: { r: any; mk: Mk; gate: any; gateOn: boolean }) {
  const t = r.t || {}, p = r.p || {};
  const steps: [string, string, string?][] = [
    ["진입 조건", ENTRY[r.k] || p.label || "—"],
    ["거르개", p.flt ? String(p.flt).split("+").map((x: string) => FLT[x] || x).join(" + ") : "없음(조율이 바꾸지 않음)", p.flt ? "조율" : undefined],
    ["매수", r.isI ? "5분봉 신호 봉 종가 · 마감 30분 전까지" : "마감 전 60분 안 · 신호 봉 종가"],
  ];
  const tb = t.test?.base, tt = t.test?.tuned;
  return (
    <div className="min-w-0 rounded border border-line">
      <div className="flex flex-wrap items-baseline gap-2 border-b border-line px-4 py-3">
        <h3 className="text-[17px] font-semibold tracking-tight text-ink">{nm(r.k)}</h3><span className="text-[11px] text-ink-3">{r.k} · {r.isI ? "5분 단타" : "일봉"} · {mk === "us" ? "미국" : "한국"}</span>
        <span className="bs-num ml-auto text-[11px] text-ink-3">지금 뜸 {r.fired.length} · 고름 {r.chosen.length}</span>
      </div>
      <div className="grid gap-0 sm:grid-cols-4">
        {steps.map(([h, b, tag], i) => (
          <div key={i} className="border-b border-line px-3 py-3 sm:border-r">
            <div className="flex items-center gap-1.5 text-[10.5px] text-ink-3"><span className="bs-num grid h-4 w-4 place-items-center rounded-full border border-line text-[9px]">{i + 1}</span>{h}{tag && <span className="rounded-sm px-1 text-[9.5px]" style={{ color: "var(--bs-ok)", border: "1px solid currentColor" }}>{tag}</span>}</div>
            <div className="mt-1.5 text-[12px] leading-snug text-ink-2">{b}</div></div>))}
        <div className="border-b border-line px-3 py-3">
          <div className="flex items-center gap-1.5 text-[10.5px] text-ink-3"><span className="bs-num grid h-4 w-4 place-items-center rounded-full border border-line text-[9px]">4</span>청산{t.prof === "tuned" && <span className="rounded-sm px-1 text-[9.5px]" style={{ color: "var(--bs-ok)", border: "1px solid currentColor" }}>조율</span>}</div>
          <div className="mt-1.5 flex flex-wrap gap-1">{exitChips(p, r.isI).map((c, i) => <span key={i} className="rounded-sm bg-bg-3 px-1.5 py-0.5 text-[11px] text-ink-2">{c}</span>)}</div></div>
      </div>
      <div className="space-y-5 px-4 py-4">
        {gateOn && Array.isArray(gate) && <p className="text-[12px]" style={{ color: gate[0] >= 15 && gate[1] < 0 ? "var(--bs-bad)" : "var(--bs-ink2)" }}>최근 성적 스위치 — 최근 끝난 모의 거래 {gate[0]}건 평균 {pc(gate[1])}{gate[0] >= 15 && gate[1] < 0 ? " → 지금은 쉰다" : " → 가동"}</p>}
        {(t.problems || []).length > 0 && (
          <div><div className="mb-1.5 text-[11px] text-ink-3">찾은 문제(기본 설정 · 판정 구간 전)</div>
            <ul className="space-y-1">{t.problems.map((x: string, i: number) => <li key={i} className="rounded border border-line px-2.5 py-1.5 text-[12px] text-ink-2">⚠ {x}</li>)}</ul></div>)}
        {r.isI ? <p className="text-[12px] text-ink-3">5분 단타 매매법은 정밀 조율 대상이 아닙니다(손절·익절·시간 고정 · 검증은 5분 표).</p> : <Diag dg={t.diag} title="기본 설정 진단(판정 구간 전 · OMNI-Q 후보 아닌 전 종목)" />}
        {t.prof === "tuned" && t.diagT && <Diag dg={t.diagT} title="조율 뒤 진단" />}
        {!r.isI && (t.path || []).length > 0 && (
          <div><div className="mb-1.5 text-[11px] text-ink-3">정밀 조율이 걸어온 길(한 칸씩 · 앞 40% 구간 · 달 묶음 t)</div>
            <ol className="flex flex-wrap items-center gap-1 text-[11.5px]">{t.path.map((s: string, i: number) => <li key={i} className="flex items-center gap-1">{i > 0 && <span className="text-ink-3">→</span>}<span className="rounded-sm bg-bg-3 px-1.5 py-0.5 text-ink-2">{s}</span></li>)}</ol>
            <p className="mt-1.5 text-[11.5px] text-ink-3">{t.prof === "tuned" ? "채택 — 기본 대비 t " + t.t + " · " + pc(t.dm) + "p · 확인 구간에서도 나음" : "채택 안 함 — 기본 대비 기준(t ≥ 3 · 확인 구간 개선)을 넘지 못해 기본 유지"}</p></div>)}
        {tb && (
          <div><div className="mb-1.5 text-[11px] text-ink-3">손대지 않은 판정 구간(뒤 20%)</div>
            <div className="bs-num grid grid-cols-2 gap-2 text-[12px]">
              <div className="rounded border border-line px-2.5 py-2"><div className="text-[10.5px] text-ink-3">기본</div>{pc(tb[1])} · 승률 {tb[2] ?? "—"}% · {tb[0]}건</div>
              <div className="rounded border border-line px-2.5 py-2"><div className="text-[10.5px] text-ink-3">조율</div>{tt ? <span style={{ color: tt[1] > tb[1] ? "var(--bs-ok)" : "var(--bs-bad)" }}>{pc(tt[1])} · 승률 {tt[2] ?? "—"}% · {tt[0]}건</span> : "—"}</div>
            </div></div>)}
        {r.fired.length > 0 && (
          <div><div className="mb-1.5 text-[11px] text-ink-3">지금 이 매매법이 뜬 후보</div>
            <div className="flex flex-wrap gap-1">{r.fired.slice(0, 24).map((x: any) => <span key={x.s} className="bs-num rounded-sm px-1.5 py-0.5 text-[11px]" style={{ background: x.pb === r.k ? "color-mix(in srgb, var(--bs-ok) 18%, transparent)" : "var(--bs-bg3)", color: x.pb === r.k ? "var(--bs-ok)" : "var(--bs-ink2)" }}>{x.nm || x.s}{x.pb === r.k ? " ✓" : ""}</span>)}</div></div>)}
      </div>
    </div>);
}
