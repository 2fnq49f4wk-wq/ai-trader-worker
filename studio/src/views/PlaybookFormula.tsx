/* [V33.664] 매매법 = 미지수가 있는 수식 — 사용자 10/24 "매매법을 여러 미지수의 수식으로 · 종목 특성에 맞춰 스스로 조율 · 두뇌구조창에서 직관적으로".
   ① 수식 한 줄(미지수는 칩 · 기본값과 다르면 강조) ② 미지수 지도(매매법 × 변동성 3그룹 — 채택·보류·미달) ③ 고른 매매법의 그룹별 수식·청산 값.
   값은 /api/playbook(학습기 업로드) 그대로 — 기본값 epDef · 사다리 epLad · 조율 기록 ptune · 실전 채택 pb[pb].ep/grp · 그룹 종목 수 grpN. */
import { useMemo, useState, type CSSProperties } from "react";

const POS = "#4FE3FF", INK = "#E9F2FF", MUTE = "#8695AA", DIM = "#6F7E94", FAINT = "#56657A", HL = "#FFD166", OK = "#5BE49B";
const PANEL = "#0A0F17", LINE = "#1B2738", ROWLINE = "#121B28";
const MONO = 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace';

type Seg = string | { k: string; u?: "pct" | "x" | "%" | "d" };
/* 진입 수식 — 학습기 playbook_params.ENTRY · 워커 pbDailyFires 와 같은 식(미지수 이름이 같다) */
export const FORMULA: Record<string, Seg[]> = {
  TREND_ALIGN: ["20>50>200일선 정배열 · 종가 > 20일선 · RSI14 ", { k: "rsiLo" }, " ~ ", { k: "rsiHi" }],
  TR_BREAKOUT: ["종가가 ", { k: "n", u: "d" }, " 최고 종가 돌파 · 50일선 위 · 양봉 · 거래량 ", { k: "vr", u: "x" }, " 이상"],
  RS_LEADER: [{ k: "lb", u: "d" }, " 수익 순위 ≥ ", { k: "x" }, " · 20>50일선 · RSI14 ≤ ", { k: "rsiHi" }],
  VT_TREND: ["50일선 위 · 20>50일선 · ATR < ", { k: "atrMax", u: "%" }, " · 20일 수익 > 0"],
  TR_PULLBACK: ["20>50일선 · 20일선 ±", { k: "gap", u: "pct" }, " 안 눌림 · 양봉 · RSI14 ", { k: "rsiLo" }, " ~ ", { k: "rsiHi" }],
  MA_PULLBACK: ["정배열 · 저가 ≤ 20일선 × ", { k: "touch" }, " · 종가 > 20일선 · 양봉"],
  SN_RSI2: ["200일선 위 정배열 · RSI2 ≤ ", { k: "rsi2" }, " · 종가 < 5일선 · RSI14 ≤ ", { k: "rsi14" }],
  HA_REV: ["하이킨아시 음봉 2개 뒤 첫 양봉 · 종가 > 50일선 × ", { k: "f" }],
  BB_LOW: ["볼린저 하단 이하 · RSI14 ", { k: "rsiLo" }, " ~ ", { k: "rsiHi" }, " · 양봉"],
  STOCH_CROSS: ["어제 %K ≤ ", { k: "k" }, " 에서 %K↗%D 교차 · 200일선 −5% 위"],
  STOCH_OS_EXIT: ["%K 가 ", { k: "k" }, " 아래 → 위 · 양봉 · 200일선 −5% 위"],
  VOL_BREAKOUT: ["거래량 ", { k: "vr", u: "x" }, " · ", { k: "n", u: "d" }, " 최고 종가 돌파 · 50일선 위"],
  VOL_REVERT: ["거래량 ", { k: "vr", u: "x" }, " · 당일 ", { k: "r1", u: "%" }, " 이하 · 저가권 마감 · RSI2 ≤ ", { k: "rsi2" }, " · 200일선 위"],
  OS_DEEP: ["RSI2 ≤ ", { k: "rsi2" }, " · 볼린저 하단 아래 · 5일 ", { k: "r5", u: "%" }, " 이하 · RSI14 ≤ ", { k: "rsi14" }],
  CAPIT_REV: ["거래량 ", { k: "vr", u: "x" }, " · 당일 ", { k: "r1", u: "%" }, " 이하 · 종가 ≤ 20일선 × ", { k: "f" }],
  ICHIMOKU: ["구름 상단 첫 돌파 · 전환선 > 기준선 · 구름 두께 ≤ ", { k: "thick", u: "pct" }],
  KELTNER: ["EMA20 + ", { k: "mult" }, "×ATR10 상단 첫 돌파 · 양봉"],
  DONCHIAN: ["지난 ", { k: "n", u: "d" }, " 최고가 첫 돌파"],
  MACD_X: ["MACD(", { k: "fast" }, "·", { k: "slow" }, "·9) 0선 아래 골든크로스 또는 0선 돌파"],
  ENVELOPE: ["어제 20일선 × ", { k: "f" }, " 아래 → 오늘 그 위 회복 양봉"],
  ELDER_RAY: ["EMA", { k: "n" }, " 상승 중 베어 파워 음수에서 반등"],
  WILLR: ["%R(", { k: "n" }, ") 이 ", { k: "lvl" }, " 이하 → 위"],
  CCI_REV: ["CCI(", { k: "n" }, ") 가 ", { k: "lvl" }, " 이하 → 위"],
  PSAR: ["파라볼릭 SAR 상승 전환(미지수 없음)"],
  TRIPLE_SCR: ["EMA65 상승 · 어제 %K ≤ ", { k: "k" }, " · 어제 고가 돌파"],
  IBS_LOW: ["IBS ≤ ", { k: "cpos" }, " · 하락일 · 200일선 위"],
  HI52_NEAR: ["종가 ≥ 52주 최고가 × ", { k: "near" }, " 첫 진입 · 50일선 위 · 양봉"],
  SQUEEZE: ["볼린저 폭 ≤ 120일 하위 ", { k: "q", u: "pct" }, " 뒤 상단 돌파 · 50일선 위"],
  XS_ARB: ["5일 수익 횡단면 z ≤ ", { k: "z" }, " · 200일선 위"],
  DUAL_MOM: ["(", { k: "lb", u: "d" }, " − 21일) 수익 > 0 · 순위 ≥ ", { k: "x" }, " · 200일선 위"],
  HERD_REBOUND: ["최근 6일 거래량 ", { k: "vr", u: "x" }, " 양봉 뒤 고점 대비 ", { k: "ddLo", u: "%" }, " ~ ", { k: "ddHi", u: "%" }, " · 20일선 −2% 위 · 양봉"],
};
const exitTxt = (k: string, v: any) => {
  if (k === "stop") return "손절 −" + v + "%";
  if (k === "atr") return v >= 99 ? "ATR 손절 없음" : "ATR 손절 ×" + v;
  if (k === "be") return v ? "+" + v + "R 에 본전" : "본전 이동 없음";
  if (k === "bePct") return v ? "+" + v + "% 에 본전" : "본전 이동 없음";
  if (k === "tpR") return v ? "익절 " + v + "R" : "익절 없음";
  if (k === "tpPct") return v ? "익절 +" + v + "%" : "익절 없음";
  if (k === "hold") return "최대 " + v + "거래일";
  if (k === "tstop") return v ? v + "일 지나 손실이면 정리" : "기간 손절 없음";
  if (k === "mr") return v ? "평균회귀 청산 켬" : "평균회귀 청산 끔";
  return k + " " + v;
};
const unitOf = (pb: string, k: string) => { const s = (FORMULA[pb] || []).find((x) => typeof x !== "string" && x.k === k) as any; return s && s.u; };
export const GRP = ["저변동", "중간", "고변동"];
/* [V33.672] 고차원 수식(메타 라벨) — 지표 11개 이름표 */
const MF: Record<string, string> = { rsi14: "RSI14", rsi2: "RSI2", gap20: "20일선 이격", ret5: "5일 수익", ret20: "20일 수익", lvr: "거래량 배수(로그)", atr: "ATR%",
  tr200: "200일선 대비", ma50_200: "50/200일선 간격", cpos: "종가 위치", rs6: "6개월 상대강도" };
