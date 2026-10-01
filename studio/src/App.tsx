import { useEffect, useState } from "react";
import { MODELS, type ModelKey, stateOf } from "./models";
import { cached, getJSON, nnPath } from "./data";
import { Detail } from "./views/Detail";
import { Dot } from "./views/ui";

const KEEP = "bsModel";
export default function App() {
  const [model, setModel] = useState<ModelKey>(() => { try { const k = localStorage.getItem(KEEP) as ModelKey; if (MODELS.some((m) => m.key === k)) return k; } catch (e) { /* */ } return "overview"; });
  const [ov, setOv] = useState<any>(() => cached(nnPath("overview")));
  const [d, setD] = useState<any>(() => cached(nnPath(model)));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { getJSON(nnPath("overview")).then(setOv).catch(() => { /* nav still works from cache */ }); }, []);
  const load = (m: ModelKey, fresh = false) => {
    setBusy(true); setErr(null);
    getJSON(nnPath(m), fresh).then((j) => { if (j && (j.kind === m || j.reqModel === m)) { setD(j); if (m === "overview") setOv(j); } else setErr("다른 모델의 응답을 받았습니다"); })
      .catch((e) => setErr(String(e && e.message || e))).finally(() => setBusy(false));
  };
  useEffect(() => { setD(cached(nnPath(model))); load(model); try { localStorage.setItem(KEEP, model); } catch (e) { /* */ } }, [model]);

  const roster = (ov && ov.roster) || [];
  const st = (key: string) => stateOf(roster.find((r: any) => r.key === key));
  const groups = ["결합", "위원", "방향", "관측"];
  return (
    <div className="grid gap-5 md:grid-cols-[220px_minmax(0,1fr)] md:gap-8">
      {/* phones: one compact strip · desktop: a quiet grouped list */}
      <nav aria-label="모델" className="bs-rail flex gap-1.5 overflow-x-auto md:block md:overflow-visible">
        {groups.map((g) => (
          <div key={g} className="contents md:mb-4 md:block">
            <div className="hidden px-2 pb-1 text-[10.5px] font-medium uppercase tracking-[.08em] text-ink-3 md:block">{g}</div>
            {MODELS.filter((m) => m.group === g).map((m) => {
              const s = m.roster ? st(m.roster) : null, on = m.key === model;
              return (
                <button key={m.key} onClick={() => setModel(m.key)} aria-pressed={on}
                  className={"flex shrink-0 items-center gap-2 whitespace-nowrap rounded-sm px-2.5 py-1.5 text-[13px] transition-colors md:w-full md:py-2 " + (on ? "bg-bg-3 text-ink" : "text-ink-2 hover:text-ink")}>
                  {s ? <Dot tone={s.tone} ring={s.tone === "shade"} /> : <span className="h-[7px] w-[7px] rounded-[1px] bg-rose" />}
                  <span className="md:hidden">{m.short}</span><span className="hidden md:inline">{m.name}</span>
                  {s && <span className="ml-auto hidden text-[11px] text-ink-3 md:inline">{s.label}</span>}
                </button>);
            })}
          </div>
        ))}
      </nav>
      <main className="min-w-0">
        {err && <p className="mb-3 rounded-sm bg-[color-mix(in_srgb,var(--bs-bad)_12%,transparent)] px-3 py-2 text-[12px] text-bad">{err}</p>}
        <Detail key={model} model={model} d={d && (d.kind === model || d.reqModel === model) ? d : null} ov={ov} busy={busy} onRefresh={() => load(model, true)} />
      </main>
    </div>
  );
}
