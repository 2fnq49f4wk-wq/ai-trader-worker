/* [V33.612] 매매법 AI(Playbook-Sim) — 모델 구조창의 주력 모델.
   데이터는 /api/playbook 그대로(값을 지어내지 않는다): 시장별 검증 · 선택 규칙 비교 · 판정 구간에서 고른 매매법 · 매매법 정의. */
import { type ReactNode } from "react";
import { type Tone, f1, n0, ago } from "../models";
import { Badge, Bars, Empty, Facts, Kpis, Section } from "./ui";
import { PlaybookBook } from "./PlaybookBook";
import { PlaybookDeck } from "./PlaybookDeck";

const NAMES: Record<string, string> = {
  TREND_ALIGN: "추세 정렬", TR_BREAKOUT: "20일 돌파", RS_LEADER: "상대강도 상위", VT_TREND: "저변동 추세",
  TR_PULLBACK: "추세 눌림목", MA_PULLBACK: "20일선 지지", SN_RSI2: "RSI2 반등", HA_REV: "하이킨아시 전환",
  BB_LOW: "볼린저 하단", STOCH_CROSS: "스토캐스틱 교차", STOCH_OS_EXIT: "스토캐스틱 과매도 이탈",
  VOL_BREAKOUT: "거래량 돌파", VOL_REVERT: "거래량 급락 반등", SQUEEZE: "스퀴즈 돌파", XS_ARB: "5일 낙폭 과대",
  DUAL_MOM: "듀얼 모멘텀", HERD_REBOUND: "거래량 2차 파동",
    OS_DEEP: "깊은 과매도 반등", CAPIT_REV: "투매 반등",
    ICHIMOKU: "이치모쿠 구름 돌파", KELTNER: "켈트너 채널 돌파", DONCHIAN: "돈치안 55일 돌파", MACD_X: "MACD 교차", ENVELOPE: "이격도 반등",
    ELDER_RAY: "엘더 레이", WILLR: "윌리엄스 %R", CCI_REV: "CCI 반등", PSAR: "파라볼릭 SAR", TRIPLE_SCR: "삼중창",
    IBS_LOW: "IBS 저가 마감 반등", HI52_NEAR: "52주 고가 근접",
  GAP_FILL: "갭 메우기", PIVOT_BNC: "피봇 지지 반등",
  ORB: "시가 범위 돌파", DIP_REV: "장중 눌림 반등", STOCH5: "5분 스토캐스틱", MOM3: "5분 3봉 상승", VWAP_RE: "VWAP 회복",
};
const nm = (k: string) => NAMES[k] || k;
const pc = (v: any) => (v == null || isNaN(+v) ? "—" : (+v > 0 ? "+" : "") + (+v).toFixed(2) + "%");
const ruleTxt = (r: any) => (!r ? "—" : ({ lcb: "하한(평균−오차)", m: "평균", mpd: "하루당 평균", lcbpd: "하루당 하한" } as Record<string, string>)[r.score] + " · " + (r.level === "global" ? "매매법 전체 성적" : r.level === "regime" ? "국면 칸까지" : "상황 칸 전체")
  + (r.decay ? " · 최근 가중(반감 " + r.decay + "일)" : "") + (r.gate ? " · 최근 " + r.gate + "일 성적 스위치" : ""));
const MK: Record<string, string> = { us: "미국", kr: "한국" };

export function pbState(j: any): { label: string; tone: Tone } {
  const m = (j && j.markets) || {};
  if (m.us?.primary || m.kr?.primary) return { label: "주력", tone: "ok" };
  if (m.us || m.kr) return { label: "검증 중", tone: "warn" };
  return { label: "대기", tone: "idle" };
}


