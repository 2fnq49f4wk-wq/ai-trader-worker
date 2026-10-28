/* [V33.695] ★국면 전략(regime sleeve) 계약★ — 사용자 10/28 "국면 장기·중기·단기 대응 · 모든 국면 거래당 +5% · 유니버셜하게".
   학습기 regime_sleeve.py 가 국면마다 전략 묶음을 분기 워크포워드로 고르고(직전 3년에 끝난 거래만 · 판정 구간은 고르기에 안 씀),
   워커는 실전 자격(sleeve.live = 지금 국면 두 구간 모두 ≥ +5% · 표본 ≥ 20)이 있을 때만 산다. 이 배선이 끊기거나 자격이 느슨해지면 막는다. */
import { readFileSync } from "node:fs";
const R = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const SL = R("trainer/modal/regime_sleeve.py"), PB = R("trainer/modal/playbook_sim.py"), S = R("src/index.js"), UI = R("studio/src/views/PlaybookDeck.tsx");
let fails = 0;
const chk = (c, ok, bad) => { if (c) console.log("  ok   " + ok); else { console.log("  FAIL " + bad); fails++; } };
chk(/m = \(rg_ == rg\) & \(ti >= q - WIN\) & \(x < q\)/.test(SL), "고르기 = 직전 WIN 거래일에 ★끝난★ 거래만(x < q · 미래 정보 없음)", "★고르기가 아직 안 끝난 거래를 본다(미래 정보)★");
chk(/np\.vstack\(\[np\.zeros\(\(1, N\), bool\), S\[:-1\]\]\)/.test(SL), "하루 늦은 진입(학습기 목록 → 워커 다음 거래일)", "★진입이 신호 당일이다(실전보다 하루 빠름)★");
chk(/all\(\(w\.get\(rg_now\) or \{\}\)\.get\("n", 0\) >= NMIN and \(\(w\.get\(rg_now\) or \{\}\)\.get\("mean"\) or -99\) >= 5\.0 for w in \(wfV, wfH\)\)/.test(SL),
    "실전 자격 = 지금 국면 [60,80%)·[80,100%) 둘 다 거래당 ≥ +5% · 표본 ≥ NMIN", "★실전 자격 문턱이 바뀌었다(사용자 승인 없이 낮추지 말 것)★");
chk(/NMIN, TH = 750, 63, 20, 3\.0/.test(SL), "WIN 750 · 분기 63 · 표본 20 · 근거 문턱 +3%(사전 등록)", "★워크포워드 설정이 바뀌었다★");
chk(/"sleeve": sleeve/.test(PB) && /import regime_sleeve as RSL/.test(PB), "학습기 업로드에 sleeve", "★학습기가 국면 전략을 안 올린다★");
chk(/rec\.sleeve = \(body\.sleeve/.test(S) && /sleeve: r\.sleeve \|\| null/.test(S), "워커 저장 · /api/playbook 노출", "★워커가 sleeve 를 버린다★");
chk(/!\(SL\.live \|\| ctx\.shadow\)\) return null/.test(S) && /if \(slp && \(st\.sleeve\.live \|\| ctx\.shadow\)\) return slp/.test(S), "워커는 실전 자격(live)일 때만 실제로 고른다 · 아니면 관측", "★자격 없이 국면 전략으로 산다★");
chk(/pbSleeveHas\(__sr, symbol\)/.test(S) && /!pbSleeveHas\(__sr, sym\)/.test(S), "국면 전략 종목은 OMNI-Q 후보 거름 밖에서도 평가(평가 루프 · 선행 판정)", "★국면 전략 종목이 평가되지 않는다★");
chk(/aria-label="국면 전략"/.test(UI) && /SL\.wf && SL\.wf\.H/.test(UI), "두뇌관측 매매법 화면에 국면 전략(고른 전략 · 오늘 종목 · 국면별 두 구간)", "★화면에 국면 전략이 없다★");
if (fails) { console.log("✗ 국면 전략 계약 실패 " + fails); process.exit(1); }
console.log("✓ 국면 전략 계약 통과");
