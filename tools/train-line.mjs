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
    console.log("LINE=파싱실패: " + raw.slice(0, 160).replace(/\s+/g, " "));
    return;
  }
  if (!d || d.ok !== true) {
    console.log("RESUME=");
    console.log("LINE=실패: " + String((d && d.error) || "알 수 없음").slice(0, 160));
    return;
  }
  if (d.target !== "all") {
    console.log("RESUME=");
    console.log("LINE=" + String(d.result || "(응답 없음)").slice(0, 300).replace(/\s+/g, " "));
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
  console.log("RESUME=" + from);
  console.log("LINE=" + ran + "단계 실행 / " + skipped + " 대기 · " + d.ms + "ms" +
    (failed.length ? " · 실패 " + failed.join(",") : "") + (from ? " · 다음 " + from : " · 완주"));
});
