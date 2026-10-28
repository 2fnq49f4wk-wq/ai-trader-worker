/* [V33.632] 매매법 AI 구조관측 — 새 디자인(관제실 톤 · 실제 표 수치). 데이터는 /api/playbook 그대로(값을 지어내지 않는다).
   판정 요약 → 판단 흐름 7단계(지금 쓰는 실제 값) → 실제 표(지금 쓰는 매매법 전부 · 규칙 비교 · 후보 폭 비교 · 5분 단타). 시장 전환 · 표 정렬. */
import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { ParamTab } from "./PlaybookFormula";

const POS = "#4FE3FF", NEG = "#FF9A4A", INK = "#E9F2FF", MUTE = "#8695AA", DIM = "#6F7E94", FAINT = "#56657A", HL = "#FFD166";
const PANEL = "#0A0F17", PANEL2 = "#0C121C", LINE = "#1B2738", ROWLINE = "#121B28", TRACK = "#111A27";
const MONO = 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace';

export const PB_NAMES: Record<string, string> = {
  TREND_ALIGN: "추세 정렬", TR_BREAKOUT: "20일 돌파", RS_LEADER: "상대강도 상위", VT_TREND: "저변동 추세", TR_PULLBACK: "추세 눌림목", MA_PULLBACK: "20일선 지지",
  SN_RSI2: "RSI2 반등", HA_REV: "하이킨아시 전환", BB_LOW: "볼린저 하단", STOCH_CROSS: "스토캐스틱 교차", STOCH_OS_EXIT: "스토캐스틱 과매도 이탈",
  VOL_BREAKOUT: "거래량 돌파", VOL_REVERT: "거래량 급락 반등", SQUEEZE: "스퀴즈 돌파", XS_ARB: "5일 낙폭 과대", DUAL_MOM: "듀얼 모멘텀", HERD_REBOUND: "거래량 2차 파동",
  OS_DEEP: "깊은 과매도 반등", CAPIT_REV: "투매 반등", ICHIMOKU: "이치모쿠 구름 돌파", KELTNER: "켈트너 채널 돌파", DONCHIAN: "돈치안 55일 돌파", MACD_X: "MACD 교차",
  ENVELOPE: "이격도 반등", ELDER_RAY: "엘더 레이", WILLR: "윌리엄스 %R", CCI_REV: "CCI 반등", PSAR: "파라볼릭 SAR", TRIPLE_SCR: "삼중창", IBS_LOW: "IBS 저가 마감 반등",
  HI52_NEAR: "52주 고가 근접", GAP_FILL: "갭 메우기", PIVOT_BNC: "피봇 지지 반등", ORB: "시가 범위 돌파", DIP_REV: "장중 눌림 반등", STOCH5: "5분 스토캐스틱",
  MOM3: "5분 3봉 상승", VWAP_RE: "VWAP 회복", GAP_GO: "갭 앤 고(5분)",
  // [V33.654] 문헌·실무 전략(2순위 보조) · 퇴출 매매법 수정판(+T 추세 · +TL 추세+주도주 · +V 거래량)
  FROG: "개구리 모멘텀", RESID_MOM: "잔차 모멘텀", RS_NEWHI: "상대강도 신고가", NR7_TREND: "NR7 추세 돌파", DARVAS: "다바스 박스",
  GAP_FILL_D: "갭 메움(일봉)", VOL_DRYUP_PB: "거래량 마른 눌림",
  SECTOR_LAG: "주도주 일시 부진", DIP_IN_LEADER5: "주도주 급락 매수", GAP_UP_HOLD3: "갭 상승 3일 유지",
  VOL_SURGE_HOLD: "거래량 급등 유지",   // [V33.659] 단타(5일 보유)
  MA5_DIP_LEAD: "주도주 5일선 눌림",   // [V33.665] 단타(2일 · 고변동 그룹만)
};
export const pbName = (k: string) => { const i = k.indexOf("+"); if (i < 0) return PB_NAMES[k] || k;
  const b = k.slice(0, i), f = k.slice(i + 1); return (PB_NAMES[b] || b) + " 수정판(" + ({ T: "추세", TL: "추세+주도주", V: "거래량" } as Record<string, string>)[f] + ")"; };
const fin = (x: any): x is number => typeof x === "number" && Number.isFinite(x);
const sg = (x: any, k = 2) => (fin(x) ? (x >= 0 ? "+" : "") + x.toFixed(k) : "—");
const n0 = (x: any) => (fin(x) ? x.toLocaleString("ko-KR") : "—");
const col = (x: any) => (!fin(x) ? MUTE : x > 0 ? POS : x < 0 ? NEG : INK);
const pos = (x: number, lim: number) => Math.max(0, Math.min(100, 50 + (x / lim) * 50));
const ruleName = (r: any): string => (!r ? "—" : r.cells ? "칸별 " + Object.keys(r.cells).length + "칸 · 기본 " + ruleName(r.def) : [r.score, r.level].concat(r.decay ? ["d" + r.decay] : []).concat(r.gate ? ["g" + r.gate] : []).concat(r.gveto ? ["거부권"] : []).join("·"));
// [V33.694] 국면 3단 · 종목 칸(중기 국면 | 변동성 그룹) 한글 이름표
const R3K: Record<string, Record<string, string>> = { L: { UP: "상승", DOWN: "하락", TURN: "전환" }, M: { UP: "상승", DOWN: "하락", FLAT: "보합" }, S: { SURGE: "폭등", UP: "상승", CALM: "보합", DOWN: "하락", CRASH: "폭락" } };
const cellName = (c: string) => { const [m, g] = String(c).split("|"); return "중기 " + (R3K.M[m] || m) + " · " + ({ "0": "저변동", "1": "중변동", "2": "고변동" } as any)[g] || g; };
// [V33.698] 규칙 한글 이름(원장 이유 pbRuleLabel 과 같은 말)
const ruleKo = (r: any): string => { if (!r) return "—"; if (r.cells) return "종목 칸마다 다름(" + Object.keys(r.cells).length + "칸) · 기본 " + ruleKo(r.def);
  const SC: any = { m: "평균", lcb: "하한(평균−표준오차)", mpd: "하루당 평균", lcbpd: "하루당 하한" }, LV: any = { fine: "세부 칸", regime: "국면 칸", global: "매매법 전체" };
  return [SC[r.score] || r.score, LV[r.level] || r.level].concat(r.decay ? ["최근 " + r.decay + "일 가중"] : []).concat(r.gate ? ["성적 스위치 " + r.gate + "일"] : []).concat(r.gveto ? ["전체 거부권"] : []).join(" · "); };
