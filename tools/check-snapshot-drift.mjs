/* ═══════════════════════════════════════════════════════════════════════════
   [V33.247] ★사진 한 장이 26시간 동안 진실 행세를 했다★ — 굶은 스냅샷

   사용자 보고: "모델 8개 중 돌아가는 게 2개밖에 없다"(화면 3/8).
   Modal 학습 워크플로는 3회 연속 실패해 있었고, 죽은 자리가 이랬다:

     /root/modal_train.py:209  cut_ts = TS[N - n_val] - embargo_ms
     IndexError: index -12 is out of bounds for axis 0 with size 8

   N=8. 51.7만이 아니라 8이다. 워커 로그가 이유를 그대로 말한다:

     [ML-EXPORT] 외부 트레이너가 표본 수집 시작 — R2 스냅샷 1파트/total=8   (매 회차)

   ■ 어떻게 8이 됐나
   스냅샷은 뜨는 순간의 풀 크기를 total 에 박아 두고, 12시간은 다시 뜨지 않으며,
   익스포트는 그것을 26시간까지 ★D1 보다 우선해서★ 서빙한다. V33.239 가 featVer 를
   13→14 로 올린 직후 v14 풀에는 8건뿐이었고(캐치업 수확 전이니 당연하다), 하필 그때
   사진이 떠서 done 도장을 찍었다. 몇 시간 뒤 풀은 517,924건이 됐지만 사진은 8이었다.

   ■ 두 군데가 동시에 잘못돼 있었다
   ① 신선도를 ★시계로만★ 쟀다. 풀이 100배가 돼도 "12시간 안 지났다" 로 굶은 사진을 낸다.
      게다가 빌더는 장외에만 돌아서, 장중에는 무효화될 기회조차 없다 → 익스포트도 봐야 한다.
   ② 학습기의 '표본 부족' 가드가 전부 크래시 지점 ★뒤★ 에 있었다
      (GBDT<400 · 부스팅<500 · FM<200 — 셋 다 209행 뒤). 가드가 크래시보다 뒤면 없는 것과 같다.
      그리고 크래시는 원인을 말하지 않는다 — 그래서 이 진단에 로그 왕복이 여러 번 들었다.

   여기서 지키는 것:
     · 사진과 살아 있는 풀이 크게 어긋나면 시각과 무관하게 무효다
     · 익스포트도 그 판정을 한다(빌더는 장외 전용이므로) — 그리고 ★모든 페이지가 같은 소스★
     · 정상 범위의 증가로는 무효화되지 않는다(매 틱 재구축 방지)
     · 표본이 적으면 학습기는 크래시가 아니라 ★이유를 적고★ 정상 종료한다
   ═══════════════════════════════════════════════════════════════════════════ */
import { readFileSync } from "node:fs";
const S = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const PY = readFileSync(new URL("../trainer/modal/modal_train.py", import.meta.url), "utf8");
let fails = 0;
const chk = (c, ok, bad) => { if (c) console.log("  ok   " + ok); else { console.log("  FAIL " + bad); fails++; } };

/* ── ① 드리프트 판정식 — 실측 수치로 재현하고, 헛발동도 막는지 본다 ── */
console.log("① 드리프트 판정 (실측 8 vs 517,924)");
{
  // 소스에서 판정식을 떼어 쓴다 — 문구가 아니라 ★식★ 이 계약이다.
  const m = /Math\.abs\(_live - _snapN\) > Math\.max\(50, _snapN \* 0\.25\)/.test(S);
  chk(m, "익스포트가 |실제-사진| > max(50, 사진×0.25) 로 판정한다",
    "익스포트에 드리프트 판정식이 없다 — 굶은 사진이 그대로 나간다");
  const drift = (live, snap) => Math.abs(live - snap) > Math.max(50, snap * 0.25);

  chk(drift(517924, 8) === true,
    "프로덕션 그대로(사진 8 · 실제 517,924) → 무효 판정",
    "실측 상황을 무효로 잡지 못한다 — 이 검사의 전제가 깨졌다");
  chk(drift(517924, 517924) === false,
    "사진이 맞으면 그대로 쓴다",
    "정확한 사진을 버린다 — D1 폭주가 돌아온다");
  chk(drift(518500, 517924) === false,
    "하루치 정상 증가(+576)로는 무효화되지 않는다 — 매 틱 재구축 방지",
    "정상 증가에도 재구축한다 — 스냅샷이 의미를 잃는다");
  chk(drift(700000, 517924) === true,
    "재구축급 증가(+35%)는 무효 — 새 판 표본을 학습기가 받는다",
    "큰 증가를 못 잡는다");
  chk(drift(60, 8) === true && drift(40, 8) === false,
    "절대하한 50 이 작은 사진의 잡음 재구축을 막는다(8→40 유지, 8→60 무효)",
    "작은 수에서 비율만 쓰면 8→10 에도 재구축한다");
}

