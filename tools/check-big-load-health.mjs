import { getBigState, _bigLoadStatus, _setR2ForTest } from "../src/index.js";

let failures = 0;
const check = (c, ok) => { if (c) console.log("  ok   " + ok); else { console.error("  FAIL " + ok); failures++; } };
const db = {
  prepare() { return { bind() { return this; }, async first() { return { v: JSON.stringify({ r2: true, len: 7 }) }; } }; }
};

_setR2ForTest(null);
check(await getBigState(db, "dnn_model", null) === null, "R2 미바인딩은 안전하게 null로 폴백한다");
let h = _bigLoadStatus();
check(h.dnn_model?.reason === "r2_unbound" && h.dnn_model.failures === 1,
  "미학습이 아니라 R2 미바인딩이라고 원인을 보존한다");

_setR2ForTest({ async get() { throw new Error("bucket unavailable"); } });
await getBigState(db, "dnn_model", null);
h = _bigLoadStatus();
check(h.dnn_model?.reason === "r2_get_error" && /bucket unavailable/.test(h.dnn_model.error || ""),
  "R2 GET 예외의 종류와 메시지를 보존한다");

_setR2ForTest({ async get() { return { async text() { return "{broken"; } }; } });
await getBigState(db, "dnn_model", null);
h = _bigLoadStatus();
check(h.dnn_model?.reason === "json_parse", "손상 모델을 JSON 파싱 실패로 구분한다");

console.log(failures ? `\n대형모델 로딩 관측 계약 위반 ${failures}건` : "\n  ok   대형모델 로딩 관측 계약 통과");
process.exit(failures ? 1 : 0);