const ago = (ts: any) => { if (!fin(ts)) return "—"; const m = Math.round((Date.now() - ts) / 60000); return m < 60 ? m + "분 전" : m < 2880 ? Math.round(m / 60) + "시간 전" : Math.round(m / 1440) + "일 전"; };

function TwoSided({ x, lim, h = 6 }: { x: any; lim: number; h?: number }) {
  const v = fin(x) ? x : 0, p = pos(v, lim);
  return (
    <div style={{ height: h, borderRadius: h / 2, background: TRACK, position: "relative" }}>
      <div style={{ position: "absolute", left: "50%", top: -3, bottom: -3, width: 1, background: "#33445C" }} />
      <div style={{ position: "absolute", top: 0, height: "100%", left: Math.min(50, p) + "%", width: Math.abs(p - 50) + "%", background: col(v), borderRadius: h / 2 }} />
    </div>);
}
const card: CSSProperties = { background: PANEL, border: "1px solid " + LINE, borderRadius: 12 };
const kick: CSSProperties = { fontFamily: MONO, fontSize: 11, letterSpacing: ".14em", color: DIM };

function Btn({ on, onClick, children, label }: { on: boolean; onClick: () => void; children: ReactNode; label?: string }) {
  return <button type="button" aria-pressed={on} aria-label={label} onClick={onClick}
    style={{ minHeight: 40, padding: "0 16px", borderRadius: 8, fontWeight: 600, fontSize: 13.5, border: "1px solid " + (on ? POS : "#22324A"), background: on ? POS : "transparent", color: on ? "#04121A" : "#C9D4E3" }}>{children}</button>;
}

type SortKey = "id" | "preN" | "preM" | "preW" | "hoN" | "hoM" | "hoW" | "pick";