/* ── ② 두 곳 모두에서 무효화되는가 · 소스가 섞이지 않는가 ── */
console.log("② 무효화 지점");
{
  const bld = S.slice(S.indexOf("async function mlSnapshotBuildStep"), S.indexOf("\n}", S.indexOf("progress: st.next")));
  chk(/_drift/.test(bld) && /st\.done = false/.test(bld),
    "빌더가 드리프트를 보고 done 을 내린다(다시 뜬다)",
    "빌더가 12시간 시계만 본다 — 굶은 사진이 12시간 더 산다");
  const exp = S.slice(S.indexOf('if (path === "/api/ml-export")'), S.indexOf('/api/ml-export-st'));
  chk(/_mlCountsCached/.test(exp),
    "익스포트가 살아 있는 풀 크기를 본다(60초 캐시 — 페이지마다 D1 을 안 때린다)",
    "익스포트가 사진을 검증 없이 서빙한다 — 빌더는 장외 전용이라 장중 내내 굶은 채다");
  // ★소스 혼합 금지★ — 판정이 offset 에 걸리면 0페이지만 D1, 나머지는 R2 가 된다
  // 검증 블록 전체 — 두 번째 `if (_snapOk) {`(실제 서빙 분기) 앞까지가 판정부다.
  const _i0 = exp.indexOf("let _snapOk");
  const _i1 = exp.indexOf("if (_snapOk) {", _i0 + 10);
  const _i2 = exp.indexOf("if (_snapOk) {", _i1 + 10);
  const cond = exp.slice(_i0, _i2 > 0 ? _i2 : _i1);
  chk(!/offset\s*[=!<>]==?\s*0\s*\)?\s*&&/.test(cond.replace(/if \(offset === 0\) \{[\s\S]*?\}/g, "")),
    "판정 자체는 offset 과 무관하다 — 모든 페이지가 같은 소스를 쓴다",
    "판정이 offset 에 걸려 있다 — 0페이지는 D1, 1페이지는 R2 로 섞인 표본이 만들어진다");
  chk(/_firstPage/.test(cond),
    "로그는 첫 페이지에서만 남긴다(26페이지가 같은 줄을 26번 찍지 않게)",
    "무효화 로그가 페이지마다 찍힌다");
}

