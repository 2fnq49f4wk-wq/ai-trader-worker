// [V33.184] /api/ai/resample-run 응답 한 건을 사람이 읽을 한 줄로 줄인다.
//
//   워크플로 YAML 안에 여러 줄 스크립트를 박으면 블록 스칼라의 들여쓰기가 깨진다.
//   이 저장소에서 이미 한 번 겪었고(V33.178 의 pick-logs), 이번에도 같은 실수를 했다.
//   진단·집계 스크립트는 파일로 둔다 — 로컬에서 시험할 수 있고, 워크플로를 안 건드려도 고쳐진다.
//
//   사용: <응답JSON> | node tools/resample-line.mjs
//   출력: 한 줄 요약. 스윕이 끝났으면 마지막에 __DONE__ 을 덧붙인다(CI 가 이걸로 루프를 멈춘다).
//   ★실패해도 0 으로 끝낸다★ — 한 회차 파싱 실패로 스윕 전체를 죽이지 않는다. 대신 사유를 적는다.

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => { raw += c; });
process.stdin.on("end", () => {
  let d;
  try {
    d = JSON.parse(raw);
  } catch (e) {
    console.log("파싱실패: " + raw.slice(0, 140).replace(/\s+/g, " "));
    return;
  }
  if (!d || !d.ok) {
    console.log("실패: " + String((d && d.error) || "알 수 없음").slice(0, 140));
    return;
  }
  const s = d.samples || {}, c = d.cursor || {};
  console.log(
    "커서 " + c.lastId + " · xalpha " + s.xalpha + " · flow " + s.flow +
    " · " + d.ms + "ms | " + String(d.result || "").slice(0, 150) +
    (d.done ? " __DONE__" : "")
  );
});
