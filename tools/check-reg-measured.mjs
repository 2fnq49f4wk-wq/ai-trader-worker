// [V33.386] ★잰 규제가 다음 회차까지 살아남는가★ — 측정-반영 고리의 두 번째 축
//
//   V33.204 가 깊이를 재는 스윕을 만들었고, V33.260 이 "측정이 매번 버려진다" 를 고쳤다.
//   그런데 스윕은 ★두 축★ 을 잰다 — 깊이와 규제. 고쳐 붙인 것은 깊이뿐이었다.
//   규제 승자(_reg_win)는 그 실행 안에서만 쓰이고 /api/dnn-arch 에는 hidden 만 올라갔다.
//   결과: 스윕이 "규제 완화가 낫다" 를 몇 번을 재도 다음 정기 회차는 언제나 사다리로 돌아온다.
//   같은 병이 다른 축에 그대로 남아 있었다. 이 게이트가 그 고리를 ★실행으로★ 확인한다.
import fs from "node:fs";
import { execFileSync } from "node:child_process";
const M = await import("../src/index.js");
const py = fs.readFileSync("trainer/modal/modal_train.py", "utf8");
let bad = 0;
const ok = (m) => console.log("  ok   " + m);
const no = (m) => { console.error("  FAIL " + m); bad++; };

const FV = M.LUXML && M.LUXML.featVer;
const REG = { dropout: 0.25, l2: 4.5e-4, mixupP: 0.1, inputNoise: 0.04 };

// ── ① 워커가 잰 규제를 ★실제로 꺼내 온다★ ────────────────────────────────────
//   _dnnArchDecide 를 진짜로 돌린다. 문자열이 아니라 반환값을 본다.
{
  const trusted = { trusted: true };
  const rec = { featVer: FV, hidden: [128, 64], reg: REG, n: 500000, ts: Date.now() };
  const d = M._dnnArchDecide(rec, trusted, 500000);
  if (!d || !d.reg) no("측정규제: featVer 가 맞는 기록인데 _dnnArchDecide 가 reg 를 안 돌려준다 — 잰 값이 내려갈 길이 없다");
  else if (d.reg.dropout !== REG.dropout || d.reg.l2 !== REG.l2)
    no("측정규제: _dnnArchDecide 가 돌려준 reg 가 기록과 다르다");
  else ok("_dnnArchDecide 가 기록의 규제 승자를 그대로 돌려준다");

  // 판이 다르면 깊이와 ★같이★ 무효여야 한다. 규제만 살아남으면 옛 판의 값으로 새 판을 학습한다.
  const stale = M._dnnArchDecide({ ...rec, featVer: FV + 1 }, trusted, 500000);
  if (stale && stale.reg) no("측정규제: featVer 가 다른데 reg 가 살아남는다 — 옛 판의 규제로 새 판을 학습하게 된다");
  else ok("판(featVer)이 다르면 규제도 깊이와 함께 무효");

  // 기록에 reg 가 아예 없던 시절(V33.260 이전 레코드)도 있다 — 터지지 않아야 한다.
  const old = M._dnnArchDecide({ featVer: FV, hidden: [128, 64], n: 5e5, ts: Date.now() }, trusted, 5e5);
  if (!old || old.reg !== null) no("측정규제: reg 없는 옛 기록에서 reg 가 null 이 아니다");
  else ok("reg 없는 옛 기록 → null(사다리로 돌아간다)");
}

