/* [V33.578] ★두뇌관측 노드·모델 역할 설명 계약★ — 사용자(10/12): "노드 역할이 뭔지 더 구체적으로 · 전체 모델 전부다".
 *   ① 관측 엔진(NODE_ROLE): 입력 피처 · 은닉 뉴런 · 출력 · OMNI(입력/몸통/머리/나무) · SEQ 를 각각 다른 글로 설명한다
 *   ② OMNI 피처 이름 전부가 접두사 설명을 받는다(빈 설명 없음) · 위원회 피처 역할표(FEAT_ROLES)의 핵심 칸은 상세 설명이 있다
 *   ③ 세 관측창(밀집층 · 시퀀스 · OMNI 코어)이 노드를 고르면 .nerve-role 칸에 역할을 적는다
 *   ④ 모델별 역할 카드가 명부의 모든 (퇴역 아닌) 모델을 덮는다 · 모델 탭마다 그 모델 카드 · 개요에 전체 카드 */
import { readFileSync } from "node:fs";
import vm from "node:vm";
const J = readFileSync(new URL("../public/neural-observatory.js", import.meta.url), "utf8");
const H = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const S = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
let fails = 0;
const chk = (c, m, d) => { if (c) console.log("  ok   " + m); else { fails++; console.log("  FAIL " + m + (d ? " — " + d : "")); } };

const ctx = { matchMedia: () => ({ matches: false, addEventListener() {} }), navigator: { userAgent: "node" }, document: { createElement: () => ({ getContext: () => null, style: {} }) } };
ctx.window = ctx; ctx.self = ctx;
let R = null;
try { vm.runInNewContext(J, ctx); R = ctx.NeuralObservatory && ctx.NeuralObservatory.NODE_ROLE; } catch (e) { chk(false, "관측 엔진 적재", String(e).slice(0, 200)); }
chk(!!R, "NeuralObservatory.NODE_ROLE 이 내보내진다");
if (R) {
  const f = R.featRole("rsi14", "RSI(14)"), h = R.hiddenRole("H1"), o = R.outputRole("OUT · #0");
  chk(/과열/.test(f) && /은닉 뉴런/.test(h) && /조합 감지기/.test(h) && /확률/.test(o) && /진입 문턱/.test(o), "입력 · 은닉 · 출력 설명이 서로 다르고 무엇을 하는지 말한다");
  const om = [R.omniRole(0, "d_r5"), R.omniRole(1, "몸통 1 · #3"), R.omniRole(3, "5d — 머리"), R.omniRole(4, "나무 #2 · 잎 8 · 분기 7")];
  chk(/일봉 피처/.test(om[0]) && /공용 층/.test(om[1]) && /5거래일 뒤/.test(om[2]) && /분기/.test(om[3]) && /잎 값/.test(om[3]), "OMNI: 입력 · 몸통 · 머리(지평) · 나무를 각각 설명", JSON.stringify(om.map((x) => x.slice(0, 30))));
  chk(/시점마다/.test(R.seqRole(0, "ret5")) && /어텐션/.test(R.seqRole(2, "h", "ret5 0.3")), "SEQ: 입력은 시점별 · 숨은 칸은 어텐션 설명");
  const OF = [...(/const OMNI_FEATS = \[([\s\S]*?)\];/.exec(S) || [])[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  const miss = OF.filter((n) => !R.PREFIX.some((p) => n.indexOf(p[0]) === 0) && !R.FEAT_TXT[n]);
  chk(OF.length > 50 && miss.length === 0, "OMNI 피처 " + OF.length + "개 전부 설명이 있다", miss.join(","));
  const core = ["rsi14", "maGapPct", "atrPct", "dayPct", "ret5", "ret20", "rs20", "volSurge", "pos52w", "bollB"];
  chk(core.every((n) => R.FEAT_TXT[n] && R.FEAT_TXT[n].length > 12), "위원회 핵심 피처 10개는 상세 설명(높고 낮음의 뜻)이 있다");
}
chk((J.match(/class="nerve-role"/g) || []).length === 2 && /NODE_ROLE\.omniRole\(/.test(J) && /NODE_ROLE\.seqRole\(/.test(J) && /NODE_ROLE\.denseRole\(layers,n\)/.test(J),
    "세 관측창이 노드를 고르면 .nerve-role 에 역할을 적는다(밀집·시퀀스 템플릿 + OMNI 코어 템플릿)");
// ④ 모델 카드
const keys = [...(/var LUX_MODEL_ROLES = \[([\s\S]*?)\n  \];/.exec(H) || [])[1].matchAll(/\['([a-z_]+)','/g)].map((m) => m[1]);
const RB = S.slice(S.indexOf("async function buildRoster(DB)"), S.indexOf("function rosterTally(roster)"));
const roster = [...RB.matchAll(/add\("([a-z_]+)", "/g)].map((m) => m[1]).filter((k) => !/^(xgb|lgb|cat|dual_bull|dual_bear)$/.test(k));
const RET = (/const RETIRED = \{([\s\S]*?)\n\};/.exec(S) || [])[1] || "";
const live = [...new Set(roster)].filter((k) => !new RegExp("\\b" + k + ":").test(RET));
const lack = live.filter((k) => keys.indexOf(k) < 0);
chk(keys.length >= 8 && lack.length === 0, "모델 카드가 명부의 모든 모델을 덮는다(" + keys.join("·") + ")", "빠짐: " + lack.join(","));
chk(/roles\.innerHTML = NNV_modelRoles\(\)/.test(H) && /_mr\.innerHTML = \(d && d\.kind && d\.kind!=='overview'\) \? NNV_modelRoleOne\(d\.kind\)/.test(H) && /id="nnvMRole"/.test(H),
    "개요엔 전체 카드 · 모델 탭엔 그 모델 카드(렌더러가 지우지 않는 칸)");
chk(/상위 10% 를 직접 사고/.test(H) && /OMNIQ-DROP 청산/.test(H), "OMNI 카드가 진입 경로(상위 10% 매수 · 상위 25% 밖 매도)를 말한다");

if (fails) { console.log("\n✗ 노드·모델 역할 " + fails + "건 실패"); process.exit(1); }
console.log("\n✓ 노드·모델 역할 통과");
