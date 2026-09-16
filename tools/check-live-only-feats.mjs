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

import { LUXML, _LIVE_ONLY_FEATS, _LIVE_ONLY_NEUTRAL, _mlExportConfig, mlBuildFeatures } from "../src/index.js";

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

    /* ══ [V33.370] ★'불변' 만으로는 모자란다 — ★같은 값★ 이어야 한다.★ ═══════════
       이 게이트의 종전 판은 6칸이 인자에 안 반응하는지만 봤다. 그래서 서빙 상수를
       1 에서 0 으로 바꿔도 통과했다 — 트레이너는 여전히 1 로 눌러 학습하는데.
       그 어긋남의 크기를 실측했다(트레이너와 같은 조건의 모의 학습):
         중립화된 칸의 1층 가중치는 ★죽지 않는다★(입력잡음 0.08 이 살려 둔다 —
         잡음 0 이면 0.17 로 감쇠, 0.08 이면 0.31 로 정보칸과 동급).
         그 칸에 서빙이 1.0 을 넣으면 로짓이 평균 0.14 → 확률로 약 ★3.6%p★.
       부스터들이 1~2%p 를 두고 다투는 자리라 이 크기는 무시할 수 없다. */
    if (rows.length === 4 && LUXML.liveCtxNeutral !== false) {
      const val = (row, n) => (Array.isArray(row) ? row[names.indexOf(n)] : row[n]);
      const wrong = live.filter((n) => val(rows[0], n) !== _LIVE_ONLY_NEUTRAL[n]);
      if (wrong.length === 0)
        ok(`서빙이 쓰는 상수가 ★중립값 표와 정확히 같다★ (${live.map((n) => n + "=" + _LIVE_ONLY_NEUTRAL[n]).join(", ")})`);
      else
        bad("서빙 상수가 중립값 표와 다르다: " +
            wrong.map((n) => `${n} 서빙 ${val(rows[0], n)} vs 표 ${_LIVE_ONLY_NEUTRAL[n]}`).join(", ") +
            " — 학습이 본 값과 서빙이 내는 값이 갈린다(로짓 약 0.14/칸)");

      /* 트레이너에게 ★실제로 내려보내는★ 값과도 맞는지 — 세 번째 사본이 다시 생기는 것을 막는다. */
      const cfg = _mlExportConfig(null);
      const idx = cfg.liveCtxIdx || [], vals = cfg.liveCtxVal || [];
      const mismatch = idx.map((c, k) => ({ name: names[c], sent: vals[k], want: _LIVE_ONLY_NEUTRAL[names[c]] }))
                          .filter((o) => o.sent !== o.want);
      if (idx.length === live.length && mismatch.length === 0)
        ok(`트레이너에게 내려보내는 중립값도 같은 표다 (${idx.length}칸)`);
      else
        bad(`익스포트 설정이 표와 다르다 — 칸수 ${idx.length}/${live.length} · ` +
            mismatch.map((o) => `${o.name} 전송 ${o.sent} vs 표 ${o.want}`).join(", "));

      /* ══ ★중립 상수를 바꾸는 것은 featVer 상향이 필요한 변경이다★ ═══════════════
         표를 바꾸면 학습·서빙이 ★같이★ 바뀌므로 그 순간의 어긋남은 없다.
         그런데 ★이미 승격돼 투표 중인 모델★ 은 옛 상수 위에서 학습됐다.
         그 모델을 새 상수로 서빙하면 정확히 위에서 잰 스큐가 난다(로짓 약 0.14/칸).
         그래서 값을 고정해 두고, 바꾸려면 featVer 를 올려 재학습하게 만든다. */
      const PIN = { sigWeight: 1, confluence: 1, stratSwing: 0, stratDay: 0, stratMom: 0, stratMR: 0 };
      const PIN_FV = 17;                     // 이 상수들이 각인된 판
      if (LUXML.featVer <= PIN_FV) {
        const moved = Object.keys(PIN).filter((n) => _LIVE_ONLY_NEUTRAL[n] !== PIN[n]);
        const gone = Object.keys(PIN).filter((n) => !(n in _LIVE_ONLY_NEUTRAL));
        if (moved.length === 0 && gone.length === 0)
          ok(`중립 상수가 featVer ${PIN_FV} 각인값 그대로다 — 이미 승격된 모델이 배운 값과 같다`);
        else
          bad("★중립 상수가 바뀌었는데 featVer 가 그대로다★ — 이미 투표 중인 모델은 옛 상수로 학습됐다: " +
              moved.map((n) => `${n} ${PIN[n]}→${_LIVE_ONLY_NEUTRAL[n]}`).concat(gone.map((n) => n + " 사라짐")).join(", ") +
              ` · 바꾸려면 LUXML.featVer 를 ${PIN_FV} 위로 올려 재학습할 것`);
      } else {
        ok(`featVer ${LUXML.featVer} > ${PIN_FV} — 재각인된 판이라 중립 상수 변경이 허용된다(핀 갱신 필요)`);
      }

      // 표와 집합이 같은 것에서 나오는가(한 벌인지)
      if (JSON.stringify([...live].sort()) === JSON.stringify(Object.keys(_LIVE_ONLY_NEUTRAL).sort()))
        ok("집합과 중립값 표가 ★같은 한 벌★ 이다(이름이 두 곳에 따로 적혀 있지 않다)");
      else
        bad("집합과 중립값 표의 이름이 다르다 — 목록이 다시 두 벌이 됐다");
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
