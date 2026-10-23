/* [V33.632] 매매법 AI 구조관측 — 새 디자인(관제실 톤 · 실제 표 수치). 데이터는 /api/playbook 그대로(값을 지어내지 않는다).
   판정 요약 → 판단 흐름 7단계(지금 쓰는 실제 값) → 실제 표(지금 쓰는 매매법 전부 · 규칙 비교 · 후보 폭 비교 · 5분 단타). 시장 전환 · 표 정렬. */
import { useMemo, useState, type CSSProperties, type ReactNode } from "react";

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
};
const pbName = (k: string) => { const i = k.indexOf("+"); if (i < 0) return PB_NAMES[k] || k;
  const b = k.slice(0, i), f = k.slice(i + 1); return (PB_NAMES[b] || b) + " 수정판(" + ({ T: "추세", TL: "추세+주도주", V: "거래량" } as Record<string, string>)[f] + ")"; };
const fin = (x: any): x is number => typeof x === "number" && Number.isFinite(x);
const sg = (x: any, k = 2) => (fin(x) ? (x >= 0 ? "+" : "") + x.toFixed(k) : "—");
const n0 = (x: any) => (fin(x) ? x.toLocaleString("ko-KR") : "—");
const col = (x: any) => (!fin(x) ? MUTE : x > 0 ? POS : x < 0 ? NEG : INK);
const pos = (x: number, lim: number) => Math.max(0, Math.min(100, 50 + (x / lim) * 50));
const ruleName = (r: any) => (!r ? "—" : [r.score, r.level].concat(r.decay ? ["d" + r.decay] : []).concat(r.gate ? ["g" + r.gate] : []).join("·"));
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
      return { id: k, name: pbName(k), fam: (pbDef[k] && pbDef[k].family) || "", tier: s_ ? s_.tier : /\+|^(FROG|RESID_MOM|RS_NEWHI|NR7_TREND|DARVAS|GAP_FILL_D|VOL_DRYUP_PB)$/.test(k) ? 2 : 1, preN: p0[0], preM: p0[1], preW: p0[2],
               hoN: b[0], hoM: b[1], hoW: b[2], pick: by[k] || 0, flt: (pbDef[k] && pbDef[k].flt) || x.flt || "", tuned: x.test && x.test.tuned };
    });
    out.sort((a: any, b: any) => { const x = a[sk], y = b[sk];
      if (sk === "id") return sd * String(a.name).localeCompare(String(b.name)) * -1;
      return sd < 0 ? (fin(y) ? y : -1e9) - (fin(x) ? x : -1e9) : (fin(x) ? x : 1e9) - (fin(y) ? y : 1e9); });
    return out;
  }, [V, pbDef, sk, sd]);
  if (!R) return <p style={{ color: DIM, fontSize: 13, padding: "16px 0" }}>학습기가 아직 매매법 표를 올리지 않았습니다.</p>;
  const pass = fin(V.n) && V.n >= 30 && V.mean > 0 && V.t >= 2 && V.mean > V.base;
  const chosen = ruleName(V.rule);
  const day = String(R.day || "").replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3");
  const flow = [
    ["후보 선별 · OMNI-Q", V.candQ ? "상위 " + Math.round((1 - V.candQ) * 100) + "%" : "거름 없음", V.cand || "—"],
    ["신호 · 일봉 매매법", rows.length + "종", (() => { const n2 = rows.filter((r: any) => r.tier === 2).length; return n2 ? "1순위 " + (rows.length - n2) + " · 보조 " + n2 + "(1순위가 안 뜬 종목에만)" : "오늘 조건이 맞은 매매법만 남긴다"; })()],
    ["구조 거르개", R.panic ? "공황 차단 켜짐" : "공황 차단 꺼짐", R.panic ? "1순위 추세·모멘텀·돌파 쉼(보조는 계속)" : "시장 60일 하락·고변동이면 1순위 추세 매매법 쉼"],
    ["상황 칸 표", n0(R.daily?.cells) + "칸", "국면 × RSI × 이격 × 수익 × 거래량 칸마다 수축 평균"],
    ["고르는 규칙", chosen, "검증 구간 t 가 가장 높은 규칙"],
    ["국면 거부권", "칸 평균 < 0 · n ≥ 30", "지금 국면 칸이 손실이면 규칙과 무관하게 버린다"],
    ["판정 구간", sg(V.mean) + "%", "n " + n0(V.n) + " · 무작위 " + sg(V.base) + "% → " + (pass ? "통과" : "미통과")],
  ];
  const tabs: [string, string][] = [["pb", "매매법 " + rows.length + "종"], ["rules", "규칙 비교"], ["cand", "후보 폭 비교"], ["intra", "5분 단타"]].concat((extra || []).map((e, i) => ["x" + i, e.label] as [string, string])) as [string, string][];
  const note = tab === "pb" ? "판정 전 = 학습·검증 구간 · 판정 = 손대지 않은 최근 구간 · 고른 수 = 판정 구간에서 실제로 고른 거래 · 머리글을 누르면 정렬"
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
          {[["기준일", day], ["국면", R.regime || "—"], ["표", ago(R.ts)]].map(([k, v]) => <span key={k} style={{ padding: "7px 10px", border: "1px solid " + LINE, borderRadius: 6, color: MUTE }}>{k} <b style={{ color: INK, fontWeight: 500 }}>{v}</b></span>)}
          <span style={{ padding: "7px 10px", borderRadius: 6, border: "1px solid " + (R.panic ? NEG : LINE), color: R.panic ? NEG : MUTE }}>{R.panic ? "공황 · 추세 쉼" : "공황 아님"}</span>
          {R.brake && R.brake.on && <span style={{ padding: "7px 10px", borderRadius: 6, border: "1px solid " + NEG, color: NEG }}>실전 손실 제동</span>}
        </div>
      </div>

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
          <div style={{ fontSize: 13, color: pass ? POS : NEG }}>{pass ? "검증 통과 — 무작위보다 낫고 t ≥ 2" : "미통과 — 실전 매수 없이 관측만(그림자 판정)"}</div>
        </div>
        {[["t 값", fin(V.t) ? V.t.toFixed(2) : "—", "통과 기준 ≥ 2.0", fin(V.t) ? (V.t >= 2 ? POS : V.t < 0 ? NEG : INK) : MUTE],
          ["승률 · 표본", fin(V.win) ? V.win.toFixed(1) + "%" : "—", "거래 " + n0(V.n) + "건 · 전부 평균 " + sg(V.baseAll) + "%", INK],
          ["주력 전환", (R.indep || 0) + " / 2", "겹치지 않는 판정 구간 통과 · 연속 " + (R.passStreak || 0) + " / 2", R.primary ? POS : INK]].map(([k, v, h, c]) => (
          <div key={k} style={{ ...card, padding: 18, display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={kick}>{k}</div>
            <div style={{ fontFamily: MONO, fontSize: 28, fontWeight: 500, color: c }}>{v}</div>
            <div style={{ fontSize: 12, color: DIM }}>{h}</div>
          </div>))}
      </section>

      <section aria-label="판단 흐름" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <h3 style={{ fontSize: 16, fontWeight: 600, color: "#F2F6FC" }}>판단 흐름</h3>
          <span style={{ fontSize: 12, color: DIM }}>한 종목이 매수 후보가 되기까지 — 단계마다 지금 쓰는 실제 값</span>
        </div>
        {/* [V33.633] 7단계는 한 줄 — 좁으면 옆으로 넘긴다(혼자 떨어지는 칸 없게) */}
        <div className="bs-rail" style={{ overflowX: "auto" }}>
        <ol style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(140px, 1fr))", gap: 10 }}>
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
                  <td style={{ padding: "10px 14px", color: INK, whiteSpace: "nowrap" }}>{r.name}{r.tier === 2 && <span style={{ marginLeft: 8, fontSize: 10.5, color: HL, border: "1px solid #5A4A1A", borderRadius: 4, padding: "0 5px" }}>보조</span>}<span style={{ marginLeft: 8, fontSize: 11, color: FAINT }}>{r.id}{r.fam ? " · " + r.fam : ""}</span></td>
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

        {tab === "rules" && (
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
          </div>)}

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
        <span>수치 = 학습기(GitHub Actions)가 올린 매매법 시뮬 표 · 판정 구간 = 최근 약 100거래일(학습·규칙 고르기에 안 쓴 구간)</span>
        <span style={{ fontFamily: MONO }}>평균 = 거래당 % · 시장(등가중) 대비 · 비용 뺀 값</span>
      </footer>
    </div>);
}
