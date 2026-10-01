/* Model catalogue — order, grouping and one-line purpose. Status always comes from the
   server roster (never invented here). */
export type ModelKey = "overview" | "mind" | "gbdt" | "xgb" | "lgb" | "cat" | "memo" | "seq" | "dualbull" | "dualbear" | "omni";
export const MODELS: { key: ModelKey; roster: string; name: string; short: string; group: string; what: string }[] = [
  { key: "overview", roster: "", name: "전체 결합", short: "전체", group: "결합", what: "위원들의 투표가 하나의 확률이 되는 순서" },
  { key: "mind", roster: "mind", name: "MIND", short: "MIND", group: "위원", what: "위원장 — 인수분해기계와 전문가 스태킹" },
  { key: "gbdt", roster: "gbdt", name: "GBDT", short: "GBDT", group: "위원", what: "부스팅 트리 — 기술지표 갈림" },
  { key: "xgb", roster: "xgb", name: "XGBoost", short: "XGB", group: "위원", what: "부스팅 트리 3종 합의의 한 축" },
  { key: "lgb", roster: "lgb", name: "LightGBM", short: "LGB", group: "위원", what: "부스팅 트리 3종 합의의 한 축" },
  { key: "cat", roster: "cat", name: "CatBoost", short: "CAT", group: "위원", what: "부스팅 트리 3종 합의의 한 축" },
  { key: "memo", roster: "memo", name: "MEMO", short: "MEMO", group: "위원", what: "비슷한 과거 상황(원형)의 결과를 기억" },
  { key: "seq", roster: "seq", name: "SEQ", short: "SEQ", group: "위원", what: "최근 16봉을 순서대로 읽는 트랜스포머" },
  { key: "dualbull", roster: "dual_bull", name: "이중헤드 강세", short: "강세", group: "방향", what: "오를 쪽만 따로 본다" },
  { key: "dualbear", roster: "dual_bear", name: "이중헤드 약세", short: "약세", group: "방향", what: "내릴 쪽만 따로 본다" },
  { key: "omni", roster: "omni", name: "OMNI", short: "OMNI", group: "관측", what: "분봉 한 모델이 장타·단타를 같이 배운다" },
];

export type Tone = "ok" | "warn" | "bad" | "shade" | "idle";
export function stateOf(r: any): { label: string; tone: Tone } {
  const s = r && r.state;
  if (s === "on") return { label: "정식", tone: "ok" };
  if (s === "prov") return { label: "잠정", tone: "warn" };
  if (s === "bad") return { label: "보류", tone: "bad" };
  if (s === "shadow") return { label: "섀도우", tone: "shade" };
  return { label: "대기", tone: "idle" };
}
export const toneColor: Record<Tone, string> = { ok: "var(--bs-ok)", warn: "var(--bs-warn)", bad: "var(--bs-bad)", shade: "var(--bs-shade)", idle: "var(--bs-ink3)" };

export const HZ: Record<string, string> = { "30m": "30분", "60m": "60분", "1d": "1일", "5d": "5일", "20d": "20일" };

export const f1 = (v: any, d = 1) => (v == null || isNaN(+v) ? "—" : (+v).toFixed(d));
export const pctv = (v: any, d = 1) => (v == null || isNaN(+v) ? "—" : ((+v) <= 1.0001 && (+v) >= 0 ? (+v) * 100 : +v).toFixed(d) + "%");
export const n0 = (v: any) => (v == null || isNaN(+v) ? "—" : Math.round(+v).toLocaleString("ko-KR"));
export function ago(ts: any): string {
  if (!ts) return "—";
  const m = Math.round((Date.now() - +ts) / 60000);
  if (m < 60) return m + "분 전";
  const h = Math.round(m / 60);
  if (h < 48) return h + "시간 전";
  return Math.round(h / 24) + "일 전";
}