/* [V33.615] 구조 탭 = 매매법 현황(설명 없이 숫자만) — 지금 후보에서 뜬 수 · 지금 고른 수 · 판정 구간에서 고른 수 · 모의 평균·승률 · 보유 · 매도 규칙 */
function Market({ mk, r }: { mk: string; r: any }) {
  if (!r) return <Section title={MK[mk] + " 검증"}><Empty>학습기가 아직 이 시장 표를 올리지 않았습니다.</Empty></Section>;
  const one = (v: any, label: string) => {
    if (!v) return <p className="py-2 text-[12px] text-ink-3">{label} — 표 없음</p>;
    if (v.why) return <p className="py-2 text-[12px] text-ink-3">{label} — {v.why}</p>;
    const by = v.byPb || {}, rows = Object.keys(by).sort((a, b) => by[b] - by[a]).map((k) => ({ name: nm(k), v: by[k], label: by[k] + "건" }));
    return (
      <div className="mt-3">
        <div className="mb-2 flex items-center gap-2 text-[12.5px]"><span className="font-semibold">{label}</span><Badge tone={v.pass ? "ok" : "bad"}>{v.pass ? "통과" : "미통과"}</Badge><span className="text-[11px] text-ink-3">{v.cand || ""}</span></div>
        <Kpis items={[
          { k: "고른 매매법 평균", v: pc(v.mean), tone: v.mean > 0 ? "ok" : "bad" },
          { k: "뜬 것 아무거나", v: pc(v.base), hint: v.baseAll != null ? "후보마다 무작위 하나 · 겹침 제외(옛 전부 평균 " + pc(v.baseAll) + ")" : undefined },
          { k: "t (기준 ≥ 2)", v: f1(v.t, 2), tone: v.t >= 2 ? "ok" : "bad" },
          { k: "거래 · 승률", v: n0(v.n) + " · " + (v.win == null ? "—" : v.win + "%") },
        ]} />
        {Array.isArray(v.valCmp) && v.valCmp.length > 0 && (
          <table className="mt-3 w-full text-[12px]">
            <thead><tr className="text-left text-[11px] text-ink-3"><th className="py-1.5 font-normal">선택 규칙(검증 구간)</th><th className="font-normal">거래</th><th className="font-normal">평균</th><th className="font-normal">t</th><th className="font-normal">아무거나</th></tr></thead>
            <tbody className="bs-num">{v.valCmp.map((c: any, i: number) => { const sel = v.rule && c.rule && c.rule.score === v.rule.score && c.rule.level === v.rule.level;
              return <tr key={i} className="border-t border-line" style={{ color: sel ? "var(--bs-ok)" : "var(--bs-ink2)" }}><td className="py-1.5">{ruleTxt(c.rule)}{sel ? " ✓" : ""}</td><td>{n0(c.n)}</td><td>{pc(c.mean)}</td><td>{f1(c.t, 2)}</td><td>{pc(c.base)}</td></tr>; })}</tbody>
          </table>)}
        {Array.isArray(v.candCmp) && v.candCmp.length > 0 && (
          <table className="mt-3 w-full text-[12px]">
            <thead><tr className="text-left text-[11px] text-ink-3"><th className="py-1.5 font-normal">후보 폭(OMNI-Q 먼저?)</th><th className="font-normal">검증 구간</th><th className="font-normal">판정 평균</th><th className="font-normal">t</th><th className="font-normal">무작위</th><th className="font-normal">거래</th></tr></thead>
            <tbody className="bs-num">{v.candCmp.map((c: any, i: number) => { const sel = v.candQ === c.q;
              return <tr key={i} className="border-t border-line" style={{ color: sel ? "var(--bs-ok)" : "var(--bs-ink2)" }}><td className="py-1.5">{c.q > 0 ? "상위 " + Math.round((1 - c.q) * 100) + "%" : "거름 없음(전 종목)"}{sel ? " ✓" : ""}</td><td>{pc(c.val)}</td><td>{pc(c.mean)}</td><td>{f1(c.t, 2)}</td><td>{pc(c.base)}</td><td>{n0(c.n)}</td></tr>; })}</tbody>
          </table>)}
        {rows.length > 0 && <div className="mt-3"><div className="mb-1 text-[11px] text-ink-3">판정 구간에서 고른 매매법</div><Bars rows={rows} max={8} /></div>}
        {v.exitDiag && (
          <details className="mt-3">
            <summary className="cursor-pointer text-[11.5px] text-ink-3">손절 진단(기록만) — 지금 손절 vs 고정 % 손절만</summary>
            <table className="mt-2 w-full text-[11.5px]">
              <thead><tr className="text-left text-[11px] text-ink-3"><th className="py-1 font-normal">매매법</th><th className="font-normal">표본</th><th className="font-normal">지금 평균·승률</th><th className="font-normal">넓게 평균·승률</th></tr></thead>
              <tbody className="bs-num">{Object.keys(v.exitDiag).map((k) => { const e = v.exitDiag[k], c = e.cur || [], w = e.wide || [];
                return <tr key={k} className="border-t border-line text-ink-2"><td className="py-1 text-ink">{nm(k)}</td><td>{n0(c[0])}</td><td>{pc(c[1])} · {c[2] ?? "—"}%</td><td style={{ color: w[1] > c[1] ? "var(--bs-ok)" : undefined }}>{pc(w[1])} · {w[2] ?? "—"}%</td></tr>; })}</tbody>
            </table>
          </details>)}
      </div>);
  };
  return (
    <Section title={MK[mk] + " 검증"} aside={<span>{r.primary ? "주력 — AI_PRIMARY 퇴역" : "AI_PRIMARY 유지(독립 구간 통과 " + (r.indep || 0) + "/2 · 연속 " + (r.passStreak || 0) + "/2)"} · {r.brake && r.brake.on ? "실전 손실 제동 중(" + r.brake.n + "건 " + pc(r.brake.mean) + ")" : "제동 없음"} · 국면 {r.regime || "—"}{r.panic ? " · 공황 — 추세·모멘텀 쉼" : ""} · 표 {ago(r.ts)}</span>}>
      {one(r.daily && r.daily.val, "일봉 " + n0(r.daily && r.daily.cells) + "칸")}
      {one(r.intra && r.intra.val, "5분 단타 " + n0(r.intra && r.intra.cells) + "칸")}
    </Section>);
}

