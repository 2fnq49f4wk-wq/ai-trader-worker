/* ═══════════════════════════════════════════════════════════════════════════
   [V33.308] 두뇌 관측에서 탭을 옮기면 ★그 탭의 그림★ 이 나와야 한다

   ■ 무슨 일이 있었나
     "memo 를 눌렀는데 dnn 이 보인다."
     openNnViz 를 부르는 자리가 다섯이다 — 탭 클릭(switchNnModel) · 화면 전환
     (setBrainView) · showPage('nnviz') · resize/orientationchange 재로드 ·
     헤더 새로고침. 그래서 요청이 겹치는데, 종전 코드는 ★도착 순서대로 무조건 그렸다★.
     앞서 보낸 무거운 응답(DNN 은 21MB 청크 로드라 제일 느리다)이 뒤늦게 도착해
     새 탭 그림을 덮었다. 그게 증상이다.

     그리고 왜 하필 항상 DNN 이었나 — NNV_render 의 분기가 kind 를 하나씩 보다가
     ★아무 데도 안 걸리면 말없이 DNN 렌더러로 떨어졌기★ 때문이다. mlDNNVizData 만
     kind 를 안 달고 있었고, 그래서 (ㄱ) 늦게 온 다른 탭 응답 (ㄴ) kind 없는 옛 캐시
     (ㄷ) 서버가 모르는 모델키 — 원인 셋이 전부 "DNN" 이라는 한 증상으로 나왔다.
     원인이 셋인데 증상이 하나면 어디가 틀렸는지 알 수가 없다.

   ■ 그래서 무엇을 고정하나
     ① 응답은 자기가 어느 탭의 것인지 말한다(kind·reqModel) — DNN 도 예외 없이.
     ② 화면은 ★보낸 순서★ 를 세어 최신 요청의 응답만 그린다.
     ③ 모델이 어긋난 데이터는 그리지 않는다 — 조용히 DNN 으로 떨어지지 않는다.
     ④ 탭 목록에 있는 키는 서버가 전부 알아야 한다 — 모르면 기본값 DNN 으로 샌다.
     이 검사는 ②③ 을 ★말이 아니라 실제로 돌려서★ 본다(가짜 DOM·가짜 fetch).
   ═══════════════════════════════════════════════════════════════════════════ */
import { readFileSync } from "node:fs";

const S = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const H = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
let fails = 0;
const chk = (c, ok, bad) => { if (c) console.log("  ok   " + ok); else { console.log("  FAIL " + bad); fails++; } };

/* 중괄호를 세어 함수 본문을 그대로 떼어낸다 — 정규식으로 자르면 중첩에서 끊긴다. */
function sliceFn(src, header) {
  const i = src.indexOf(header);
  if (i < 0) return null;
  let j = src.indexOf("{", i), depth = 0, k = j;
  for (; k < src.length; k++) {
    const c = src[k];
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (!depth) break; }
  }
  return { start: i, open: j, end: k, body: src.slice(j + 1, k), whole: src.slice(i, k + 1) };
}

