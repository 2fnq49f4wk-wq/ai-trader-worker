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
  /* [V33.422] mlDNNVizData 퇴역 — 대신 ★새로 붙은 탭(OMNI)★ 이 같은 계약을 지는지 본다.
     계약: 응답의 모든 반환 경로가 자기 kind 를 단다(안 달면 분기의 나머지로 조용히 샌다). */
  const om = sliceFn(S, "async function omniVizData(DB)");
  chk(!!om, "omniVizData 를 찾았다", "omniVizData 가 없다");
  if (om) {
    chk(/kind: "omni"/.test(om.body), "omniVizData 가 kind:\"omni\" 를 단다",
      "★OMNI 응답에 kind 가 없다 — 그 경로는 이름 없이 나간다★");
    const rets = om.body.split("\n").filter((l) => /^\s{2,8}return /.test(l));
    chk(rets.length >= 2, "반환 경로가 " + rets.length + "곳(모델 없음 · 정상)",
      "반환 경로를 못 세겠다");
    /* out 객체 하나를 두 경로가 함께 돌려주므로 kind 가 한 번만 적혀도 전부 이름을 단다.
       ★그 구조를 계약으로 못 박는다★ — 반환마다 새 객체를 만들면 하나가 이름을 잃는다. */
    chk(/const out = \{ kind: "omni"/.test(om.body),
      "모든 반환이 같은 out 객체를 쓴다 — 한 경로만 이름을 잃을 자리가 없다",
      "★반환마다 새 객체를 만든다 — 한 곳이 kind 를 빠뜨리면 조용히 샌다★");
  }
  chk(/data\.reqModel = modelSel;/.test(S),
    "/api/nn-viz 가 응답에 요청한 모델키를 새긴다(reqModel)",
    "★응답이 누구 것인지 안 적는다 — 화면이 늦은 응답을 골라낼 근거가 없다★");
  chk(/_ov\.reqModel = "overview";/.test(S), "전체 구조 응답도 reqModel 을 단다", "전체 구조 응답에 reqModel 이 없다");
  chk(/if \(data\.kind !== modelSel\) data\.kindMismatch/.test(S),
    "kind 와 요청 모델키가 어긋나면 서버가 먼저 표시한다",
    "kind 와 모델키가 어긋나도 서버가 모른 채 내보낸다");
}

console.log("② 탭 목록의 키를 서버가 전부 아는가 · 퇴역 모델 탭이 남아 있지 않은가");
{
  const tabs = [...H.matchAll(/class="nnv-tab[^"]*"\s+data-model="([a-z_]+)"/g)].map(m => m[1]);
  /* [V33.422] ★개수를 손으로 적지 않는다.★ 종전엔 ">= 13" 이라고 박혀 있어, 퇴역으로 탭이
     줄자 "탭 목록을 못 읽었다" 는 ★엉뚱한 사유★ 로 실패했다(이 저장소가 반복해 겪은
     '손으로 적은 숫자의 드리프트'). 세는 대신 ★관계★ 를 본다. */
  chk(tabs.length > 0 && tabs.includes("overview"), "탭 " + tabs.length + "개를 읽었다(전체 구조 포함)",
    "탭 목록을 못 읽었다");
  const disp = sliceFn(S, 'if (path === "/api/nn-viz") {');
  const linviz = sliceFn(S, "const _LINVIZ = {");
  const known = new Set(["overview"]);
  if (disp) for (const m of disp.body.matchAll(/"([a-z_]+)"/g)) known.add(m[1]);
  if (linviz) for (const m of linviz.body.matchAll(/^\s{2}([a-z_]+):/gm)) known.add(m[1]);
  const unknown = tabs.filter(t => !known.has(t));
  chk(unknown.length === 0,
    "탭 키 " + tabs.length + "개가 전부 서버 분기에 있다",
    "★서버가 모르는 탭 키: " + unknown.join(", ") + " — 누르면 엉뚱한 모델이 나온다★");
  /* 퇴역 모델(RETIRED)의 탭은 남아 있으면 안 된다 — 눌러도 410 만 돌아온다. */
  const ret = [...(S.match(/const RETIRED = \{[\s\S]*?\n\};/) || [""])[0]
    .matchAll(/^\s{2}([a-z_]+):\s*\{/gm)].map(m => m[1]);
  chk(ret.length > 0, "퇴역 명부(RETIRED)를 읽었다: " + ret.join(", "), "퇴역 명부를 못 읽었다");
  const zombie = tabs.filter(t => ret.includes(t));
  chk(zombie.length === 0, "퇴역 모델의 탭이 남아 있지 않다",
    "★퇴역했는데 탭이 남아 있다: " + zombie.join(", ") + " — 누르면 410 만 나온다★");
  /* 기본 폴백이 퇴역 모델이면, 모르는 키가 전부 그리로 샌다(V33.308 이 고친 병의 재발). */
  const fb = (S.match(/url\.searchParams\.get\("model"\) \|\| "([a-z_]+)"/) || [])[1];
  chk(fb && !ret.includes(fb), "기본 모델키(" + fb + ")가 퇴역 모델이 아니다",
    "★기본 폴백이 퇴역 모델(" + fb + ")이다 — 모르는 키가 전부 그리로 샌다★");
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
