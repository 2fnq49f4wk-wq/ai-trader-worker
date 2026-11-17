import { createRoot, type Root } from "react-dom/client";
import css from "./index.css?inline";
import { useState } from "react";
import App from "./App";
import { OmniPerf } from "./views/OmniPerf";

/* [V33.851] 기본 = OMNI 성능 지표만(간단) · 버튼으로 전체 모델 구조 */
function Root() {
  const [full, setFull] = useState(false);
  if (!full) return <OmniPerf onFull={() => setFull(true)} />;
  return <div className="flex flex-col gap-3"><button onClick={() => setFull(false)} className="self-start rounded-sm border border-line bg-bg-3 px-3 py-1.5 text-[12px] text-ink-2 hover:text-ink">← 성능 지표만 보기</button><App /></div>;
}

/* window.BrainStudio.mount(el) — the trading site calls this when the "모델 구조" view opens.
   The stylesheet is injected once and every rule is scoped to #brain-studio. */
let root: Root | null = null;
function ensureCss() {
  if (document.getElementById("brain-studio-css")) return;
  const s = document.createElement("style"); s.id = "brain-studio-css"; s.textContent = css; document.head.append(s);
}
const api = {
  version: "1",
  mount(el: HTMLElement) {
    ensureCss();
    if (!el.id) el.id = "brain-studio";
    if (root) return true;
    root = createRoot(el); root.render(<Root />); return true;
  },
  unmount() { if (root) { root.unmount(); root = null; } },
};
(window as any).BrainStudio = api;
const auto = document.getElementById("brain-studio");
if (auto && (window as any).__BS_AUTO) api.mount(auto);
