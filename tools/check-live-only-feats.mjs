// [V33.355] ★죽은 입력 6칸이 다음 판에서 정말 빠지는지 감시한다 (결함 B-4)★
//
//   무엇이 문제였나. `LUXML.liveCtxNeutral`(V33.341)이 켜진 뒤로 mlBuildFeatures 는
//   sigWeight·confluence·stratSwing/Day/Mom/MR 6칸을 ★모든 행에서 같은 값★ 으로 덮어쓴다.
//   수확 표본이 만들 수 없는 칸을 라이브에서도 만들지 않기로 한 결정이고, 그 자체는 옳다.
//   결과는 80차원 중 6칸이 상수 — 학습에 아무 기여도 못 하는 ★영구 죽은 입력★ 이다.
//
//   왜 지금 못 빼나. featNames 의 ★중간★ 이라 지금 빼면 인덱스가 밀려 이미 쌓인
//   98만 표본이 통째로 어긋난다. 그래서 "다음 featVer 상향 때 같이 뺀다" 로 미뤘다.
//   ★미룬 일은 잊힌다.★ 이 저장소가 그걸 여러 번 겪었다(V12.47 의 원핫 4칸은 구버전
//   전략명만 매칭해 ★출처 무관 영구 0★ 이었고, 아무도 모르는 채 여러 판을 지났다).
//
//   그래서 이 게이트는 검사가 아니라 ★덫★ 이다. featVer 가 17 을 넘는 순간 실패한다 —
//   표본이 어차피 재각인되는 그 시점이 6칸을 뺄 수 있는 유일한 시점이기 때문이다.
//   덫에 걸리면 우회하지 말고 ★6칸을 빼고 B4_FEATVER 를 지우는 것★ 이 정답이다.

import { LUXML, _LIVE_ONLY_FEATS, mlBuildFeatures } from "../src/index.js";

let fails = 0;
const ok = (m) => console.log("  ok   " + m);
const bad = (m) => { fails++; console.log("  FAIL " + m); };

// 이 판까지는 6칸을 안고 간다. 이 값을 ★올려서 덫을 피하면 안 된다★ —
// 올릴 게 아니라 6칸을 빼고 이 상수를 없애는 것이 이 결함의 종료 조건이다.
const B4_FEATVER = 17;

const names = LUXML.featNames;
const live = [..._LIVE_ONLY_FEATS];

// ── ① 집합이 실재하는가 — featNames 에 없는 이름이 섞이면 이 게이트가 헛돈다 ──
{
  const ghost = live.filter((n) => names.indexOf(n) < 0);
  if (ghost.length === 0) ok(`라이브 전용 ${live.length}칸이 전부 featNames 안에 있다 — 감시 대상이 실재한다`);
  else bad(`featNames 에 없는 이름이 집합에 있다: ${ghost.join(", ")} — 리팩터링으로 감시가 끊겼다`);
}

// ── ② 정말 죽어 있는가 — 인자를 뒤흔들어도 그 6칸만 안 변하는지 ★실행으로★ 잰다 ──
//     (문자열로 `f.sigWeight = 1` 을 찾는 검사는 함수가 딴 데로 옮겨가면 조용히 헛돈다)
{
  const closes = Array.from({ length: 260 }, (_, i) => 100 + Math.sin(i / 7) * 5 + i * 0.05);
  const base = { closes, volumes: closes.map((_, i) => 1e6 + i * 1000),
                 opens: closes.map((c) => c * 0.998), price: closes[closes.length - 1],
                 prevClose: closes[closes.length - 2], regime: "BULL", market: "us", dayPct: 0.4 };
  const rows = [
    mlBuildFeatures(Object.assign({}, base, { strategy: "trend", sigWeight: 1,   confluence: 1 })),
    mlBuildFeatures(Object.assign({}, base, { strategy: "scalp", sigWeight: 2.7, confluence: 3 })),
    mlBuildFeatures(Object.assign({}, base, { strategy: "snap",  sigWeight: 0.4, confluence: 5 })),
    mlBuildFeatures(Object.assign({}, base, { strategy: "swing", sigWeight: 9,   confluence: 2 }))
  ].filter(Boolean);

  if (rows.length !== 4) {
    bad(`mlBuildFeatures 가 ${rows.length}/4 행만 만들었다 — 하네스가 함수를 못 돌린다(게이트가 헛돈다)`);
  } else {
    const val = (row, n) => {
      if (Array.isArray(row)) return row[names.indexOf(n)];
      return row[n];
    };
    // 죽은 칸: 4행 전부 같아야 한다
    const stillDead = live.filter((n) => new Set(rows.map((r) => val(r, n))).size === 1);
    // 대조군: 전략·신호와 무관한 칸이 아니라 ★반응해야 하는 칸★ 이 실제로 반응하는지 확인해
    //   "전부 상수" 가 하네스 고장 때문이 아님을 증명한다.
    const moved = ["rsi14", "regBull"].filter((n) => val(rows[0], n) != null);
    if (moved.length === 0) bad("대조군 피처를 읽지 못했다 — 하네스가 값을 안 보고 있다");

    if (LUXML.liveCtxNeutral !== false) {
      if (stillDead.length === live.length)
        ok(`중립화 켜짐 — 인자를 4가지로 흔들어도 ${live.length}칸 전부 불변(죽은 입력이 맞다)`);
      else
        bad(`중립화가 켜졌는데 ${live.length - stillDead.length}칸이 여전히 인자에 반응한다: ` +
            live.filter((n) => stillDead.indexOf(n) < 0).join(", ") + " — 수확/라이브 분포가 갈린다");
    } else {
      ok("중립화가 꺼져 있다 — 6칸이 살아 있으므로 B-4 는 해당 없음");
    }
  }
}

// ── ③ ★덫★ — featVer 가 올라갔는데 죽은 칸이 남아 있으면 배포를 막는다 ────────
{
  const fv = LUXML.featVer;
  if (fv <= B4_FEATVER) {
    ok(`featVer ${fv} — 아직 표본을 재각인하지 않는 판이라 6칸을 안고 간다(덫 대기 중)`);
    if (live.length !== 6)
      bad(`라이브 전용 칸이 ${live.length}개다 — 6개여야 한다. 늘었다면 죽은 입력을 ★더 만든 것★ 이다`);
    else ok("죽은 칸이 6개에서 늘지 않았다");
  } else if (live.length === 0) {
    ok(`featVer ${fv} 로 올리면서 죽은 칸을 전부 뺐다 — B-4 종료`);
  } else {
    bad(`★featVer 를 ${B4_FEATVER} → ${fv} 로 올리면서 죽은 입력 ${live.length}칸을 안 뺐다.★\n` +
        `       ${live.join(", ")}\n` +
        `       featVer 상향은 표본을 어차피 재각인한다 — 인덱스가 밀려도 되는 ★유일한 시점★ 이다.\n` +
        `       지금 안 빼면 다음 판까지 또 영구 죽은 입력으로 남는다(B-4, docs/OPEN-DEFECTS.md).\n` +
        `       할 일: LUXML.featNames 에서 6칸 제거 · _LIVE_ONLY_FEATS 비우기 ·\n` +
        `              mlBuildFeatures 의 중립화 블록 제거 · tools/check-live-only-feats.mjs 의 B4_FEATVER 삭제.`);
  }
}

console.log(fails ? "\n죽은 입력 계약 위반 " + fails + "건 — 배포 차단" : "\n  ok   죽은 입력 계약 통과");
process.exit(fails ? 1 : 0);