console.log("① 서버 응답은 자기가 어느 탭의 것인지 말하는가");
{
  const dnn = sliceFn(S, "async function mlDNNVizData(DB)");
  chk(!!dnn, "mlDNNVizData 를 찾았다", "mlDNNVizData 가 없다");
  if (dnn) {
    /* 이 함수의 반환은 넷(캐시 재사용 · 미학습 미리보기 · 정상 · catch). 전부 kind 를 달아야 한다.
       하나라도 빠지면 그 경로가 다시 '이름 없는 payload' 가 되어 분기의 나머지로 떨어진다. */
    const lines = dnn.body.split("\n");
    const rets = [];
    for (let i = 0; i < lines.length; i++) {
      if (!/^\s{2,8}(return (\{|Object\.assign)|\} catch \(e\) \{ return \{)/.test(lines[i])) continue;
      rets.push(lines.slice(i, i + 4).join("\n"));   // 반환문이 여러 줄에 걸쳐 있다
    }
    const named = rets.filter(t => /kind: "dnn"/.test(t));
    chk(rets.length >= 4 && named.length === rets.length,
      "mlDNNVizData 의 반환 " + rets.length + "곳이 전부 kind:\"dnn\" 을 단다",
      "★kind 없는 반환이 남아 있다(" + (rets.length - named.length) + "/" + rets.length + ") — 그 경로는 또 이름 없이 나간다★");
  }
  chk(/data\.reqModel = modelSel;/.test(S),
    "/api/nn-viz 가 응답에 요청한 모델키를 새긴다(reqModel)",
    "★응답이 누구 것인지 안 적는다 — 화면이 늦은 응답을 골라낼 근거가 없다★");
  chk(/_ov\.reqModel = "overview";/.test(S), "전체 구조 응답도 reqModel 을 단다", "전체 구조 응답에 reqModel 이 없다");
  chk(/if \(data\.kind !== modelSel\) data\.kindMismatch/.test(S),
    "kind 와 요청 모델키가 어긋나면 서버가 먼저 표시한다",
    "kind 와 모델키가 어긋나도 서버가 모른 채 내보낸다");
}

console.log("② 탭 목록의 키를 서버가 전부 아는가 (모르면 기본값 DNN 으로 샌다)");
{
  const tabs = [...H.matchAll(/class="nnv-tab[^"]*"\s+data-model="([a-z_]+)"/g)].map(m => m[1]);
  chk(tabs.length >= 13, "탭 " + tabs.length + "개를 읽었다", "탭 목록을 못 읽었다");
  const disp = sliceFn(S, 'if (path === "/api/nn-viz") {');
  const linviz = sliceFn(S, "const _LINVIZ = {");
  const known = new Set(["overview", "dnn"]);
  if (disp) for (const m of disp.body.matchAll(/"([a-z_]+)"/g)) known.add(m[1]);
  if (linviz) for (const m of linviz.body.matchAll(/^\s{2}([a-z_]+):/gm)) known.add(m[1]);
  const unknown = tabs.filter(t => !known.has(t));
  chk(unknown.length === 0,
    "탭 키 " + tabs.length + "개가 전부 서버 분기에 있다",
    "★서버가 모르는 탭 키: " + unknown.join(", ") + " — 누르면 DNN 이 나온다★");
}

console.log("③ 화면이 보낸 순서를 세어 늦은 응답을 버리는가 (실제로 돌려본다)");
{
  const openSrc = sliceFn(H, "window.openNnViz = function(refreshOnly, modelSwitch){");
  chk(!!openSrc, "openNnViz 를 찾았다", "openNnViz 가 없다");

  const stubs = () => {
    const stage = { innerHTML: "" };
    return {
      document: { getElementById: () => stage },
      localStorage: { getItem: () => null, setItem: () => {} },
      LUXR: { set: () => {} },
      console: { warn: () => {}, error: () => {} }
    };
  };
  /* 느린 DNN 응답 뒤에 빠른 MEMO 응답 — 실제 사고 순서 그대로 재현한다. */
  const race = async (src) => {
    const painted = [];
    const NNV = { timer: null, model: "dnn", seq: 0, curKey: "overview" };
    const st = stubs();
    const delays = { dnn: 40, memo: 5 };
    const fetchStub = (u) => {
      const m = /model=([a-z_]+)/.exec(u)[1];
      return new Promise(res => setTimeout(() => res({ json: () => Promise.resolve({ kind: m, reqModel: m }) }), delays[m]));
    };
    const render = (d, want) => { painted.push((d && d.kind) || "(없음)"); return true; };
    const fn = new Function("NNV", "document", "localStorage", "fetch", "LUXR", "NNV_render", "console", "window",
      "var window = arguments[7]; " + src.whole.replace("window.openNnViz =", "return"))
      (NNV, st.document, st.localStorage, fetchStub, st.LUXR, render, st.console, {});
    fn();                               // DNN 탭 — 느린 요청이 먼저 나간다
    NNV.model = "memo"; fn(0, true);    // 사용자가 MEMO 를 누른다
    await new Promise(r => setTimeout(r, 120));
    return { painted, NNV };
  };

  if (openSrc) {
    const r = await race(openSrc);
    chk(r.painted[r.painted.length - 1] === "memo",
      "MEMO 를 누른 뒤 늦게 온 DNN 응답이 화면을 덮지 않는다(그린 순서: " + r.painted.join(" → ") + ")",
      "★늦게 온 DNN 응답이 MEMO 화면을 덮었다(" + r.painted.join(" → ") + ") — 바로 그 버그다★");
    chk(r.painted.indexOf("dnn") === -1,
      "지나간 탭의 응답은 아예 그리지 않는다",
      "지나간 탭의 응답을 그렸다");
    chk(r.NNV.curKey === "memo",
      "요청을 보내는 순간 curKey 가 새 탭으로 바뀐다 — 캐시로 먼저 그린 화면이 이전 모델 이름표를 달지 않는다",
      "★curKey 가 응답을 기다린다 — 첫 화면이 이전 모델의 합류 상태를 단다★");

    /* 변이 — 순서 표를 빼면 이 검사가 반드시 실패해야 한다. */
    const broken = { whole: openSrc.whole.replace(/if\(reqId !== NNV\.seq\) return;[^\n]*\n/g, "") };
    const rb = await race(broken);
    chk(rb.painted[rb.painted.length - 1] === "dnn",
      "변이: 순서 표를 빼면 다시 DNN 이 덮는다 — 이 검사가 실제로 그 버그를 잡는다",
      "★변이를 넣어도 통과한다 — 이 검사는 아무것도 안 보고 있다★");
  }
}

console.log("④ 모델이 어긋난 데이터는 그리지 않는가 (조용히 DNN 으로 떨어지지 않는다)");
{
  const rf = sliceFn(H, "function NNV_render(d, want){");
  chk(!!rf, "NNV_render 를 찾았다", "NNV_render 가 없다(서명에 want 가 빠졌을 수 있다)");
  if (rf) {
    const cut = rf.body.indexOf("// [V12.3]");
    chk(cut > 0, "확인 절차가 그리기 전에 온다", "확인 절차가 그리기 뒤에 있다 — 이미 덮은 다음이다");
    const guard = rf.body.slice(0, cut);
    const g = new Function("d", "want", "NNV", "console", guard + "\nreturn true;");
    const NNV = { curKey: "memo", model: "memo" };
    const C = { warn: () => {} };
    const cases = [
      [{ kind: "memo", reqModel: "memo" }, "memo", true,  "요청한 탭의 응답은 그린다"],
      [{ kind: "dnn",  reqModel: "dnn"  }, "memo", false, "MEMO 를 요청했는데 온 DNN 응답은 버린다"],
      [{ kind: "memo" },                   "memo", true,  "kind 만 있어도 맞으면 그린다(옛 캐시)"],
      [{ trained: true },                  "memo", false, "★kind 없는 데이터를 MEMO 자리에 그리지 않는다★"],
      [{ trained: true },                  "dnn",  true,  "kind 없는 옛 DNN 캐시는 DNN 탭에서만 통과한다"],
      [{ kind: "gbdt" },                   "xgb",  false, "부스터끼리도 섞이지 않는다"]
    ];
    for (const [d, want, exp, msg] of cases) {
      chk(g(d, want, NNV, C) === exp, msg, "★" + msg + " — 그렇지 않다★");
    }
    /* 변이 — 확인을 빼면 kind 없는 데이터가 MEMO 자리에서 통과해버린다. */
    const mut = guard.replace(/if\(_k \? \(_k !== want\)[\s\S]*?\n      \}\n/, "");
    const gm = new Function("d", "want", "NNV", "console", mut + "\nreturn true;");
    chk(gm({ trained: true }, "memo", NNV, C) === true,
      "변이: kind 확인을 빼면 kind 없는 데이터가 통과한다 — 이 검사가 그걸 잡는다",
      "★변이를 넣어도 결과가 같다 — 이 검사는 아무것도 안 보고 있다★");
  }
  chk(/painted = \(NNV_render\(JSON\.parse\(c\), model\) !== false\)/.test(H),
    "캐시로 그릴 때도 '안 그려졌다' 를 호출한 쪽이 안다 — 안 그려졌으면 로딩 표시가 남는다",
    "★안 그려졌는데 그렸다고 표시한다 — 빈 화면이 그대로 남는다★");
  chk(/if\(NNV_render\(d, model\) === false\) return;/.test(H),
    "모델이 어긋난 응답은 캐시에도 남기지 않는다",
    "어긋난 응답을 캐시에 남긴다 — 다음에 열 때 그 그림부터 나온다");
}

console.log(fails ? "\n실패 " + fails + "건" : "\n전부 통과");
process.exit(fails ? 1 : 0);
