import { useEffect, useState } from "react";
import { MODELS, type ModelKey, stateOf } from "./models";
import { cached, getJSON, nnPath } from "./data";
import { Detail } from "./views/Detail";
import { Dot } from "./views/ui";
import { pbState } from "./views/Playbook";
import { oqState } from "./views/OmniQ";

const KEEP = "bsModel2";   // [V33.612] 기본 = 매매법 AI(주력) — 옛 선택 기억은 새로 시작
export default function App() {
  const [model, setModel] = useState<ModelKey>(() => { try { const k = localStorage.getItem(KEEP) as ModelKey; if (MODELS.some((m) => m.key === k)) return k; } catch (e) { /* */ } return "playbook"; });
  const [ov, setOv] = useState<any>(() => cached(nnPath("overview")));
  const [d, setD] = useState<any>(() => cached(nnPath(model)));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  void setOv;   // [V33.617] 위원회 개요(/api/nn-viz)는 더 부르지 않는다 — 위원회 퇴역
  /* [V33.614] 매매법 AI 가 주력(한 시장 이상)이면 위원회(AI_PRIMARY) 모델들은 퇴역 — 목록에서 걷어내고 매매법 AI 만 남긴다 */
  const [pb, setPb] = useState<any>(() => cached(nnPath("playbook")));
  useEffect(() => { getJSON(nnPath("playbook")).then(setPb).catch(() => { /* */ }); }, []);
  const retired = pbState(pb).label === "주력";
  useEffect(() => { if (retired && model !== "playbook" && model !== "omniq") setModel("playbook"); }, [retired]);
  const load = (m: ModelKey, fresh = false) => {
    setBusy(true); setErr(null);
    getJSON(nnPath(m), fresh).then((j) => { if (j && (j.kind === m || j.reqModel === m || (m === "playbook" && j.ok && j.markets) || (m === "omniq" && j.ok && j.omniQ))) { setD(j); if (m === "overview") setOv(j); } else setErr("다른 모델의 응답을 받았습니다"); })
      .catch((e) => setErr(String(e && e.message || e))).finally(() => setBusy(false));
  };
  useEffect(() => { setD(cached(nnPath(model))); load(model); try { localStorage.setItem(KEEP, model); } catch (e) { /* */ } }, [model]);

  const roster = (ov && ov.roster) || [];
  const st = (key: string) => stateOf(roster.find((r: any) => r.key === key));
  const groups = ["주력", "후보 선별"];   // [V33.617] 위원회 모델 목록 퇴역(주력 전환과 무관하게) · retired=${retired}
  void retired;
  /* [V33.633] ★왼쪽 세로 목록 → 위쪽 모델 탭★ — 사용자(10/16): "모델 구조에서 왼쪽 공백이 너무 많다". 모델이 둘(매매법 AI · OMNI-Q)뿐이라
     220px 세로 목록 아래가 화면 끝까지 비었다. 탭(이름 · 역할 · 상태 점)을 위에 두고 본문이 전체 폭을 쓴다. */
  return (
    <div className="flex flex-col gap-5">
      <nav aria-label="모델" role="tablist" className="bs-rail flex gap-1 self-start overflow-x-auto rounded-[12px] border border-line bg-bg-2 p-1 max-w-full">
        {groups.flatMap((g) => MODELS.filter((m) => m.group === g).map((m) => {
          const s = m.roster ? st(m.roster) : m.key === "playbook" ? pbState(cached(nnPath("playbook")) || (model === "playbook" ? d : null)) : m.key === "omniq" ? oqState(cached(nnPath("omniq")) || (model === "omniq" ? d : null)) : null, on = m.key === model;
          return (
            <button key={m.key} role="tab" aria-selected={on} onClick={() => setModel(m.key)}
              className={"flex min-h-[48px] shrink-0 items-center gap-2.5 whitespace-nowrap rounded-[9px] py-1.5 pl-3 pr-4 text-left transition-colors " + (on ? "bg-bg-3 text-ink" : "text-ink-2 hover:text-ink")}>
              {s ? <Dot tone={s.tone} ring={s.tone === "shade"} /> : <span className="h-[7px] w-[7px] rounded-[1px] bg-rose" />}
              <span className="flex flex-col leading-tight">
                <span className="text-[13.5px] font-semibold">{m.name}</span>
                <span className="text-[11px] text-ink-3">{g}{s ? " · " + s.label : ""}</span>
              </span>
            </button>);
        }))}
      </nav>
      <main className="min-w-0">
        {err && <p className="mb-3 rounded-sm bg-[color-mix(in_srgb,var(--bs-bad)_12%,transparent)] px-3 py-2 text-[12px] text-bad">{err}</p>}
        <Detail key={model} model={model} d={d && (d.kind === model || d.reqModel === model || (model === "playbook" && d.markets) || (model === "omniq" && d.omniQ)) ? d : null} ov={ov} busy={busy} onRefresh={() => load(model, true)} />
      </main>
    </div>
  );
}
