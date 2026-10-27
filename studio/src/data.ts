/* Data access — the live site fetches its own same-origin API; the standalone preview reads
   an embedded snapshot (window.__BS_DATA). Responses are cached per model in memory and in
   localStorage so a revisit paints instantly, then refreshes in the background. */
declare global { interface Window { __BS_DATA?: Record<string, any>; NeuralObservatory?: any; } }

const mem = new Map<string, any>();
const LS = (k: string) => "bsCache2_" + k;

export function cached(path: string): any {
  if (mem.has(path)) return mem.get(path);
  try { const t = localStorage.getItem(LS(path)); if (t) { const j = JSON.parse(t); mem.set(path, j); return j; } } catch (e) { /* storage blocked */ }
  return null;
}

/* [V33.691] 같은 경로를 동시에 여러 곳에서 부르면(앱 시작 + 모델 화면 · 매매법 표) 한 요청을 나눠 쓴다 — 실측: /api/playbook 같은 순간 2번 */
const inflight = new Map<string, Promise<any>>();
export async function getJSON(path: string, fresh = false): Promise<any> {
  const snap = window.__BS_DATA;
  if (snap && path in snap) { mem.set(path, snap[path]); return snap[path]; }
  const key = (fresh ? "!" : "") + path;
  const run = inflight.get(key);
  if (run) return run;
  const p = (async () => {
    const r = await fetch(path + (fresh ? (path.includes("?") ? "&" : "?") + "fresh=1" : ""), fresh ? { cache: "no-store" } : undefined);
    if (!r.ok) throw new Error(path + " HTTP " + r.status);
    const j = await r.json();
    mem.set(path, j);
    try { const s = JSON.stringify(j); if (s.length < 400000) localStorage.setItem(LS(path), s); } catch (e) { /* quota */ }
    return j;
  })();
  inflight.set(key, p);
  try { return await p; } finally { inflight.delete(key); }
}

export const nnPath = (m: string) => (m === "playbook" ? "/api/playbook" : m === "omniq" ? "/api/omni-status" : "/api/nn-viz?model=" + encodeURIComponent(m));   // [V33.612] 매매법 AI 는 자기 API