// ── ② 내려보내는 설정에 ★실제로 실린다★ ──────────────────────────────────────
//   없을 때는 키 자체가 없어야 한다 — null 을 보내면 트레이너가 "쟀는데 비었다" 와 못 가른다.
{
  const withReg = M._mlExportConfig({ hidden: [128, 64], reg: REG, measured: true, sweep: false, why: null });
  if (!withReg || !withReg.regMeasured) no("측정규제: _mlExportConfig 가 regMeasured 를 안 싣는다 — 잰 값이 Modal 에 안 간다");
  else if (withReg.regMeasured.dropout !== REG.dropout) no("측정규제: 실린 regMeasured 가 원본과 다르다");
  else ok("_mlExportConfig 가 regMeasured 를 싣는다");

  const without = M._mlExportConfig({ hidden: [128, 64], reg: null, measured: false, sweep: true, why: "x" });
  if (without && Object.prototype.hasOwnProperty.call(without, "regMeasured"))
    no("측정규제: 측정이 없는데 regMeasured 키가 존재한다 — '없음' 과 '쟀는데 빔' 이 구분 안 된다");
  else ok("측정이 없으면 regMeasured 키 자체가 없다");

  const none = M._mlExportConfig();
  if (none && Object.prototype.hasOwnProperty.call(none, "regMeasured"))
    no("측정규제: arch 인자 없이 부른 경로에 regMeasured 가 붙는다");
  else ok("arch 없는 경로(스칼프·인트라데이)엔 안 붙는다");
}