export function PlaybookDeck({ d, extra }: { d: any; extra?: { label: string; node: ReactNode }[] }) {
  const ms = (["us", "kr"] as const).filter((m) => d?.markets?.[m]);
  const [mk, setMk] = useState<"us" | "kr">(ms[0] || "us");
  const [tab, setTab] = useState("pb");
  const [sk, setSk] = useState<SortKey>("hoM");
  const [sd, setSd] = useState(-1);
  const R = d?.markets?.[mk], V = R?.daily?.val || {}, I = R?.intra?.val || null;
  const pbDef = R?.daily?.pb || {};
  const rows = useMemo(() => {
    const t = V.tune || {}, by = V.byPb || {}, ps = V.pbStat || null;
    /* [V33.654] ★지금 쓰는 매매법 전부★ — 종전엔 조율 보고(1순위만 · 미 6 · 한 7)에서 줄을 만들어 보조(수정판·문헌 전략)가 안 보였다.
       학습기가 보낸 pbStat(같은 시뮬의 판정 전·판정 구간)이 있으면 그것으로 전 매매법(daily.pb) · 없으면 옛 조율 보고. */
    const keys = Object.keys(pbDef).length ? Object.keys(pbDef) : ps ? Object.keys(ps) : Object.keys(t).filter((k) => t[k] && t[k].diag);
    const out = keys.map((k) => {
      const x = t[k] || {}, s_ = ps && ps[k], b = s_ ? s_.ho || [] : (x.test && x.test.base) || [], p0 = s_ ? s_.pre || [] : x.diag ? [x.diag.n, x.diag.mean, x.diag.win] : [];
      return { id: k, name: pbName(k), fam: (pbDef[k] && pbDef[k].family) || "", tier: s_ ? s_.tier : /\+|^(FROG|RESID_MOM|RS_NEWHI|NR7_TREND|DARVAS|GAP_FILL_D|VOL_DRYUP_PB|SECTOR_LAG|DIP_IN_LEADER5|GAP_UP_HOLD3|VOL_SURGE_HOLD|MA5_DIP_LEAD)$/.test(k) ? 2 : 1, preN: p0[0], preM: p0[1], preW: p0[2],
               hoN: b[0], hoM: b[1], hoW: b[2], pick: by[k] || 0, flt: (pbDef[k] && pbDef[k].flt) || x.flt || "", tuned: x.test && x.test.tuned };
    });
    out.sort((a: any, b: any) => { const x = a[sk], y = b[sk];
      if (sk === "id") return sd * String(a.name).localeCompare(String(b.name)) * -1;
      return sd < 0 ? (fin(y) ? y : -1e9) - (fin(x) ? x : -1e9) : (fin(x) ? x : 1e9) - (fin(y) ? y : 1e9); });
    return out;
  }, [V, pbDef, sk, sd]);
  if (!R) return <p style={{ color: DIM, fontSize: 13, padding: "16px 0" }}>학습기가 아직 매매법 표를 올리지 않았습니다.</p>;
  /* [V33.660] 통과 = 학습기 판정(R.pass.daily — 최근 구간 검사 포함). 종전엔 화면이 다시 계산하며 최근 검사를 빼 '통과' 로 잘못 보였다. */
  const RC = V.recent || null;
  const pass = R.pass && typeof R.pass.daily === "boolean" ? R.pass.daily : fin(V.n) && V.n >= 30 && V.mean > 0 && V.t >= 2 && V.mean > V.base && (!RC || RC.ok !== false);
  /* [V33.674] 월 맞춤 판정 — 같은 달 후보 안 무작위 대비 초과(mx) · 달 묶음 t(mT). trialWhy = 시험 매수가 열린 근거(pass 새 기준 · trade 종전 거래 t · abs 미국 절대) */
  const MM = V.passMode === "matched";
  const TW = R.pass && R.pass.trialWhy;
  const chosen = ruleName(V.rule);
  const day = String(R.day || "").replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3");
  const flow = [
    ["후보 선별 · OMNI-Q", V.candQ ? "상위 " + Math.round((1 - V.candQ) * 100) + "%" : "거름 없음", (V.cand || "—") + " · 하루·동시 상한이 차면 OMNI-Q 순위 높은 후보부터 산다(시뮬·실전 같은 순서)"],
    ["신호 · 일봉 매매법", rows.length + "종", (() => { const n2 = rows.filter((r: any) => r.tier === 2).length; return n2 ? "1순위 " + (rows.length - n2) + " · 보조 " + n2 + " — 보조는 1순위가 안 뜬 종목에만" : "오늘 조건이 맞은 매매법만 남긴다"; })()],
    ["종목 그룹 · 미지수", (() => { const pt = R.daily?.ptune; if (!pt) return "기본 미지수"; const nA = Object.values(pbDef).reduce((a: number, x: any) => a + Object.keys((x && x.ep) || {}).length + Object.keys((x && x.grp) || {}).filter((g) => !(x.ep && x.ep[g])).length, 0); return nA ? "그룹 조율 " + nA + "칸" : "기본 미지수"; })(),
      "변동성 3그룹마다 조율 · 시스템을 안 낮춘 것만 실전(‘미지수 · 조율’ 탭)"],
    ["구조 거르개", R.panic ? "공황 차단 켜짐" : "공황 차단 꺼짐", R.panic ? "1순위 추세·모멘텀·돌파 쉼(보조는 계속)" : "시장 60일 하락·고변동이면 1순위 추세 매매법 쉼"],
    ...(R.panicBook && R.panicBook.pre ? [["공황 반등 바구니", R.panicBook.ok ? "규칙 통과" : "관측만",
      "공황 날 OMNI-Q 후보 바구니 " + R.panicBook.h + "일 · 앞80% " + sg(R.panicBook.pre.mean) + "%(t " + (R.panicBook.pre.t ?? "—") + " · n " + R.panicBook.pre.n + ") · 뒤20% " + sg(R.panicBook.post.mean) + "%(t " + (R.panicBook.post.t ?? "—") + ") — 사전 등록: 앞80% t ≥ 2 · 뒤20% 양수면 시험 후보"]] : []),
    ["상황 칸 표", n0(R.daily?.cells) + "칸", "국면 × RSI × 이격 × 수익 × 거래량 칸마다 수축 평균"],
    ["고르는 규칙", chosen, V.luck ? (V.luck.fallback ? "검증 1등(t " + (fin(V.luck.best) ? (+V.luck.best).toFixed(2) : "—") + ")이 운 수준 " + V.luck.level + " 이하 → 사전 등록 기본 설정" : "검증 1등 t " + (fin(V.luck.best) ? (+V.luck.best).toFixed(2) : "—") + " > 운 수준 " + V.luck.level + "(설정·규칙 " + V.luck.K + "개)") : "검증 구간 t 가 가장 높은 규칙"],
    ["국면 거부권", "칸 평균 < 0 · n ≥ 30", "지금 국면 칸이 손실이면 규칙과 무관하게 버린다"],
    ["판정 구간", sg(V.mean) + "%", "n " + n0(V.n) + " · 무작위 " + sg(V.base) + "% → " + (pass ? "통과" : "미통과")],
    ...(MM ? [["월 맞춤 판정", (fin(V.mx) ? (V.mx >= 0 ? "+" : "") + V.mx.toFixed(2) + "%p" : "—"),
      "같은 달 무작위 대비 · 달 묶음 t " + (fin(V.mT) ? V.mT.toFixed(2) : "—") + " (≥ 2) · 이긴 달 " + (V.mWin ?? "—") + "/" + (V.mN ?? "—") + (V.cap ? " · 실전 상한(하루 " + V.cap.day + " · 동시 " + V.cap.open + ")" : "")]] : []),
    ...(V.fwd ? [["전진 구간 · 최종", (V.fwd.days || 0) + " / " + (V.fwd.needDays || 60) + "일",
      String(V.fwd.start).replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3") + " 동결 이후(아무도 본 적 없는 표본) · 거래 " + (V.fwd.n || 0) + (fin(V.fwd.wT) ? " · 주 묶음 t " + (+V.fwd.wT).toFixed(2) : "") + " → " + (V.fwd.ok ? "통과" : (V.fwd.days || 0) < (V.fwd.needDays || 60) ? "쌓는 중 — 주력 전환은 이것까지 통과해야" : "미달")]] : []),
    ["최근 " + ((RC && RC.days) || 125) + "일 악화 검사", RC ? sg(RC.mean) + "% vs " + sg(RC.base) + "%" : "—",
     RC ? (fin(RC.t) ? "초과 t " + RC.t.toFixed(2) + " · " : "") + (RC.ok ? "통과" : "미달") + " — 확실한 악화(t ≤ " + (fin(RC.needT) ? RC.needT : -2) + ")만 막음" : "기록 없음"],
  ];
  const tabs: [string, string][] = [["pb", "매매법 " + rows.length + "종"], ["param", "미지수 · 조율"], ["rules", "규칙 비교"], ["cand", "후보 폭 비교"], ["intra", "5분 단타"]].concat((extra || []).map((e, i) => ["x" + i, e.label] as [string, string])) as [string, string][];
  const note = tab === "pb" ? "판정 전 = 학습·검증 구간 · 판정 = 손대지 않은 최근 구간 · 고른 수 = 판정 구간에서 실제로 고른 거래 · 머리글을 누르면 정렬"
    : tab === "param" ? "칩 = 미지수(초록 = 기본에서 바뀐 값) · 표 칸을 누르면 그룹별 수식"
    : tab === "rules" ? "검증 구간에서 규칙마다 고른 거래 · 노란 줄 = 실제로 고른 규칙"
    : tab === "cand" ? "후보 설정마다 판정 구간 성적(고르기엔 안 씀) · 노란 줄 = 검증이 고른 설정" : tab === "intra" ? "5분봉 단타 검증(같은 3구간 절차)" : "";
  const th = (k: SortKey | null, l: string, left = false) => (
    <th key={l} scope="col" style={{ padding: left ? "12px 14px" : "12px", textAlign: left ? "left" : "right", fontWeight: 500, whiteSpace: "nowrap" }}>
      {k ? <button type="button" onClick={() => { setSd(k === sk ? -sd : -1); setSk(k); }} aria-label={l + " 기준 정렬"} style={{ color: k === sk ? INK : DIM }}>{l}{k === sk ? (sd < 0 ? " ↓" : " ↑") : ""}</button> : l}
    </th>);
  const td = (x: any, k = 3, bold = false): CSSProperties => ({ padding: "10px 12px", textAlign: "right", color: col(x), fontWeight: bold ? 600 : 400 });
  const tbl: CSSProperties = { width: "100%", borderCollapse: "collapse", fontFamily: MONO, fontSize: 12.5 };
  const tMax = Math.max(4, ...((V.valCmp || []) as any[]).map((c) => Math.abs(+c.t || 0)));

  return (
    <div style={{ color: "#C9D4E3", display: "flex", flexDirection: "column", gap: 24 }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div role="group" aria-label="시장" style={{ display: "flex", gap: 6 }}>
          {ms.map((m) => <Btn key={m} on={m === mk} onClick={() => setMk(m)}>{m === "us" ? "미국" : "한국"}</Btn>)}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, fontFamily: MONO, fontSize: 12 }}>
          {[["기준일", day], ["국면", R.regime3 ? "장기 " + (R3K.L[R.regime3.L] || R.regime3.L) + " · 중기 " + (R3K.M[R.regime3.M] || R.regime3.M) + " · 단기 " + (R3K.S[R.regime3.S] || R.regime3.S) + (R.regime3.turn ? " (" + R.regime3.turn + ")" : "") : ({ SURGE: "폭등", BULL: "상승", NEUTRAL: "보합", BEAR: "하락", CRASH: "폭락" } as any)[R.regime] || R.regime || "—"], ["표", ago(R.ts)]].map(([k, v]) => <span key={k} style={{ padding: "7px 10px", border: "1px solid " + LINE, borderRadius: 6, color: MUTE }}>{k} <b style={{ color: INK, fontWeight: 500 }}>{v}</b></span>)}
          <span title={R.panic ? "공황 = 시장(등가중)이 하루 −2.5%↓ 또는 5일 −6%↓ 폭락 뒤 3거래일, 또는 60일 하락 + 20일 변동성 상위 20%. 폭락 직후 반등일엔 추세·모멘텀이 반대로 움직인다 — 한국 10년: 공황 중 시장 +2%↑ 반등일에 추세 매매법 평균 −0.91%(n 18,837 · 평시 +0.10%). 평균회귀·반등(보조)은 계속." : undefined} style={{ padding: "7px 10px", borderRadius: 6, border: "1px solid " + (R.panic ? NEG : LINE), color: R.panic ? NEG : MUTE }}>{R.panic ? "공황 · 추세 쉼" : "공황 아님"}</span>
          {R.brake && R.brake.on && <span style={{ padding: "7px 10px", borderRadius: 6, border: "1px solid " + NEG, color: NEG }}>실전 손실 제동</span>}
        </div>
      </div>

      {/* [V33.698] 지금 한눈에 — 실제 매수 경로(원장 이유와 같은 순서) · 실전 상태 */}
      <section aria-label="지금 한눈에" className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div style={{ ...card, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={kick}>실제 매수 경로</div>
          <ol style={{ display: "flex", flexWrap: "wrap", alignItems: "stretch", gap: 8 }}>
            {[["① 후보 거름", "OMNI-Q " + (V.candQ ? "상위 " + Math.round((1 - V.candQ) * 100) + "%" : "거름 없음")],
              ["② 진입 신호", "매매법 AI " + rows.length + "종 중 뜬 것"],
              ["③ 하나 고르기", ruleKo(V.rule)],
              ["④ 청산", "매매법별 손절·보유일(트레일)"]].map(([k, v], i, A) => (
              <li key={k} style={{ display: "flex", alignItems: "center", gap: 8, flex: "1 1 150px", minWidth: 0 }}>
                <div style={{ flex: 1, minWidth: 0, border: "1px solid " + LINE, borderRadius: 8, padding: "8px 10px" }}>
                  <div style={{ fontSize: 11, color: DIM }}>{k}</div>
                  <div style={{ fontSize: 13, color: INK, overflowWrap: "anywhere" }}>{v}</div>
                </div>
                {i < A.length - 1 && <span aria-hidden="true" style={{ color: FAINT }}>→</span>}
              </li>))}
          </ol>
          {R.sleeve && R.sleeve.live && <div style={{ fontSize: 12, color: POS }}>+ 국면 전략 실전 중 — 오늘 종목은 ① 거름 없이 국면 전략이 고른다({(R.sleeve.syms || []).join(" · ") || "—"})</div>}
        </div>
        <div style={{ ...card, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={kick}>실전 상태</div>
          {[["매매법 AI", R.primary ? "주력(정상 크기)" : pass ? "검증 통과 · 주력 대기" : R.pass && (R.pass.absTrial || TW === "trade") ? "시험 매수(절반 크기)" : "관측만(매수 안 함)", R.primary || pass ? POS : R.pass && (R.pass.absTrial || TW === "trade") ? HL : NEG],
            ["국면 전략", R.sleeve ? (R.sleeve.live ? "실전 매수" : "관측만") : "—", R.sleeve && R.sleeve.live ? POS : MUTE],
            ["손실 제동", R.brake && R.brake.on ? "켜짐" : "꺼짐", R.brake && R.brake.on ? NEG : MUTE],
            ["옛 매수 경로", "꺼짐(위원회·단타·규칙 V33.649)", MUTE]].map(([k, v, c]) => (
            <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 13 }}><span style={{ color: DIM }}>{k}</span><b style={{ color: c, fontWeight: 500, textAlign: "right" }}>{v}</b></div>))}
        </div>
      </section>

      <section aria-label="판정 요약" className="grid grid-cols-2 gap-3 md:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))]">
        <div className="col-span-2 md:col-span-1" style={{ ...card, minWidth: 0, padding: "20px 22px", background: "linear-gradient(180deg," + PANEL2 + ",#080C13)", display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={kick}>판정 구간 · 고른 매매 평균(시장 대비 순초과)</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 16, flexWrap: "wrap" }}>
            <span style={{ fontFamily: MONO, fontSize: 46, fontWeight: 500, lineHeight: 1, letterSpacing: "-.02em", color: col(V.mean) }}>{sg(V.mean)}%</span>
            <span style={{ fontFamily: MONO, fontSize: 14, color: MUTE }}>무작위 기준 <b style={{ color: INK, fontWeight: 500 }}>{sg(V.base)}%</b></span>
          </div>
          <div style={{ position: "relative" }}>
            <TwoSided x={V.mean} lim={3} h={8} />
            {fin(V.base) && <div style={{ position: "absolute", top: -2, bottom: -2, left: "calc(" + pos(V.base, 3) + "% - 1px)", width: 2, background: INK }} />}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontFamily: MONO, fontSize: 11, color: FAINT }}><span>−3%</span><span>0</span><span>+3%</span></div>
          <div style={{ fontSize: 13, color: pass ? POS : (R.pass && (R.pass.absTrial || TW === "trade")) ? HL : NEG }}>{pass ? (MM ? "검증 통과 — 같은 달 무작위보다 낫고 달 묶음 t ≥ 2 · 최근 확실한 악화 없음" : "검증 통과 — 무작위보다 낫고 t ≥ 2 · 최근 확실한 악화 없음") : TW === "trade" ? "시험 매수(절반 크기) — 종전 기준(거래 t ≥ 2 · 무작위보다 나음)은 통과 · 새 월 맞춤 기준은 미달이라 주력 전환 안 됨 · 사용자 선택 (나) 10/26" : R.pass && R.pass.absTrial ? "절대 성적 기준 시험 매수(절반 크기) — 수익(평균 > 0 · t ≥ 2)이지만 무작위보다 낫지 않음 · 사용자 승인 10/25" : RC && RC.ok === false && V.t >= 2 && V.mean > V.base ? "미통과 — 판정 구간은 좋지만 최근 " + (RC.days || 125) + "일이 확실히 나빠짐" : "미통과 — 실전 매수 없이 관측만(그림자 판정)"}</div>
        </div>
        {[MM ? ["달 묶음 t (월 맞춤 초과)", fin(V.mT) ? V.mT.toFixed(2) : "—", "통과 ≥ 2.0 · 종전 거래 t " + (fin(V.t) ? V.t.toFixed(2) : "—") + "(부풀려짐)", fin(V.mT) ? (V.mT >= 2 ? POS : V.mT < 0 ? NEG : INK) : MUTE]
            : ["t 값", fin(V.t) ? V.t.toFixed(2) : "—", "통과 기준 ≥ 2.0", fin(V.t) ? (V.t >= 2 ? POS : V.t < 0 ? NEG : INK) : MUTE],
          ["승률 · 표본", fin(V.win) ? V.win.toFixed(1) + "%" : "—", "거래 " + n0(V.n) + "건 · 전부 평균 " + sg(V.baseAll) + "%", INK],
          ["주력 전환", (R.indep || 0) + " / 2", "겹치지 않는 판정 구간 통과 · 연속 " + (R.passStreak || 0) + " / 2", R.primary ? POS : INK]].map(([k, v, h, c]) => (
          <div key={k} style={{ ...card, padding: 18, display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={kick}>{k}</div>
            <div style={{ fontFamily: MONO, fontSize: 28, fontWeight: 500, color: c }}>{v}</div>
            <div style={{ fontSize: 12, color: DIM }}>{h}</div>
          </div>))}
      </section>

      {/* [V33.698] 사용자 10/28 "매매법 AI 두뇌관측 좀 더 보기 편하게 · 왜 한국만 폭등·폭락" — 국면별 성적 + 국면 전략 두 칸을 국면 5장 카드 하나로.
          다섯 국면을 늘 다 그린다(표본이 적으면 '표본 부족') · 미국도 정의는 같다(등가중 하루 ±2.5% · 5일 ±6%) — 날이 적을 뿐. */}
      {(() => { const SL = R.sleeve || null, RG = ["SURGE", "BULL", "NEUTRAL", "BEAR", "CRASH"], KO: any = { SURGE: "폭등", BULL: "상승", NEUTRAL: "보합", BEAR: "하락", CRASH: "폭락" };
        const BR: any = {}; (Array.isArray(V.byReg) ? V.byReg : []).forEach((r: any) => { BR[r.reg] = r; });
        const now = SL ? SL.reg : R.regime;
        const c5 = (x: any) => (!fin(x) ? MUTE : x >= 5 ? POS : x >= 0 ? HL : NEG);
        const wfv = (w: any) => !w || !fin(w.mean) ? <span style={{ color: FAINT }}>—</span> : <span style={{ color: c5(w.mean) }}>{sg(w.mean, 1)}% <span style={{ color: FAINT }}>({n0(w.n)})</span></span>;
        return (
        <section aria-label="국면별 한눈에" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
            <h3 style={{ fontSize: 16, fontWeight: 600, color: "#F2F6FC" }}>국면별 성적 · 거래당 실제 수익</h3>
            <span style={{ fontSize: 12, color: DIM }}>초록 = 목표 +5% 이상 · 노랑 = 0~5% · 주황 = 손실 · 괄호 = 거래 수</span>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {RG.map((r) => { const b = BR[r], sb = SL && SL.by && SL.by[r], v = SL && SL.wf && SL.wf.V && SL.wf.V[r], h = SL && SL.wf && SL.wf.H && SL.wf.H[r], on = r === now;
              const ok = !!(v && h && fin(v.mean) && fin(h.mean) && v.mean >= 5 && h.mean >= 5 && v.n >= 20 && h.n >= 20);
              return (
              <div key={r} style={{ ...card, padding: 14, display: "flex", flexDirection: "column", gap: 8, borderColor: on ? HL : LINE, background: on ? "rgba(255,209,102,.05)" : PANEL }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <span style={{ fontSize: 15, fontWeight: 600, color: INK }}>{KO[r]}{on && <span style={{ marginLeft: 6, fontSize: 11, color: HL }}>지금</span>}</span>
                  <span style={{ fontSize: 11, color: FAINT }}>{b && fin(b.dayShare) ? "판정 구간 날 " + b.dayShare + "%" : ""}</span>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: DIM }}>매매법 AI(OMNI-Q 후보 · 일봉)</div>
                  {b && !b.thin && fin(b.raw) ? <div style={{ fontFamily: MONO, fontSize: 20, color: c5(b.raw) }}>{sg(b.raw, 1)}% <span style={{ fontSize: 11, color: FAINT }}>({n0(b.n)})</span></div>
                    : <div style={{ fontSize: 13, color: FAINT, padding: "4px 0" }}>{b ? "표본 부족(" + n0(b.n) + "건 < 10)" : "표본 부족"}</div>}
                  {b && !b.thin && <div style={{ fontFamily: MONO, fontSize: 11, color: FAINT }}>시장 뺀 초과 {sg(b.mean)}% · 무작위 {sg(b.base)}%{fin(b.hd) ? " · 보유 " + b.hd + "일" : ""}</div>}
                </div>
                {SL && <div style={{ borderTop: "1px solid " + ROWLINE, paddingTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
                  <div style={{ fontSize: 11, color: DIM }}>국면 전략</div>
                  <div style={{ fontSize: 12, color: sb ? MUTE : FAINT, lineHeight: 1.4 }}>{sb ? sb.famKo + " · " + sb.profKo + (sb.cell ? " · 중기 " + (R3K.M[sb.cell] || sb.cell) : "") : "쉼(근거 부족)"}</div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontFamily: MONO, fontSize: 12 }}><span style={{ color: DIM }}>검증</span>{wfv(v)}</div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontFamily: MONO, fontSize: 12 }}><span style={{ color: DIM }}>판정</span>{wfv(h)}</div>
                  <span style={{ alignSelf: "flex-start", marginTop: 2, fontSize: 11, padding: "2px 8px", borderRadius: 4, border: "1px solid " + (ok ? POS : "#33445C"), color: ok ? POS : DIM }}>{ok ? "실전 자격" : "관측만"}</span>
                </div>}
              </div>); })}
          </div>
          {SL && <div style={{ ...card, padding: "12px 16px", display: "flex", flexWrap: "wrap", gap: 18, alignItems: "center", fontSize: 13 }}>
            <span style={{ color: DIM }}>지금 국면 전략</span>
            <b style={{ color: INK, fontWeight: 500 }}>{SL.cur ? SL.cur.famKo + " · " + SL.cur.profKo : "쉼"}</b>
            <span style={{ color: SL.live ? POS : HL }}>{SL.live ? "실전 매수 중" : "관측만(지금 국면이 두 구간 모두 +5% 를 못 넘음)"}</span>
            <span style={{ color: MUTE, fontFamily: MONO, fontSize: 12 }}>오늘 종목 {(SL.syms || []).join(" · ") || "—"}</span>
          </div>}
          <details style={{ ...card, padding: "10px 16px", background: "#080C13" }}>
            <summary style={{ cursor: "pointer", fontSize: 12.5, color: MUTE }}>숫자 읽는 법 — 검증 구간 · 판정 구간 · +5%</summary>
            <ul style={{ margin: "10px 0 4px", paddingLeft: 18, fontSize: 12, lineHeight: 1.7, color: DIM }}>
              <li>10년 일봉을 시간 순서로 나눈다: 앞 60% 학습 · <b style={{ color: INK }}>[60,80%) 검증 구간</b> = 여러 설정 중 하나를 고르는 데 쓴 구간 · <b style={{ color: INK }}>[80,100%) 판정 구간</b> = 고르기에 안 쓴 마지막 20%(약 2년) — 처음 보는 시장에서의 성적.</li>
              <li><b style={{ color: INK }}>+5%</b> = 판정 구간에서 고른 거래 하나를 사서 팔 때까지(평균 보유일은 카드에 표시) 비용 뺀 실제 수익률의 평균. 연 수익률이 아니다.</li>
              <li>국면 = 그날 시장(전 종목 등가중) 상태. 폭등·폭락 = 최근 3거래일 안에 하루 ±2.5% 또는 5일 ±6% — 미국·한국 같은 정의. 미국은 이런 날이 적어(판정 구간 3% 안팎) 표본 부족으로 보일 수 있다.</li>
              <li>국면 전략 실전 자격 = 지금 국면이 검증·판정 두 구간 모두 거래당 +5% 이상 · 각 20건 이상(미리 정한 기준).</li>
            </ul>
          </details>
        </section>); })()}

      <section aria-label="판단 흐름" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <h3 style={{ fontSize: 16, fontWeight: 600, color: "#F2F6FC" }}>판단 흐름</h3>
          <span style={{ fontSize: 12, color: DIM }}>한 종목이 매수 후보가 되기까지 — 단계마다 지금 쓰는 실제 값</span>
        </div>
        {/* [V33.633] 7단계는 한 줄 — 좁으면 옆으로 넘긴다(혼자 떨어지는 칸 없게) */}
        <div className="bs-rail" style={{ overflowX: "auto" }}>
        <ol style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(128px, 1fr))", gap: 10 }}>
          {flow.map(([t, v, s], i) => (
            <li key={t} style={{ ...card, borderRadius: 10, position: "relative", padding: "14px 14px 16px", display: "flex", flexDirection: "column", gap: 7, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span aria-hidden="true" style={{ width: 22, height: 22, borderRadius: "50%", border: "1px solid " + POS, color: POS, fontFamily: MONO, fontSize: 11, display: "flex", alignItems: "center", justifyContent: "center" }}>{i + 1}</span>
                <span style={{ fontSize: 12, color: MUTE }}>{t}</span>
              </div>
              <div style={{ fontFamily: MONO, fontSize: 16, fontWeight: 500, color: "#F2F6FC", overflowWrap: "anywhere" }}>{v}</div>
              <div style={{ fontSize: 12, lineHeight: 1.45, color: DIM }}>{s}</div>
            </li>))}
        </ol>
        </div>
      </section>

      <section aria-label="실제 표" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: 10, borderBottom: "1px solid #172131" }}>
          <div role="tablist" aria-label="표 고르기" className="bs-rail" style={{ display: "flex", gap: 20, overflowX: "auto" }}>
            {tabs.map(([k, l]) => (
              <button key={k} type="button" role="tab" aria-selected={k === tab} onClick={() => setTab(k)}
                style={{ minHeight: 42, whiteSpace: "nowrap", borderBottom: "2px solid " + (k === tab ? POS : "transparent"), marginBottom: -1, color: k === tab ? "#F2F6FC" : DIM, fontSize: 13.5, fontWeight: 600 }}>{l}</button>))}
          </div>
          {note && <span style={{ fontSize: 12, color: DIM, paddingBottom: 10 }}>{note}</span>}
        </div>

        {tab === "pb" && (
          <div style={{ ...card, overflowX: "auto", background: "#080C13" }}>
            <table style={{ ...tbl, minWidth: 1000 }}>
              <thead><tr style={{ background: PANEL2, color: DIM }}>
                {th("id", "매매법", true)}{th("preN", "판정 전 n")}{th("preM", "판정 전 평균")}{th("preW", "승률")}{th("hoN", "판정 n")}{th("hoM", "판정 평균")}{th("hoW", "승률")}
                {th(null, "판정 평균 막대", true)}{th("pick", "고른 수")}{th(null, "거르개", true)}
              </tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.id} style={{ borderTop: "1px solid " + ROWLINE }}>
                  <td style={{ padding: "9px 14px", color: INK, minWidth: 170, maxWidth: 300 }}>
                    <span style={{ whiteSpace: "nowrap" }}>{r.name}</span>{r.tier === 2 && <span style={{ marginLeft: 8, fontSize: 10.5, color: HL, border: "1px solid #5A4A1A", borderRadius: 4, padding: "0 5px", whiteSpace: "nowrap" }}>보조</span>}{fin(pbDef[r.id] && pbDef[r.id].hold) && pbDef[r.id].hold <= 5 && <span style={{ marginLeft: 6, fontSize: 10.5, color: POS, border: "1px solid #1D4A5A", borderRadius: 4, padding: "0 5px", whiteSpace: "nowrap" }}>단타 {pbDef[r.id].hold}일</span>}{pbDef[r.id] && pbDef[r.id].onlyGrp != null && <span style={{ marginLeft: 6, fontSize: 10.5, color: "#FF9A4A", border: "1px solid #5A3A1A", borderRadius: 4, padding: "0 5px", whiteSpace: "nowrap" }}>{["저변동", "중간", "고변동"][pbDef[r.id].onlyGrp]}만</span>}
                    <span style={{ display: "block", marginTop: 2, fontSize: 11, color: FAINT, fontFamily: MONO, whiteSpace: "nowrap" }}>{r.id}{r.fam ? " · " + r.fam : ""}</span></td>
                  <td style={{ ...td(null), color: MUTE }}>{n0(r.preN)}</td>
                  <td style={td(r.preM)}>{sg(r.preM, 3)}</td>
                  <td style={{ ...td(null), color: MUTE }}>{fin(r.preW) ? r.preW.toFixed(1) + "%" : "—"}</td>
                  <td style={{ ...td(null), color: MUTE }}>{n0(r.hoN)}</td>
                  <td style={td(r.hoM, 3, true)}>{sg(r.hoM, 3)}</td>
                  <td style={{ ...td(null), color: MUTE }}>{fin(r.hoW) ? r.hoW.toFixed(1) + "%" : "—"}</td>
                  <td style={{ padding: "10px 14px", width: 170 }}><TwoSided x={r.hoM} lim={4} /></td>
                  <td style={{ ...td(null), color: r.pick ? HL : "#33445C", fontWeight: r.pick ? 600 : 400 }}>{r.pick ? n0(r.pick) : "·"}</td>
                  <td style={{ padding: "10px 14px", color: MUTE, whiteSpace: "nowrap" }}>{r.flt || "—"}{r.tuned ? " · 조율 " + sg(r.tuned[1], 2) + "%" : ""}</td>
                </tr>))}</tbody>
            </table>
            {!rows.length && <p style={{ padding: 16, fontSize: 12, color: DIM }}>매매법별 진단은 다음 학습 회차부터 표시됩니다.</p>}
          </div>)}

        {tab === "param" && <ParamTab R={R} name={pbName} />}

        {tab === "rules" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {/* [V33.694] 규칙이 뜻하는 것(사용자 10/28 질문) · 칸별 규칙이면 종목 칸마다 무엇을 쓰는지 */}
          <p style={{ fontSize: 12, lineHeight: 1.6, color: DIM }}>규칙 = 한 종목에 매매법이 여럿 뜰 때 하나를 고르는 방법. <b style={{ color: INK }}>점수</b>: m 평균 · lcb 하한(평균−표준오차) · mpd·lcbpd 하루당 · <b style={{ color: INK }}>칸 단계</b>: fine 세부 칸(국면+RSI·20일선·5일·거래량) · regime 국면 칸만 · global 매매법 전체 · d 최근 가중 · g 성적 스위치 · 거부권 전체 평균 ≤ 0 이면 제외. 검증 구간 [60,80%) 에서 같은 달 무작위 대비 초과의 달 묶음 t 로 고른다.</p>
          {V.rule && V.rule.cells && (
            <div style={{ ...card, padding: 14, background: "#080C13" }}>
              <div style={{ fontSize: 12, color: MUTE, marginBottom: 8 }}>종목마다 다른 규칙 — 칸(중기 국면 × 종목 변동성)에서 [40,60%) 로 고른 규칙 · 나머지 칸은 기본 {ruleName(V.rule.def)}</div>
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">{Object.entries(V.rule.cells).map(([c, r]: any) => (
                <div key={c} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 12, padding: "6px 10px", border: "1px solid " + LINE, borderRadius: 6 }}><span style={{ color: MUTE }}>{cellName(c)}</span><b style={{ color: INK, fontFamily: MONO, fontWeight: 500 }}>{ruleName(r)}</b></div>))}</div>
            </div>)}
          <div style={{ ...card, overflowX: "auto", background: "#080C13" }}>
            <table style={{ ...tbl, minWidth: 720 }}>
              <thead><tr style={{ background: PANEL2, color: DIM }}>{th(null, "규칙 (점수 · 칸 단계 · 최근 가중 · 성적 스위치)", true)}{th(null, "검증 n")}{th(null, "검증 평균")}{th(null, "검증 t")}{th(null, "t 막대", true)}{th(null, "상태", true)}</tr></thead>
              <tbody>{(V.valCmp || []).map((c: any, i: number) => { const nmR = ruleName(c.rule), on = nmR === chosen;
                return (
                  <tr key={i} style={{ borderTop: "1px solid " + ROWLINE, background: on ? "rgba(255,209,102,.07)" : undefined }}>
                    <td style={{ padding: "10px 14px", color: INK }}>{nmR}</td>
                    <td style={{ ...td(null), color: MUTE }}>{n0(c.n)}</td>
                    <td style={td(c.mean)}>{sg(c.mean)}%</td>
                    <td style={{ ...td(null), color: INK }}>{fin(c.t) ? c.t.toFixed(2) : "—"}</td>
                    <td style={{ padding: "10px 14px", width: 220 }}><div style={{ height: 6, borderRadius: 3, background: TRACK }}><div style={{ height: 6, borderRadius: 3, width: Math.min(100, Math.abs(+c.t || 0) / tMax * 100) + "%", background: on ? HL : c.t >= 2 ? POS : "#33445C" }} /></div></td>
                    <td style={{ padding: "10px 14px", color: on ? HL : DIM, fontWeight: on ? 600 : 400 }}>{on ? "고른 규칙" : c.t >= 2 ? "t ≥ 2" : "—"}</td>
                  </tr>); })}</tbody>
            </table>
          </div></div>)}

        {tab === "cand" && (
          <div style={{ ...card, overflowX: "auto", background: "#080C13" }}>
            <table style={{ ...tbl, minWidth: 820 }}>
              <thead><tr style={{ background: PANEL2, color: DIM }}>{th(null, "후보 설정 (OMNI-Q 머리 · 폭)", true)}{th(null, "검증 평균")}{th(null, "검증 t")}{th(null, "판정 n")}{th(null, "판정 평균")}{th(null, "무작위")}{th(null, "판정 t")}{th(null, "상태", true)}</tr></thead>
              <tbody>{(V.candCmp || []).map((c: any, i: number) => {
                const on = (V.candQ || 0) === c.q && (c.q === 0 || String(V.candHead) === String(c.head));
                const cfg = c.q === 0 ? "OMNI-Q 거름 없음(전 종목)" : (c.head === "avg" ? "5·20일 평균" : (c.head || "5") + "일") + " 머리 · 상위 " + Math.round((1 - c.q) * 100) + "%";
                const better = fin(c.mean) && fin(c.base) && c.mean > c.base;
                return (
                  <tr key={i} style={{ borderTop: "1px solid " + ROWLINE, background: on ? "rgba(255,209,102,.07)" : undefined }}>
                    <td style={{ padding: "10px 14px", color: INK }}>{cfg}</td>
                    <td style={{ ...td(null), color: MUTE }}>{sg(c.val)}%</td>
                    <td style={{ ...td(null), color: MUTE }}>{fin(c.valT) ? c.valT.toFixed(2) : "—"}</td>
                    <td style={{ ...td(null), color: MUTE }}>{n0(c.n)}</td>
                    <td style={td(c.mean, 2, true)}>{sg(c.mean)}%</td>
                    <td style={{ ...td(null), color: MUTE }}>{sg(c.base)}%</td>
                    <td style={{ ...td(null), color: INK }}>{fin(c.t) ? c.t.toFixed(2) : "—"}</td>
                    <td style={{ padding: "10px 14px", color: on ? HL : better ? POS : DIM, fontWeight: on ? 600 : 400 }}>{on ? "검증이 고름" : better ? "무작위보다 나음" : "—"}</td>
                  </tr>); })}</tbody>
            </table>
            {!(V.candCmp || []).length && <p style={{ padding: 16, fontSize: 12, color: DIM }}>후보 폭 비교가 없습니다.</p>}
          </div>)}

        {tab === "intra" && (
          <div style={{ ...card, padding: 18, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 14 }}>
            {!I || !fin(I.n) || I.n === 0 ? <p style={{ fontSize: 13, color: DIM }}>{(I && I.why) || "5분봉 단타 표본이 아직 없습니다(판정 구간 거래 0건)."}</p> :
              [["판정 평균", sg(I.mean) + "%", col(I.mean)], ["무작위", sg(I.base) + "%", INK], ["t", fin(I.t) ? I.t.toFixed(2) : "—", INK], ["거래 · 승률", n0(I.n) + " · " + (fin(I.win) ? I.win + "%" : "—"), INK], ["규칙", ruleName(I.rule), INK]].map(([k, v, c]) => (
                <div key={k}><div style={kick}>{k}</div><div style={{ fontFamily: MONO, fontSize: 20, color: c, marginTop: 4 }}>{v}</div></div>))}
          </div>)}

        {(extra || []).map((e, i) => tab === "x" + i ? <div key={i}>{e.node}</div> : null)}
      </section>

      <footer style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 10, paddingTop: 14, borderTop: "1px solid #172131", fontSize: 12, color: FAINT }}>
        <span>수치 = 학습기(GitHub Actions)가 올린 매매법 시뮬 표(10년 일봉) · 판정 구간 = {V.hoFrom ? String(V.hoFrom).replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3") + " 이후 · " : ""}마지막 20%(학습·규칙 고르기에 안 쓴 구간)</span>
        <span style={{ fontFamily: MONO }}>평균 = 거래당 % · 시장(등가중) 대비 · 비용 뺀 값</span>
      </footer>
    </div>);
}
