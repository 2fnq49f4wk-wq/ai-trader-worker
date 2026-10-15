/* Model catalogue — order, grouping and one-line purpose. Status always comes from the
   server roster (never invented here). */
export type ModelKey = "playbook" | "omniq" | "overview" | "mind" | "gbdt" | "xgb" | "lgb" | "cat" | "memo" | "seq" | "dualbull" | "dualbear" | "omni";
/* [V33.617] 위원회(AI_PRIMARY) 모델(MIND·GBDT·XGB·LGB·CAT·MEMO·SEQ·이중헤드)과 옛 OMNI(분봉)는 퇴역 — 목록에서 뺐다.
   남는 것: 주력 매매법 AI · 후보 선별 OMNI-Q(옛 OMNI 신경망 화면을 이어받음). */
export const MODELS: { key: ModelKey; roster: string; name: string; short: string; group: string; what: string }[] = [
  { key: "playbook", roster: "", name: "매매법 AI", short: "매매법", group: "주력", what: "확률 높은 종목(OMNI-Q 상위 20%) → 지금 뜬 매매법 중 닮은 과거에서 성적이 가장 좋은 것으로 사고, 그 매매법의 규칙으로 판다" },
  { key: "omniq", roster: "", name: "OMNI-Q", short: "OMNI-Q", group: "후보 선별", what: "매매법 AI 가 볼 종목을 고르는 순위 신경망(LightGBM) — 동물원·규칙·매매법 신호·실적·뉴스 피처로 5일 뒤 상대 순위를 맞힌다" },
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