function MetaCoef({ m, feats }: { m: any; feats: string[] }) {
  const b = (m && m.b ? m.b.slice(1) : []) as number[], mx = Math.max(0.001, ...b.map((x) => Math.abs(x)));
  return (
    <div style={{ display: "grid", gap: 4 }}>
      {b.map((x, k) => ({ x, k })).sort((a, c) => Math.abs(c.x) - Math.abs(a.x)).map(({ x, k }) => (
        <div key={k} style={{ display: "grid", gridTemplateColumns: "110px 1fr 60px", alignItems: "center", gap: 8, fontSize: 12 }}>
          <span style={{ color: MUTE }}>{MF[feats[k]] || feats[k]}</span>
          <div style={{ position: "relative", height: 8, background: "#111A27", borderRadius: 4 }}>
            <div style={{ position: "absolute", left: "50%", top: -2, bottom: -2, width: 1, background: "#33445C" }} />
            <div style={{ position: "absolute", top: 0, height: 8, borderRadius: 4, left: x >= 0 ? "50%" : (50 - (Math.abs(x) / mx) * 50) + "%", width: (Math.abs(x) / mx) * 50 + "%", background: x >= 0 ? OK : "#FF9A4A" }} />
          </div>
          <span style={{ fontFamily: MONO, color: x >= 0 ? OK : "#FF9A4A", textAlign: "right" }}>{(x >= 0 ? "+" : "") + x.toFixed(2)}</span>
        </div>))}
    </div>);
}
const GCOL = ["#7FB2FF", "#B49CFF", "#FF9A4A"];

