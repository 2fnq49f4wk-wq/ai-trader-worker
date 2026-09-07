import { getBigState, _bigLoadStatus, _setR2ForTest } from "../src/index.js";
import { readFileSync } from "node:fs";
import vm from "node:vm";

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

// [Codex V33.314] Exercise real storage failures, recovery and the real SEQ cache function.
const storageDB = (meta, failAt) => ({ prepare() { return { bind() { return this; },
  async first() { if (failAt === 'meta') throw Error('D1 unavailable'); return { v: JSON.stringify(meta) }; },
  async all() { if (failAt === 'chunk') throw Error('D1 overloaded'); return { results: [{ k:'dnn_model:chunk:0', v:'{"a":1}' }] }; }
}; } });
await getBigState(storageDB({}, 'meta'), 'dnn_model', null);
check(_bigLoadStatus().dnn_model.reason === 'meta_read_error', 'D1 metadata failure is not untrained or JSON corruption');
await getBigState(storageDB({ chunks:1 }, 'chunk'), 'dnn_model', null);
check(_bigLoadStatus().dnn_model.reason === 'chunk_read_error', 'D1 chunk failure is not JSON corruption');
for (const chunks of [-1, 1.5, '2', 1000000000]) {
  await getBigState(storageDB({ chunks }), 'dnn_model', null);
  check(_bigLoadStatus().dnn_model.reason === 'chunks_invalid', 'Invalid chunk count rejected: ' + chunks);
}
check((await getBigState(storageDB({ chunks:1 }), 'dnn_model', null)).a === 1, 'Valid chunked model still loads');
check(_bigLoadStatus().dnn_model.ok, 'Successful recovery clears the active error');

const src = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
const start = src.indexOf('async function _seqCached(DB) {');
const end = src.indexOf('/* 화면용 한 줄.', start);
const model = { featVer:1, trusted:true, w:0.2, Win:[], pos:[], D:2 };
let modelReads = 0;
const context = vm.createContext({ SEQML:{ enabled:true }, LUXML:{ featVer:1, featNames:['a','b'] },
  Date, Array, __seqMemCache:null, _num:(v,d)=>Number.isFinite(v) ? v : d,
  getState:async()=>({ trusted:true, wSeq:0.2, featVer:1 }),
  getBigState:async()=>++modelReads === 1 ? null : model
});
vm.runInContext(src.slice(start,end), context);
check(await context._seqCached({}) === null, 'SEQ load failure does not vote');
check(await context._seqCached({}) === model && modelReads === 2, 'SEQ retries immediately after a transient load failure');
check(await context._seqCached({}) === model && modelReads === 2, 'Successful SEQ load still uses the five-minute cache');
context.__seqCache = null;
context.getState = async()=>{ throw Error('D1 unavailable'); };
check(await context._seqCached({}) === null && !context.__seqCache, 'Trust read failure does not cache negative evidence');
context.getState = async()=>({ trusted:false, wSeq:0, featVer:1 });
check(await context._seqCached({}) === null && context.__seqCache.val === null, 'Explicitly untrusted SEQ remains excluded and cached');

console.log(failures ? `\n대형모델 로딩 관측 계약 위반 ${failures}건` : "\n  ok   대형모델 로딩 관측 계약 통과");
process.exit(failures ? 1 : 0);
