import { createRoot, type Root } from "react-dom/client";
import css from "./index.css?inline";
import App from "./App";

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
    root = createRoot(el); root.render(<App />); return true;
  },
  unmount() { if (root) { root.unmount(); root = null; } },
};
(window as any).BrainStudio = api;
const auto = document.getElementById("brain-studio");
if (auto && (window as any).__BS_AUTO) api.mount(auto);
