/* ═══════════════════════════════════════════════════════════════════════════
   [V33.261] 한국 유니버스 — 접미사와 세 표(表)를 기계가 지킨다

   CLAUDE.md 의 규칙은 이렇다:
     · 티커는 네이버 기준 — KOSPI = .KS, KOSDAQ = .KQ
     · 종목 추가 시 ★세 곳을 함께 갱신한다★ — DEFAULT_KR · NAME_MAP · MCAP_RANK
     · 상장폐지·피인수 종목은 넣지 않는다

   앞의 둘은 기계가 지킬 수 있다. 사람이 손으로 세 표를 맞추면 언젠가 하나를 빠뜨리고,
   빠뜨린 표는 조용히 틀린다 — 이름이 없으면 화면에 코드만 뜨고, 순위가 없으면 시총
   폴백이 그 종목만 건너뛴다. 둘 다 예외가 아니라 ★조용한 오작동★ 이라 안 보인다.

   세 번째(상장폐지)는 기계가 사전에 지킬 수 없다. 상장폐지는 종목을 넣는 날이 아니라
   ★넣고 나서 아무 때나★ 일어나기 때문이다. 그건 운영이 데이터로 잡는다
   (univHealthNightly — 시세가 안 들어오는 종목을 지목한다). 여기서는 그 장치가
   실제로 배선돼 있는지만 확인한다.
   ═══════════════════════════════════════════════════════════════════════════ */
import { readFileSync } from "node:fs";
const S = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
let fails = 0;
const chk = (c, ok, bad) => { if (c) console.log("  ok   " + ok); else { console.log("  FAIL " + bad); fails++; } };

const seg = (a, b) => S.slice(S.indexOf(a), S.indexOf(b));
const krList = [...seg("const DEFAULT_KR = [", "// ETF 심볼 셋")
  .matchAll(/"([0-9A-Z]{6})\.(KS|KQ)"/g)].map(m => m[1] + "." + m[2]);
const nameMap = {};
for (const m of seg("const NAME_MAP = {", "const MCAP_RANK = {")
  .matchAll(/"([0-9A-Z]{6}\.(?:KS|KQ))"\s*:\s*"([^"]+)"/g)) nameMap[m[1]] = m[2];
const _mr = S.slice(S.indexOf("const MCAP_RANK = {"));
const rankMap = {};
for (const m of _mr.slice(0, _mr.indexOf("\n};"))
  .matchAll(/"([0-9A-Z]{6}\.(?:KS|KQ))"\s*:\s*(\d+)/g)) rankMap[m[1]] = +m[2];

console.log("① 코드·접미사 형식");
{
  chk(krList.length >= 400, "DEFAULT_KR " + krList.length + "종목", "유니버스가 " + krList.length + "종목뿐 — 추출이 깨졌다");
  const dup = krList.filter((c, i) => krList.indexOf(c) !== i);
  chk(dup.length === 0, "중복 없음", "중복 종목: " + [...new Set(dup)].join(", "));
  const badSfx = krList.filter(c => !/\.(KS|KQ)$/.test(c));
  chk(badSfx.length === 0, "접미사는 .KS/.KQ 뿐(네이버 기준)", "접미사 이상: " + badSfx.join(", "));
  // ★같은 6자리 코드가 두 시장에 동시에 있으면 반드시 하나는 틀렸다.★
  //   한 종목은 코스피이거나 코스닥이지 둘 다일 수 없다. 손으로 옮겨 적다 생기는 사고다.
  const byCode = {};
  for (const c of krList) { const k = c.slice(0, 6); (byCode[k] = byCode[k] || []).push(c); }
  const both = Object.keys(byCode).filter(k => byCode[k].length > 1);
  chk(both.length === 0, "한 코드가 두 시장에 동시에 있지 않다",
    "같은 코드가 .KS/.KQ 양쪽에: " + both.map(k => byCode[k].join("+")).join(", "));
  const ks = krList.filter(c => c.endsWith(".KS")).length;
  console.log("  info KOSPI " + ks + " · KOSDAQ " + (krList.length - ks));
}

