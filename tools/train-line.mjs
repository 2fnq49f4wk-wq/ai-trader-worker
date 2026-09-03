// [V33.192] /api/ai/train-now 응답을 사람이 읽을 줄과 재개 지점으로 줄인다.
//
//   왜 필요한가: target=all 은 워커 1요청 CPU 상한(300s) 때문에 240초에서 스스로 끊고
//   남은 단계를 skipped(deadline) 으로 표기한 뒤 resume 경로를 돌려준다. 그런데 워크플로는
//   그 resume 을 쓰지 않고 한 번만 부르고 끝났다 — ★파이프라인 뒷단이 매번 통째로 안 돌았다.★
//   (calibrate·selfreview·portstats 처럼 ★맨 뒤에 있는★ 단계가 특히 그렇다. 하필 지금
//    가장 중요한 확률 보정이 그 자리에 있다.)
//
//   출력(한 줄씩):
//     RESUME=<단계이름 또는 빈칸>
//     LINE=<요약 한 줄>
//   ★실패해도 0 으로 끝낸다★ — 파싱 실패로 학습 루프 전체를 죽이지 않는다.
let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => { raw += c; });
process.stdin.on("end", () => {
  let d;
  try { d = JSON.parse(raw); } catch (e) {
    console.log("RESUME=");
    console.log("CRASH=");
    console.log("LINE=파싱실패: " + raw.slice(0, 160).replace(/\s+/g, " "));
    return;
  }
  if (!d || d.ok !== true) {
    console.log("RESUME=");
    console.log("CRASH=");
    console.log("LINE=실패: " + String((d && d.error) || "알 수 없음").slice(0, 160));
    return;
  }
  if (d.target !== "all") {
    /* ══ [V33.293] ★한 회차로 안 끝나는 단일 단계도 있다★ ═══════════════════════
       실측(2026-09-03): STACK 소급생성이 드디어 빈 구간을 메우기 시작했는데,
           [STACK-BF] +1800표본 (홀드아웃경로★신규개방구간 2026-01-31~2026-05-24 메우는 중★)
       회차당 1,800건이다. 워커 1요청 예산(STACKBF.deadlineMs 20초)이 그만큼이고, 그건
       ★야간 파이프라인에 맞춘 값이라 옳다★ — 한 단계가 예산을 다 쓰면 뒷단이 안 돈다.
       문제는 넉 달치 빈 구간이 그 속도로는 두 달 걸린다는 것이다.
       그런데 이건 ★한 번만 하면 되는 일★ 이다. 그러면 야간 예산을 늘릴 게 아니라
       손으로 돌리는 이 워크플로가 다 메울 때까지 다시 부르면 된다.
       "메우는 중" 은 서버가 스스로 적은 말이므로, 그 말이 사라질 때까지 이어 돈다. */
    const line = String(d.result || "(응답 없음)");
    const more = /메우는 중/.test(line) && /\+[1-9][0-9]*표본/.test(line);
    console.log("RESUME=" + (more ? "again" : ""));
    console.log("CRASH=");
    console.log("LINE=" + line.slice(0, 300).replace(/\s+/g, " "));
    return;
  }
  const res = d.results || {};
  const from = (String(d.resume || "").match(/from=([A-Za-z0-9_]+)/) || [])[1] || "";
  const keys = Object.keys(res);
  let ran = 0, skipped = 0, failed = [];
  for (const k of keys) {
    const v = String(res[k] || "");
    if (v.indexOf("skipped") === 0) skipped++;
    else { ran++; if (v.indexOf("FAIL:") === 0) failed.push(k); }
  }
  // [V33.197] 서버가 알아낸 '죽인 단계' 를 그대로 옮긴다 — 이게 없으면 사람이 로그를 뒤져야 한다.
  const crash = d.crashedAt ? (" · 직전 호출이 '" + d.crashedAt + "' 에서 죽음(" + (d.crashFails || 1) + "회)") : "";
  const auto = d.autoSkipped ? (" · ★'" + d.autoSkipped + "' 자동 건너뜀★") : "";
  console.log("RESUME=" + from);
  console.log("CRASH=" + (d.autoSkipped || ""));
  console.log("LINE=" + ran + "단계 실행 / " + skipped + " 대기 · " + d.ms + "ms" +
    (failed.length ? " · 실패 " + failed.join(",") : "") + crash + auto +
    (from ? " · 다음 " + from : " · 완주"));
});