const fv = (v: any, u?: string) => {
  if (v == null) return "—";
  if (u === "pct") return +(v * 100).toFixed(1) + "%";
  if (u === "x") return v + "배";
  if (u === "%") return v + "%";
  if (u === "d") return v + "일";
  return String(v);
};

/* [V33.667] 공통 수식 조건 — 모든 매매법에 붙는 미지수(값이 있으면 조건 추가) */
const MODS: [string, string, (v: any) => string][] = [
  ["trendMin", "200일선 대비 ", (v) => (v >= 0 ? "+" : "") + Math.round(v * 100) + "% 이상"],
  ["rs6Min", "6개월 순위 ≥ ", (v) => String(v)],
  ["vrMin", "거래량 ", (v) => v + "배 이상"],
  ["atrCap", "ATR ≤ ", (v) => v + "%"],
];
export function FormulaLine({ pb, vals, def, size = 13 }: { pb: string; vals?: Record<string, any> | null; def?: Record<string, any> | null; size?: number }) {
  const f = FORMULA[pb];
  if (!f) return null;
  return (
    <span style={{ fontSize: size, lineHeight: 1.9, color: "#C9D4E3" }}>
      {f.map((s, i) => {
        if (typeof s === "string") return <span key={i}>{s}</span>;
        const v = vals && vals[s.k] != null ? vals[s.k] : def && def[s.k];
        const changed = def && vals && vals[s.k] != null && vals[s.k] !== def[s.k];
        return <span key={i} title={s.k + (def ? " · 기본 " + fv(def[s.k], s.u) : "")}
          style={{ display: "inline-block", fontFamily: MONO, fontSize: size - 0.5, padding: "0 6px", margin: "0 2px", borderRadius: 5, lineHeight: 1.55,
                   border: "1px solid " + (changed ? OK : "#2A3A52"), color: changed ? OK : POS, background: changed ? "rgba(91,228,155,.08)" : "rgba(79,227,255,.06)" }}>
          {fv(v, s.u)}{changed && <span style={{ color: FAINT, textDecoration: "line-through", marginLeft: 5 }}>{fv(def![s.k], s.u)}</span>}</span>;
      })}
      {MODS.filter(([k]) => vals && vals[k] != null).map(([k, lbl, f]) => <span key={k}> · {lbl}<span style={{ display: "inline-block", fontFamily: MONO, fontSize: size - 0.5, padding: "0 6px", margin: "0 2px", borderRadius: 5, lineHeight: 1.55, border: "1px solid " + OK, color: OK, background: "rgba(91,228,155,.08)" }}>{f(vals![k])}</span></span>)}
    </span>);
}

type St = "adopt" | "held" | "miss" | "few" | "time" | "none";
const ST: Record<St, [string, string, string]> = {
  adopt: ["실전 채택", OK, "rgba(91,228,155,.14)"], held: ["조율안 · 시스템 보류", HL, "rgba(255,209,102,.10)"],
  miss: ["기본 유지", MUTE, "transparent"], few: ["표본 부족", FAINT, "transparent"], time: ["시간 상한", FAINT, "transparent"], none: ["조율 안 함", "#33445C", "transparent"],
};
function cellOf(rep: any, pbDef: any, g: number): { st: St; why: string; ep: any; ex: any } {
  const adopted = pbDef && ((pbDef.ep && pbDef.ep[g]) || (pbDef.grp && pbDef.grp[g]));
  const r = rep && rep[g];
  const why = r == null ? "" : typeof r === "string" ? r : String(r.why || "");
  if (adopted) return { st: "adopt", why, ep: pbDef.ep && pbDef.ep[g], ex: pbDef.grp && pbDef.grp[g] };
  if (r == null) return { st: "none", why: "", ep: null, ex: null };
  if (typeof r === "object") return { st: "held", why, ep: r.ep, ex: r.ex };
  return { st: /표본 부족/.test(why) ? "few" : /시간/.test(why) ? "time" : "miss", why, ep: null, ex: null };
}