console.log("\n② 세 표가 함께 갱신됐는가 (CLAUDE.md 규칙)");
{
  const noName = krList.filter(c => !nameMap[c]);
  chk(noName.length === 0, "전 종목이 NAME_MAP 에 있다 (" + Object.keys(nameMap).length + "건)",
    "이름 없는 종목 " + noName.length + "건 — 화면에 코드만 뜬다: " + noName.slice(0, 10).join(", "));
  const noRank = krList.filter(c => !rankMap[c]);
  chk(noRank.length === 0, "전 종목이 MCAP_RANK 에 있다 (" + Object.keys(rankMap).length + "건)",
    "시총순위 없는 종목 " + noRank.length + "건 — 시총 폴백이 이 종목만 건너뛴다: " + noRank.slice(0, 10).join(", "));
  const krRanks = krList.map(c => rankMap[c]).filter(v => v != null);
  const dupRank = krRanks.filter((v, i) => krRanks.indexOf(v) !== i);
  chk(dupRank.length === 0, "순위 중복 없음 — 폴백 정렬이 결정적이다",
    "중복 순위 " + [...new Set(dupRank)].join(", ") + " — 같은 순위끼리 순서가 실행마다 달라진다");
  // 이름이 코드로 되어 있으면 채운 게 아니라 때운 것이다
  const lazy = krList.filter(c => nameMap[c] === c || nameMap[c] === c.slice(0, 6));
  chk(lazy.length === 0, "이름 자리에 코드를 넣어 때운 곳이 없다", "이름이 코드 그대로: " + lazy.join(", "));
}

console.log("\n②-b 섹터 그룹 — 네 번째 표를 빠뜨리지 않았는가");
{
  /* [V33.263] CLAUDE.md 는 세 표(DEFAULT_KR·NAME_MAP·MCAP_RANK)를 말하지만, 실제로는
     네 번째가 있다 — SECTOR_GROUP_MAP. 여기 없으면 getSectorGroup 이 "OTHER" 를 돌려주고
     그 종목은 섹터 성과학습(computeGroupWeight)·뉴스 감성 사이징에서 ★한 바구니로
     뭉개진다.★ 예외가 아니라 조용한 무효화라 화면에도 로그에도 안 나온다.
     ※ 기존 종목 상당수도 미지정이다(오래된 부채). 그건 이 검사가 강제하지 않는다 —
       한꺼번에 채우는 건 별개 작업이고, 근거 없이 업종을 찍는 건 채우는 게 아니다.
       다만 ★새로 넣는 종목★ 은 반드시 배정하게 한다. 부채를 늘리지 않는 것이 먼저다. */
  const sg = seg("const SECTOR_GROUP_MAP", "function getSectorGroup");
  const smap = {};
  for (const m of sg.matchAll(/"([^"]+)"\s*:\s*"([A-Z_]+)"/g)) smap[m[1]] = m[2];
  const GROUPS = new Set(["CONSUMER", "FINANCE", "HEALTH", "INDUSTRIAL", "RESOURCES", "TECH"]);
  /* seg(a,b) 는 b 를 파일 전체에서 찾는다 — 시작점 뒤에서 찾아야 한다.
     처음에 그걸 놓쳐 확장분이 0종으로 잡혔고, ★그 뒤 세 검사가 빈 목록 위에서 전부
     통과★ 했다("모든 원소가 X" 는 원소가 없으면 참이다). 공허한 통과는 통과가 아니다. */
  const _a = S.indexOf("[V33.261] 한국 유니버스 확장");
  const _b = _a >= 0 ? S.indexOf("];", _a) : -1;
  const added = (_a >= 0 && _b > _a)
    ? [...S.slice(_a, _b).matchAll(/"([0-9A-Z]{6})\.(KS|KQ)"/g)].map(m => m[1] + "." + m[2]) : [];
  chk(added.length === 50, "V33.261 확장분 " + added.length + "종을 찾았다",
    "확장분 추출이 " + added.length + "종 — 블록 구조가 바뀌었다(아래 검사가 공허하게 통과한다)");
  if (added.length === 0) { console.log("  FAIL 확장분이 비어 아래 업종 검사를 수행할 수 없다"); fails++; }
  const noSec = added.filter(c => !smap[c]);
  chk(noSec.length === 0,
    "확장 50종 전부 업종이 배정돼 있다 — 섹터 학습이 이 종목들에도 돈다",
    "업종 미배정 " + noSec.length + "종 — 전부 OTHER 한 바구니로 뭉개진다: " + noSec.slice(0, 8).join(", "));
  const badG = added.filter(c => smap[c] && !GROUPS.has(smap[c]));
  chk(badG.length === 0, "배정된 업종이 전부 실재하는 그룹이다",
    "없는 그룹명: " + badG.map(c => c + "=" + smap[c]).join(", ") + " — 오타면 OTHER 와 다를 바 없다");
  const dist = {};
  for (const c of added) dist[smap[c] || "OTHER"] = (dist[smap[c] || "OTHER"] || 0) + 1;
  const mx = Math.max(...Object.values(dist));
  chk(mx <= added.length * 0.5,
    "한 업종에 쏠리지 않았다 (" + Object.entries(dist).map(x => x[0] + " " + x[1]).join(" · ") + ")",
    "한 업종에 " + mx + "/" + added.length + " 가 몰렸다 — 귀찮아서 한 곳에 몰아넣은 것은 배정이 아니다");
}