export function Playbook({ d, head }: { d: any; head: ReactNode }) {
  const us = d.markets?.us, kr = d.markets?.kr;
  const caps = d.caps || {};
  /* [V33.632] 새 구조관측(PlaybookDeck · 실제 표 수치) — 종전 매매법 카드·근거·상세는 표 탭 뒤에 그대로 */
  return (
    <div>
      {head}
      <div className="mt-5">
        <PlaybookDeck d={d} extra={[
          { label: "매매법 카드", node: <PlaybookBook d={d} /> },
          { label: "근거 · 청산 진단", node: <div><Market mk="us" r={us} /><Market mk="kr" r={kr} /></div> },
          { label: "운용 설정", node: <Facts rows={[
          ["후보", "OMNI-Q 5일 상위 미 " + Math.round((1 - (us?.daily?.val?.candQ ?? d.route?.candMin ?? 0.8)) * 100) + "% · 한 " + Math.round((1 - (kr?.daily?.val?.candQ ?? d.route?.candMin ?? 0.8)) * 100) + "% · 학습기 검증이 20·40·60% 중 고름"],
          ["일봉 진입 시간", "마감 전 " + (d.route?.dailyEntryWin ?? 60) + "분(시뮬 = 신호 봉 종가 체결)"],
          ["단타 진입", "마감까지 " + (d.route?.intraMinToClose ?? 30) + "분 넘게 남았을 때 · 사이클당 분봉 조회 " + (d.route?.intraFetchMax ?? "—") + "종목"],
          ["성공확률 하한", "없음(기대값으로 고름)"],
          ["통과 기준", "손대지 않은 마지막 20% 구간: 평균 > 0 · t ≥ 2 · 뜬 것 아무거나보다 높음 · 표본 ≥ 30"],
          ["시험 크기", "×" + (caps.trial?.mult ?? "—") + " · 하루 " + (caps.trial?.maxPerDay ?? "—") + " · 동시 " + (caps.trial?.maxOpen ?? "—")],
          ["주력 크기", "×" + (caps.primary?.mult ?? "—") + " · 하루 " + (caps.primary?.maxPerDay ?? "—") + " · 동시 " + (caps.primary?.maxOpen ?? "—")],
          ["미국 선택 규칙", ruleTxt(us?.daily?.val?.rule)], ["한국 선택 규칙", ruleTxt(kr?.daily?.val?.rule)],
          ["표 갱신", "미 " + ago(us?.ts) + " · 한 " + ago(kr?.ts)],
        ]} /> },
        ]} />
      </div>
    </div>
  );
}