/* ── ④ '첫 페이지' 판정 — offset 으로는 알 수 없다 ── */
console.log("④ 첫 페이지 판정 (커서 페이지네이션)");
{
  const exp = S.slice(S.indexOf('if (path === "/api/ml-export")'), S.indexOf('/api/ml-export-st'));
  chk(/const _firstPage = offset === 0 && !Number\(url\.searchParams\.get\("cursorTs"\)\)/.test(exp),
    "첫 페이지 = offset 0 ★그리고★ 커서 없음",
    "첫 페이지를 offset 으로만 판정한다 — 커서 페이지는 offset 을 안 보내므로 전부 첫 페이지가 된다");
  /* [V33.260] 종전엔 "ML-EXPORT 로그 개수 == if(_firstPage) 개수" 로 셌다. 그건 프록시다 —
     ML-EXPORT 와 무관한 _firstPage 블록을 하나만 더 넣어도(실제로 DNN 구성 판단을 넣으며
     그랬다) 개수가 어긋나 멀쩡한 코드가 실패한다. 반대로 로그를 가드 밖으로 빼면서 다른
     가드를 하나 더 넣으면 개수가 맞아 통과한다 — 양방향으로 틀린다.
     세는 대신 ★실제로 안에 들어 있는지★ 를 본다: 각 로그 위치에서 가장 가까운
     `if (_firstPage) {` 를 찾아 거기서부터 로그까지 중괄호 깊이가 한 번도 0 이 되지
     않으면 그 블록 안이다. */
  const inFirstPage = (idx) => {
    const g = exp.lastIndexOf("if (_firstPage) {", idx);
    if (g < 0) return false;
    let d = 0;
    for (let k = exp.indexOf("{", g); k < idx; k++) {
      const c = exp[k];
      if (c === "{") d++;
      else if (c === "}") { d--; if (d === 0) return false; }   // 블록이 로그 전에 닫혔다
    }
    return d > 0;
  };
  const re = /ctx\.waitUntil\(log\(env\.DB, "(?:INFO|WARN)", null, "\[ML-EXPORT\]/g;
  let m, logs = 0, outside = [];
  while ((m = re.exec(exp)) !== null) { logs++; if (!inFirstPage(m.index)) outside.push(m.index); }
  chk(logs > 0 && outside.length === 0,
    "ML-EXPORT 로그 " + logs + "곳 전부가 첫 페이지 블록 ★안에★ 있다(개수가 아니라 포함관계로 확인)",
    "로그 " + logs + "곳 중 " + outside.length + "곳이 가드 밖이다 — 페이지마다 찍힌다");
  // 실측 재현: 트레이너의 파라미터 형태로 페이지마다 판정해 본다
  const page = (q) => {
    const off = Number(q.offset) || 0, cur = Number(q.cursorTs) || 0;
    return off === 0 && !cur;
  };
  const trainerPages = [{ offset: 0 }, { cursorTs: 1787, cursorId: 9 }, { cursorTs: 1786, cursorId: 8 },
                        { cursorTs: 1785, cursorId: 7 }];
  const firsts = trainerPages.filter(page).length;
  chk(firsts === 1,
    "트레이너의 4페이지 요청 중 첫 페이지로 잡히는 것은 1개뿐이다",
    "4페이지 중 " + firsts + "개가 첫 페이지로 잡힌다 — 로그가 그만큼 반복된다");
  const oldPage = (q) => (Number(q.offset) || 0) === 0;
  chk(trainerPages.filter(oldPage).length === 4,
    "옛 판정(offset 만)으로는 4개 전부 첫 페이지 — 관측된 로그 반복과 일치",
    "재현 실패 — 로그 반복의 원인 진단이 틀렸다");
}

/* ── ③ 학습기 — 크래시 대신 이유를 적고 멈추는가 ── */
console.log("③ 학습기 표본 부족 가드");
{
  /* ★주석은 코드가 아니다.★ 첫 시도에서 이 검사가 실패했는데, 원인은 가드 자리가 아니라
     가드 위에 내가 적어 둔 설명 주석 안의 `cut_ts = TS[N - n_val]` 이었다. 검사가 주석을
     코드로 세면, 주석을 지웠다 썼다 하는 것만으로 계약이 통과·실패한다. 실행되는 줄만 센다. */
  const _codeLines = PY.split("\n").map((l, i) => ({ l, i }))
    .filter(x => !/^\s*#/.test(x.l));
  /* [V33.341] 분할이 공용 헬퍼(_split_ts)로 옮겨졌다 — 크래시 지점은 그 ★호출★ 이다.
     (헬퍼 안에서 ts_s[n - nval] 를 읽으므로 N 이 작으면 거기서 죽는다.) */
  const _cutLine = _codeLines.find(x => x.l.includes("_split_ts(TS, val_frac"));
  const _guardLine = _codeLines.find(x => x.l.includes("_MIN_N ="));
  const iCut = _cutLine ? _cutLine.i : -1;
  const iGuard = _guardLine ? _guardLine.i : -1;
  chk(iGuard > 0, "표본 부족 가드가 있다(실행되는 줄 " + (iGuard + 1) + ")", "가드가 없다 — N<20 이면 IndexError 로 죽는다");
  chk(iGuard > 0 && iCut > 0 && iGuard < iCut,
    "가드(" + (iGuard + 1) + "행)가 크래시 지점(" + (iCut + 1) + "행 _split_ts 호출) ★앞★ 에 있다",
    "가드가 크래시 뒤에 있다 — 개별 학습기 문턱들과 같은 실수(도달 불가)");
  // 크래시 재현: 실측 N=8 로 옛 식이 정말 음수 인덱스를 만드는가
  const N = 8, valFrac = 0.2;
  const nVal = Math.max(20, Math.floor(N * valFrac));
  chk(N - nVal === -12,
    "실측 재현: N=8 → n_val=20 → TS[-12] (로그의 'index -12, size 8' 과 일치)",
    "재현 실패 — 크래시 원인 진단이 틀렸다");
  const guard = /_MIN_N\s*=\s*(\d+)/.exec(PY);
  chk(guard && Number(guard[1]) >= 20,
    "가드 문턱 " + (guard && guard[1]) + " 이 크래시 조건(N<20)을 확실히 덮는다",
    "문턱이 20 미만이라 크래시 구간이 남는다");
  const seg = PY.slice(PY.indexOf("_MIN_N ="), PY.indexOf("_MIN_N =") + 1400);
  chk(/return \{"ok": False/.test(seg),
    "정상 종료한다(워크플로가 빨갛게 죽지 않는다)",
    "예외로 죽는다 — 원인이 안 보인다");
  chk(/ML-EXPORT|스냅샷/.test(seg),
    "메시지가 다음에 볼 곳(스냅샷/익스포트)을 가리킨다",
    "이유만 적고 어디를 보라는 말이 없다");
}

console.log(fails ? "\n✗ 스냅샷 드리프트 검사 " + fails + "건 실패" : "\n✓ 스냅샷 드리프트 검사 통과");
process.exit(fails ? 1 : 0);
