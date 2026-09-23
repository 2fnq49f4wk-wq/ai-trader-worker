// [V33.391] ★화면이 읽는 칸을 서버가 정말 채우는가★ — 모델 상태 화면의 조용한 빈칸
//
//   이 화면들은 빈 값을 만나도 ★터지지 않는다.★ `d.inputDim!=null ? d.inputDim : '—'` 처럼
//   조용히 '—' 를 그리거나, `if(d.headDegenerate)` 처럼 경고를 그냥 안 그린다.
//   그래서 몇 달 동안 아무도 못 봤다:
//     · 전체 구조 화면은 늘 "★—차원★ · 피처 판 N" 이라고 적었다 — 서버가 inputDim 을
//       모델 탭에는 다 싣고 전체 구조에만 안 실었다.
//     · STACK 의 '후보 전원이 다수 클래스로 붕괴' 경고는 ★한 번도 뜬 적이 없다★ —
//       모델은 headDegenerate 를 들고 있고 화면은 그릴 줄 아는데, 응답에 안 실렸다.
//   터지지 않는 결함이라 로그도 안 남는다. 그래서 ★대조★ 로 잡는다:
//   화면이 응답에서 읽는 이름을 전부 긁어 서버가 그 이름을 채우는지 본다.
import fs from "node:fs";
const H = fs.readFileSync("public/index.html", "utf8");
const S = fs.readFileSync("src/index.js", "utf8");
let bad = 0;
const ok = (m) => console.log("  ok   " + m);
const no = (m) => { console.error("  FAIL " + m); bad++; };

// 중괄호 균형으로 함수 본문을 잘라 낸다(정규식으로는 중첩을 못 센다).
function body(txt, name, kws = ["function ", "async function "]) {
  let i = -1;
  for (const kw of kws) { i = txt.indexOf(kw + name + "("); if (i >= 0) break; }
  if (i < 0) return null;
  let d = 0, k = txt.indexOf("{", i);
  for (; k < txt.length; k++) {
    if (txt[k] === "{") d++;
    else if (txt[k] === "}") { d--; if (d === 0) break; }
  }
  return txt.slice(i, k + 1);
}
const names = (blk, re) => { const out = new Set(); let m; while ((m = re.exec(blk))) out.add(m[1]); return out; };

// ── ① 전체 구조(overview) — 화면이 읽는 칸을 그 응답이 채우는가 ──────────────
{
  const fe = ["NNV_renderOverview", "NNV_netSvg"].map((n) => body(H, n)).filter(Boolean).join("\n");
  if (!fe) no("화면칸: 전체 구조 렌더러를 못 찾겠다");
  else {
    const i0 = S.indexOf('const _ov = { kind: "overview"');
    const i1 = S.indexOf("_ov.roster = await buildRoster", i0);
    if (i0 < 0 || i1 < 0) no("화면칸: 전체 구조 응답 조립부를 못 찾겠다");
    else {
      const blk = S.slice(i0, i1 + 300);
      const set = new Set([...names(blk, /_ov\.([A-Za-z_][\w]*)\s*=/g), ...names(blk, /\b([A-Za-z_][\w]*)\s*:/g)]);
      const read = names(fe, /\bd\.([A-Za-z_][\w]*)/g);
      const miss = [...read].filter((k) => !set.has(k));
      if (miss.length) no("화면칸: 전체 구조가 읽는 " + miss.join("·") + " 를 서버가 안 채운다 — 화면은 조용히 '—' 를 그린다");
      else ok(`전체 구조가 읽는 ${read.size}칸을 서버가 전부 채운다`);
      if (!/inputDim:\s*LUXML\.featNames\.length/.test(blk))
        no("화면칸: 전체 구조의 inputDim 이 featNames 길이에서 안 나온다 — 손으로 적으면 판이 바뀔 때 갈라진다");
      else ok("inputDim = featNames.length (손으로 안 적는다)");
    }
  }
}

// ── ② 모델 탭 — 화면이 읽는 칸을 그 모델의 응답 함수가 채우는가 ───────────────
{
  // [V33.422] mlDNNVizData 퇴역 · omniVizData 신설.
  const SRV = ["mlMindVizData", "mlTreeVizData", "mlSeqVizData", "mlMemoVizData", "mlLinearVizData", "omniVizData"];
  const set = new Set();
  let found = 0;
  for (const fn of SRV) { const b = body(S, fn); if (b) { found++; for (const k of names(b, /\b([A-Za-z_][\w]*)\s*:/g)) set.add(k); } }
  if (found < SRV.length) no(`화면칸: 모델 응답 함수 ${found}/${SRV.length} 만 찾았다 — 이름이 바뀌면 이 검사가 헐거워진다`);
  else ok(`모델 응답 함수 ${found}종을 전부 찾았다`);
  // 전체 구조 전용 칸(다른 응답에서 옴)은 여기서 빼고 본다.
  const OV_ONLY = new Set(["combine", "dual", "roster", "stack"]);
  const rends = [...H.matchAll(/function (NNV_render\w+)\(/g)].map((m) => m[1]).filter((n) => n !== "NNV_renderOverview");
  let miss = [];
  for (const fe of rends) {
    const b = body(H, fe); if (!b) continue;
    for (const k of names(b, /\bd\.([A-Za-z_][\w]*)/g)) if (!set.has(k) && !OV_ONLY.has(k)) miss.push(fe + "." + k);
  }
  if (miss.length) no("화면칸: " + miss.join(" · ") + " 를 서버가 안 채운다 — 경고·수치가 조용히 안 그려진다");
  else ok(`모델 탭 ${rends.length}종이 읽는 칸을 서버가 전부 채운다`);
}

/* [V33.422] ③ STACK headDegenerate 절 삭제 — STACK 퇴역(그 경고를 낼 모델이 없다). */

/* [V33.422] ④ STACK 화면의 손으로 적은 차원 검사 삭제 — 그 화면이 사라졌다. */

console.log(bad ? `\n화면칸 게이트 실패 ${bad}건` : "\n화면칸 게이트 통과");
process.exit(bad ? 1 : 0);