// ── ③ 저장 경로가 ★범위를 검사하고, 부분 채택을 안 한다★ ─────────────────────
//   라우트의 검증 블록을 ★떼어 내 실행한다★ — 여기 있는 것은 소스의 그 조각 자체다.
{
  const src = fs.readFileSync("src/index.js", "utf8");
  const i0 = src.indexOf('let _reg = null;\n      const _rb = body && body.reg;');
  const i1 = src.indexOf("const rec = { hidden: h, reg: _reg,", i0);
  if (i0 < 0 || i1 < 0) {
    no("측정규제: /api/dnn-arch 의 reg 검증 블록을 못 찾겠다 — 저장 경로가 사라졌거나 모양이 바뀌었다");
  } else {
    const blk = src.slice(i0, i1);
    if (!/return Response\.json\(\s*\{ error:/.test(blk))
      no("측정규제: 범위를 벗어난 reg 를 거부하지 않는다 — 조용히 통과하면 이상한 값으로 학습한다");
    else ok("범위 밖 reg 는 400 으로 거부한다");
    const _num = (v, d) => (typeof v === "number" && isFinite(v) ? v : d);
    const run = (body) => {
      const Response = { json: (o, i) => ({ __rejected: true, status: i && i.status, body: o }) };
      // eslint-disable-next-line no-new-func
      const f = new Function("body", "_num", "Response", "cors", blk + "\n return { reg: _reg };");
      try { return f(body, _num, Response, {}); } catch (e) { return { __threw: String(e) }; }
    };
    const good = run({ reg: { dropout: 0.3, l2: 1e-3, mixupP: 0.2, inputNoise: 0.05 } });
    if (!good || !good.reg || good.reg.dropout !== 0.3) no("측정규제: 정상 범위 reg 가 통과하지 못한다 " + JSON.stringify(good));
    else ok("정상 범위 reg 는 그대로 저장값이 된다");

    const absent = run({});
    if (!absent || absent.reg !== null) no("측정규제: reg 를 안 보낸 요청이 null 로 안 떨어진다(깊이만 올리는 경로가 막힌다)");
    else ok("reg 없는 요청은 null — 깊이만 올리는 경로가 살아 있다");

    // ★부분 채택 금지★ — 한 칸이 범위 밖이면 나머지도 안 쓴다. 섞으면 재 본 적 없는 조합이 된다.
    for (const [k, v] of [["dropout", 0.95], ["l2", 0.9], ["mixupP", 1.7], ["inputNoise", -0.1], ["dropout", -0.01]]) {
      const b = { reg: { dropout: 0.3, l2: 1e-3, mixupP: 0.2, inputNoise: 0.05 } };
      b.reg[k] = v;
      const r = run(b);
      if (!r || !r.__rejected || r.status !== 400)
        no(`측정규제: ${k}=${v} 가 거부되지 않는다 — 범위 검사가 새고 있다`);
    }
    ok("범위 밖 5종(dropout·l2·mixupP·inputNoise, 양쪽 끝) 전부 400");

    const missing = run({ reg: { dropout: 0.3, l2: 1e-3 } });
    if (!missing || !missing.__rejected)
      no("측정규제: 칸이 빠진 reg 가 부분 채택된다 — 재 본 적 없는 조합으로 학습하게 된다");
    else ok("칸이 빠지면 통째로 거부(부분 채택 없음)");
  }
}

// ── ④ 트레이너가 ★받아서 실제로 쓴다★ ────────────────────────────────────────
//   파싱·검증 블록을 Python 으로 떼어 내 돌린다. '사다리를 덮어쓰는가' 가 이 축의 전부다.
{
  const i0 = py.indexOf("    _reg_meas = None\n    try:");
  const i1 = py.indexOf("    if _reg_meas:", i0);   // _reg_base 확정까지 포함해서 떼어 낸다
  if (i0 < 0 || i1 < 0) {
    no("측정규제: 트레이너의 regMeasured 수용 블록을 못 찾겠다");
  } else {
    const blk = py.slice(i0, i1).replace(/^    /gm, "");
    const harness = `
_LAD = dict(dropout=0.50, l2=1.5e-3, mixup_p=0.25, input_noise=0.08)
def _decide(cfg):
    _reg_ladder = dict(_LAD)
${blk.split("\n").map(l => "    " + l).join("\n")}
    return _reg_base
import json
out = {}
out["good"]  = _decide({"regMeasured": {"dropout": 0.2, "l2": 3e-4, "mixupP": 0.1, "inputNoise": 0.03}})
out["none"]  = _decide({})
out["null"]  = _decide({"regMeasured": None})
out["hi"]    = _decide({"regMeasured": {"dropout": 0.95, "l2": 3e-4, "mixupP": 0.1, "inputNoise": 0.03}})
out["neg"]   = _decide({"regMeasured": {"dropout": 0.2, "l2": -1.0, "mixupP": 0.1, "inputNoise": 0.03}})
out["part"]  = _decide({"regMeasured": {"dropout": 0.2}})
out["junk"]  = _decide({"regMeasured": "0.2"})
out["zero"]  = _decide({"regMeasured": {"dropout": 0.0, "l2": 0.0, "mixupP": 0.0, "inputNoise": 0.0}})
print(json.dumps(out))
`;
    let r;
    try { r = JSON.parse(execFileSync("python3", ["-c", harness], { encoding: "utf8" })); }
    catch (e) { no("측정규제: 트레이너 수용 블록 실행 실패 — " + String(e).slice(0, 300)); r = null; }
    if (r) {
      if (r.good.dropout !== 0.2 || r.good.l2 !== 3e-4)
        no("측정규제: 트레이너가 정상 regMeasured 를 안 쓴다 — 사다리가 그대로 덮어쓴다(고치기 전 동작)");
      else ok("트레이너가 정상 regMeasured 로 사다리를 덮는다");
      for (const [k, why] of [["none", "필드 없음"], ["null", "null"], ["hi", "dropout 0.95"],
                              ["neg", "l2 음수"], ["part", "칸 빠짐"], ["junk", "dict 아님"]]) {
        if (r[k].dropout !== 0.50 || r[k].l2 !== 1.5e-3)
          no(`측정규제: ${why} 인데 사다리로 안 돌아간다 — 이상한 값으로 학습한다`);
      }
      ok("없음·null·범위밖·칸빠짐·형식오류 6종 전부 사다리로 복귀");
      // 0 은 ★유효한 측정값★ 이다("규제 최소" 후보가 정확히 이 모양이다). falsy 로 버리면 안 된다.
      if (r.zero.dropout !== 0.0 || r.zero.mixup_p !== 0.0)
        no("측정규제: 전부 0 인 규제(=스윕의 '규제 최소' 승자)가 버려진다 — 0 은 빈 값이 아니라 측정값이다");
      else ok("0 규제도 측정값으로 인정(‘규제 최소’ 가 이길 수 있어야 한다)");
    }
  }
}

// ── ⑤ 스윕 격자가 ★걸어다니지 않는다★ ────────────────────────────────────────
//   배수를 _reg_base(=지난 승자)에 걸면 0.5 → 0.25 → 0.125 로 회차마다 곱해진다.
//   격자가 움직이면 회차끼리 비교가 안 되고, 규제가 한 방향으로 미끄러진다.
{
  const i0 = py.indexOf("def _reg(mul_do, mul_l2, mul_mix, mul_noise):");
  const i1 = py.indexOf("reg_cands = []", i0);
  const blk = i0 >= 0 && i1 >= 0 ? py.slice(i0, i1) : "";
  if (!blk) no("측정규제: 스윕 규제 격자 정의를 못 찾겠다");
  else if (/_reg_base\[/.test(blk))
    no("측정규제: 배수를 _reg_base 에 건다 — 지난 승자가 다음 격자의 바닥이 되어 배수가 회차마다 곱해진다");
  else if (!/_reg_ladder\[/.test(blk))
    no("측정규제: 배수가 고정 기준(_reg_ladder)에 걸려 있지 않다");
  else ok("스윕 배수는 고정된 사다리에 걸린다(격자가 회차마다 이동하지 않는다)");

  // 지난 승자는 '현행' 으로 ★격자 안에서 방어★ 해야 한다 — 빠지면 한 번 진 값이 영구히 남는다.
  const i2 = py.indexOf("reg_cands = []");
  const i3 = py.indexOf("_K_full = K", i2);
  const cb = i2 >= 0 && i3 >= 0 ? py.slice(i2, i3) : "";
  if (!/\("규제 현행", dict\(_reg_base\)\)/.test(cb))
    no("측정규제: 스윕 후보에 지난 승자(_reg_base)가 '현행' 으로 안 들어간다 — 방어 기회 없이 교체된다");
  else ok("지난 승자가 '현행' 후보로 격자 안에서 방어한다");
  if (!/\("규제 사다리", dict\(_reg_ladder\)\)/.test(cb))
    no("측정규제: 사다리가 후보에서 빠졌다 — 잰 값이 나쁠 때 돌아갈 기준선이 없다");
  else ok("사다리도 후보로 남는다(잰 값이 나쁘면 되돌아갈 수 있다)");
}

// ── ⑥ 스윕 승자가 ★실제로 올라간다★ ──────────────────────────────────────────
{
  const i0 = py.indexOf('_ar = requests.post(BASE + "/api/dnn-arch"');
  const i1 = py.indexOf("②-S 구성 저장", i0);
  const blk = i0 >= 0 && i1 >= 0 ? py.slice(i0, i1) : "";
  if (!blk) no("측정규제: /api/dnn-arch 업로드 블록을 못 찾겠다");
  else if (!/"reg":\s*\{/.test(blk))
    no("측정규제: 업로드 본문에 reg 가 없다 — 규제 측정이 그 실행 안에서 사라진다(고치기 전 동작)");
  else if (!/_reg_win\["dropout"\]/.test(blk) || !/_reg_win\["l2"\]/.test(blk))
    no("측정규제: 업로드하는 reg 가 스윕 승자(_reg_win)에서 오지 않는다");
  else ok("스윕 규제 승자가 업로드 본문에 실린다");
  for (const k of ["mixupP", "inputNoise"])
    if (!blk.includes(`"${k}"`)) no(`측정규제: 업로드 reg 에 ${k} 가 빠졌다 — 워커가 부분 채택을 거부하므로 통째로 무시된다`);
  ok("업로드 reg 가 네 칸을 모두 채운다(워커의 부분 채택 금지와 맞물린다)");
}

// ── ⑦ 어느 쪽을 쓰는지 ★로그로 말한다★ ───────────────────────────────────────
//   사다리인지 잰 값인지 로그가 말하지 않으면, 성능이 바뀌어도 무엇이 바꿨는지 알 수 없다.
if (!/print\(f"  ★규제는 ★잰 값★ 을 쓴다/.test(py))
  no("측정규제: 잰 값을 쓸 때 그 사실을 로그로 말하지 않는다 — 나중에 무엇이 성능을 바꿨는지 못 가린다");
else ok("잰 값을 쓸 때 사다리와 나란히 찍어 둘을 가를 수 있다");

console.log(bad ? `\n측정규제 게이트 실패 ${bad}건` : "\n측정규제 게이트 통과");
process.exit(bad ? 1 : 0);