const card: CSSProperties = { background: PANEL, border: "1px solid " + LINE, borderRadius: 12 };

export function ParamTab({ R, name }: { R: any; name: (k: string) => string }) {
  const D = R?.daily || {}, pbDef = D.pb || {}, pt = D.ptune || null, def = D.epDef || {}, lad = D.epLad || {}, gN = D.grpN || {};
  const tune = (pt && pt.tune) || {}, sys = ((pt && pt.sys) || []) as any[];
  const rows = useMemo(() => {
    const ks = Array.from(new Set([...Object.keys(tune), ...Object.keys(pbDef).filter((k) => FORMULA[k])]));
    return ks.map((k) => { const cells = [0, 1, 2].map((g) => cellOf(tune[k], pbDef[k], g)); return { k, cells, rank: cells.reduce((a, c) => a + (c.st === "adopt" ? 100 : c.st === "held" ? 10 : c.st === "miss" ? 1 : 0), 0) }; })
      .sort((a, b) => b.rank - a.rank || name(a.k).localeCompare(name(b.k)));
  }, [tune, pbDef, name]);
  const [sel, setSel] = useState<string | null>(null);
  const cur = rows.find((r) => r.k === sel) || rows[0];
  if (!pt) return <p style={{ padding: 16, fontSize: 13, color: DIM }}>미지수 조율 기록은 다음 학습 회차(V33.664 학습기)부터 표시됩니다. 지금은 모든 매매법이 기본 미지수로 돕니다.</p>;
  const nCell = rows.length * 3, nPass = rows.reduce((a, r) => a + r.cells.filter((c) => c.st === "adopt" || c.st === "held").length, 0), nAdopt = rows.reduce((a, r) => a + r.cells.filter((c) => c.st === "adopt").length, 0);
  const base = pt.base || null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* ① 원리 */}
      <div style={{ ...card, padding: "16px 18px", display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
        <div>
          <div style={{ fontSize: 12, color: DIM, marginBottom: 6 }}>매매법 = 수식 + 미지수</div>
          <div style={{ fontSize: 13, color: "#C9D4E3", lineHeight: 1.6 }}>진입 조건의 문턱(칩) · 공통 조건 4개(추세·상대강도·거래량·변동성) · 청산 값(손절·익절·보유일)이 미지수입니다. 조율은 실전과 같은 OMNI-Q 후보 종목 안에서만 합니다. 학습할 때마다 종목을 <b style={{ color: INK }}>변동성 3그룹</b>으로 나눠 그룹마다 미지수를 한 칸씩 바꿔 봅니다.</div>
        </div>
        <div>
          <div style={{ fontSize: 12, color: DIM, marginBottom: 6 }}>두 번 거르는 채택</div>
          <div style={{ fontSize: 13, color: "#C9D4E3", lineHeight: 1.6 }}>① 그 매매법만 놓고 앞 40% 월별 t ≥ 3 · 그 40% 를 4등분해 3곳 이상 개선 · 다음 15% 에서도 개선 → <span style={{ color: HL }}>조율안</span><br />② 시스템 전체 검증 구간을 안 낮출 때만 → <span style={{ color: OK }}>실전 채택</span></div>
        </div>
        <div>
          <div style={{ fontSize: 12, color: DIM, marginBottom: 6 }}>종목 그룹(지난 1년 평균 ATR% 3분위)</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{GRP.map((g, i) => <span key={g} style={{ padding: "4px 9px", borderRadius: 6, border: "1px solid " + GCOL[i], color: GCOL[i], fontSize: 12.5, fontFamily: MONO }}>{g} {gN[i] != null ? gN[i] + "종목" : ""}</span>)}</div>
          <div style={{ fontSize: 11.5, color: FAINT, marginTop: 6 }}>종목 하나씩 맞추지 않습니다 — 종목당 신호가 10년에 수십 건이라 과거에만 맞습니다.</div>
        </div>
      </div>
      {/* ② 요약 숫자 */}
      <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
        {[["조율한 칸", rows.length + "종 × 3그룹 = " + nCell, INK], ["조율안(단독 개선)", String(nPass), nPass ? HL : MUTE], ["실전 채택", String(nAdopt), nAdopt ? OK : MUTE],
          ["시스템 검증 구간(기준)", base ? (base[0] != null ? (base[0] >= 0 ? "+" : "") + (+base[0]).toFixed(2) + "% · t " + (+base[1]).toFixed(2) : "—") : "—", INK]].map(([k, v, c]) => (
          <div key={k} style={{ ...card, padding: "12px 14px" }}><div style={{ fontSize: 11.5, color: DIM }}>{k}</div><div style={{ fontFamily: MONO, fontSize: 18, color: c, marginTop: 4 }}>{v}</div></div>))}
      </div>
      {D.meta && (
        <div style={{ ...card, padding: "12px 16px" }}>
          <div style={{ fontSize: 12, color: DIM, marginBottom: 8 }}>고차원 수식 — 진입 날 지표 11개의 선형 수식으로 '이번 신호의 기대 수익' 예측 · 예측 하위 신호를 거름(계수는 검증 전 구간으로만 · 검증 평균 +0.05%p 이상 · t 안 낮출 때만 채택)</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, fontSize: 13 }}>
            {[{ q: 0, val: D.meta.base, ok: true, label: "안 거름(기준)" }].concat((D.meta.cmp || []).map((c: any) => ({ ...c, label: "하위 " + Math.round(c.q * 100) + "% 거름" }))).map((c: any, i: number) => {
              const on = D.meta.pick == null ? c.q === 0 : c.q === D.meta.pick;
              return <span key={i} style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid " + (on ? OK : LINE), color: on ? OK : MUTE, fontFamily: MONO, fontSize: 12 }}>
                {c.label} · 검증 {c.val && c.val[0] != null ? (+c.val[0]).toFixed(2) + "%" : "—"} · t {c.val ? (+c.val[1]).toFixed(2) : "—"}{on ? " · 사용" : ""}</span>; })}
          </div>
        </div>)}
      {sys.length > 0 && (
        <div style={{ ...card, padding: "12px 16px" }}>
          <div style={{ fontSize: 12, color: DIM, marginBottom: 8 }}>시스템 검증(조율안을 하나씩 넣어 본 결과)</div>
          {sys.map((x, i) => (
            <div key={i} style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "baseline", padding: "6px 0", borderTop: i ? "1px solid " + ROWLINE : undefined, fontSize: 13 }}>
              <span style={{ color: INK, minWidth: 140 }}>{name(x.pb)}</span>
              <span style={{ fontFamily: MONO, color: MUTE }}>{(x.groups || []).map((g: string) => GRP[+g]).join("·")}</span>
              <span style={{ fontFamily: MONO, color: MUTE }}>{x.val ? "검증 " + (base && base[0] != null ? (+base[0]).toFixed(2) + "→" : "") + (x.val[0] != null ? (+x.val[0]).toFixed(2) : "—") + "% · t " + (base ? (+base[1]).toFixed(2) + "→" : "") + (+x.val[1]).toFixed(2) : x.why || ""}</span>
              <span style={{ marginLeft: "auto", color: x.ok ? OK : HL, fontWeight: 600 }}>{x.ok ? "채택" : "보류 — 시스템을 낮춤"}</span>
            </div>))}
        </div>)}
      {/* ③ 미지수 지도 + 상세 */}
      <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", alignItems: "start" }}>
        <div style={{ ...card, overflow: "hidden" }}>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) repeat(3, 76px)", padding: "10px 12px", fontSize: 11.5, color: DIM, borderBottom: "1px solid " + LINE }}>
            <span>매매법</span>{GRP.map((g, i) => <span key={g} style={{ textAlign: "center", color: GCOL[i] }}>{g}</span>)}</div>
          <div className="bs-rail" style={{ maxHeight: 560, overflowY: "auto" }}>
            {rows.map((r) => (
              <button key={r.k} type="button" onClick={() => setSel(r.k)} aria-pressed={cur && cur.k === r.k}
                style={{ width: "100%", display: "grid", gridTemplateColumns: "minmax(0,1fr) repeat(3, 76px)", alignItems: "center", padding: "8px 12px", borderTop: "1px solid " + ROWLINE, textAlign: "left",
                         background: cur && cur.k === r.k ? "rgba(79,227,255,.07)" : "transparent" }}>
                <span style={{ fontSize: 13, color: INK, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name(r.k)}</span>
                {r.cells.map((c, g) => <span key={g} title={c.why} style={{ margin: "0 4px", textAlign: "center", fontSize: 11, padding: "3px 0", borderRadius: 5, color: ST[c.st][1], background: ST[c.st][2], border: "1px solid " + (c.st === "adopt" || c.st === "held" ? ST[c.st][1] : ROWLINE) }}>{c.st === "adopt" ? "채택" : c.st === "held" ? "보류" : c.st === "miss" ? "기본" : c.st === "few" ? "적음" : c.st === "time" ? "시간" : "—"}</span>)}
              </button>))}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, padding: "10px 12px", borderTop: "1px solid " + LINE, fontSize: 11, color: DIM }}>
            {(["adopt", "held", "miss", "few"] as St[]).map((s) => <span key={s}><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: ST[s][1], marginRight: 5 }} />{ST[s][0]}</span>)}
          </div>
        </div>
        {cur && (
          <div style={{ ...card, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
              <h4 style={{ fontSize: 17, fontWeight: 600, color: "#F2F6FC" }}>{name(cur.k)}</h4><span style={{ fontFamily: MONO, fontSize: 11.5, color: FAINT }}>{cur.k}</span></div>
            <div>
              <div style={{ fontSize: 11.5, color: DIM, marginBottom: 4 }}>기본 수식</div>
              <FormulaLine pb={cur.k} def={def[cur.k]} vals={def[cur.k]} />
              {lad[cur.k] && Object.keys(lad[cur.k]).length > 0 && <div style={{ marginTop: 6, fontSize: 11.5, color: FAINT }}>조율이 시도하는 값 · {Object.entries(lad[cur.k]).map(([k, v]: any) => (v as any[]).map((x) => fv(x, unitOf(cur.k, k))).join(" / ")).join("  ·  ")}</div>}
              <div style={{ marginTop: 4, fontSize: 11.5, color: FAINT }}>+ 공통 조건(모든 매매법) · 200일선 대비 추세 · 6개월 상대강도 순위 · 거래량 배수 · ATR 상한 — 비어 있으면 조건 없음 · + 청산(손절·ATR·익절·본전·보유일)</div>
            </div>
            {pbDef[cur.k] && pbDef[cur.k].meta && D.metaFeats && (
              <div style={{ borderTop: "1px solid " + ROWLINE, paddingTop: 12 }}>
                <div style={{ fontSize: 11.5, color: DIM, marginBottom: 6 }}>고차원 수식 계수(초록 = 높을수록 좋은 신호 · 주황 = 낮을수록) · 예측 하위 {Math.round((pbDef[cur.k].meta.q || 0) * 100)}% 거름 · 학습 {pbDef[cur.k].meta.n}건</div>
                <MetaCoef m={pbDef[cur.k].meta} feats={D.metaFeats} />
              </div>)}
            {cur.cells.map((c, g) => (
              <div key={g} style={{ borderTop: "1px solid " + ROWLINE, paddingTop: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <span style={{ padding: "2px 8px", borderRadius: 5, border: "1px solid " + GCOL[g], color: GCOL[g], fontSize: 12 }}>{GRP[g]}</span>
                  <span style={{ fontSize: 12, color: ST[c.st][1], fontWeight: 600 }}>{ST[c.st][0]}</span>
                </div>
                {(c.st === "adopt" || c.st === "held") ? <>
                  <FormulaLine pb={cur.k} def={def[cur.k]} vals={Object.assign({}, def[cur.k] || {}, c.ep || {})} />
                  {c.ex && Object.keys(c.ex).length > 0 && <div style={{ marginTop: 4, display: "flex", flexWrap: "wrap", gap: 6 }}>{Object.entries(c.ex).map(([k, v]: any) => <span key={k} style={{ fontSize: 12, fontFamily: MONO, color: c.st === "adopt" ? OK : HL, border: "1px solid " + ROWLINE, borderRadius: 5, padding: "1px 7px" }}>{exitTxt(k, v)}</span>)}</div>}
                </> : null}
                <div style={{ marginTop: 5, fontSize: 12, color: DIM }}>{c.why || (c.st === "none" ? "이 매매법은 조율 대상이 아니었습니다(퇴출·보조·횡단면 목록)." : "")}</div>
              </div>))}
          </div>)}
      </div>
    </div>);
}