console.log("\n③ 상장폐지는 사전에 못 막는다 — 운영이 데이터로 잡는가");
{
  chk(/async function univHealthNightly\(DB\)/.test(S),
    "유니버스 건강검진이 존재한다", "죽은 티커를 잡는 장치가 없다 — 상장폐지는 넣은 뒤에 일어난다");
  const st = S.split("\n").filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
  /* ★죽은 코드를 살아 있다고 세지 않는다.★ 변이 시험에서 `if(false) await _stg("univhealth"...)`
     로 죽여 봤더니 문자열이 남아 그대로 통과했다 — 이 저장소의 단골 함정이다.
     문장이 `await _stg(` 로 ★시작★ 하는지(앞에 조건이 붙지 않았는지)까지 본다. */
  chk(/(^|\n)\s*await _stg\("univhealth"/.test(st),
    "야간 크론에서 조건 없이 돈다",
    "건강검진이 크론에서 안 돌거나 조건에 막혀 있다 — 있으나 마나다");
  chk(/\["univhealth", function \(DB\)/.test(st), "수동 파이프라인에도 있다(크론과 같아야 검증이 된다)",
    "수동 실행 목록에 없다 — 손으로 한 번 돌려볼 수가 없다");
  chk(/시세 끊긴 종목/.test(S) && /R\.warnings\.push\(_lab \+ " 시세 끊긴 종목/.test(st),
    "끊긴 종목을 자가진단 경고로 올린다", "검진 결과가 화면에 안 나온다 — 아무도 안 본다");
  chk(/시세가 한 번도 안 들어온 종목/.test(S),
    "한 번도 안 들어온 종목은 따로 구분해 알린다(코드·접미사 오류 신호)",
    "'끊김' 과 '애초에 안 들어옴' 을 구분하지 않는다 — 처방이 다른데 같은 경보가 된다");
}

console.log("\n④ 새로 넣은 종목이 곧바로 빨간불이 되지 않는가");
{
  const b = S.slice(S.indexOf("const UNIVHEALTH = {"), S.indexOf("async function rvBuildPanel"));
  const code = b.split("\n").filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
  chk(/graceDays/.test(code) && /firstSeen/.test(code),
    "첫 수신까지 유예를 준다(firstSeen + graceDays)",
    "새 종목을 즉시 '미수신' 으로 올린다 — 50종목을 넣는 날 경보가 50개 뜨고, 소음이 된 경보는 진짜 상장폐지를 덮는다");
  chk(/graceDays \* 86400000/.test(code),
    "유예를 실제로 계산에 쓴다", "graceDays 를 선언만 하고 안 쓴다");
  chk(/UNIVHEALTH\.minCohort/.test(code),
    "같은 시장 표본이 적으면 판단을 보류한다", "표본이 몇 개든 중앙값을 믿는다");
  // ★절대 시각이 아니라 같은 시장 중앙값 대비★ — 휴장·장애로 시장 전체가 멈춘 것을
  //   종목별 상장폐지로 오인하면 안 된다.
  chk(/const cut = med - UNIVHEALTH\.staleDays \* 86400000/.test(code),
    "기준이 같은 시장의 중앙값이다 — 휴장·장애로 시장이 통째로 멈춘 것과 구분된다",
    "절대 시각으로 판정한다 — 주말·장애 때 전 종목이 상장폐지로 보인다");
}

console.log(fails === 0 ? "\n✓ 한국 유니버스 검사 통과" : "\n✗ " + fails + "건 실패");
process.exit(fails ? 1 : 0);
