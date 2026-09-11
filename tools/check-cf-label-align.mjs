/* [V33.348] 반사실 라벨 — ★진입 시각을 받아 놓고 쓰지 않았다★
 *
 *   mlLabelCandidates 의 가격 공급자는 두 곳(야간·틱)에 복붙돼 있었고, 둘 다 이랬다:
 *       async (sym, mkt, entryTs, horizon) => { … return { closes: dd.closes.slice(-n) }; }
 *   entryTs 는 ★선언만 되고 본문에서 한 번도 참조되지 않았다.★ 그래서 라벨 구간이 언제나
 *   "오늘 기준 마지막 n봉" 이었고, 소비 쪽도 seg = path.slice(-horizon) 으로 다시 뒤에서 잘랐다.
 *   성숙 창이 15~19 달력일이라 19일째 라벨되는 후보는 진입 후 4~13일 구간을 재면서
 *   수익률 기준점은 진입가(0일)를 썼다 — 배리어 판정 구간과 수익률 기준이 서로 다른 창을 봤다.
 *
 *   종전 주석의 이유("daily 캐시에는 dates 가 없어 진입 봉을 되찾을 방법이 없다")는
 *   V33.217 에서 사라졌다 — daily: 캐시가 days 를 싣고 _altBarIdx 가 진입 봉을 찾는다.
 *   수확(HARVEST)은 처음부터 i+1..i+h 로 정확히 정렬돼 있었으므로, 두 라벨 스트림이
 *   ★서로 다른 자★ 를 쓰고 있던 셈이다. 그 둘은 같은 ml_samples 로 들어가 같이 학습된다.
 *
 *   문자열 검사로는 지킬 수 없다(V33.337 교훈) — ★공급자를 실제로 호출해★ 창을 확인한다.
 */
import { _cfPriceLookup } from "../src/index.js";

let fail = 0;
const ok = (c, m) => { console.log((c ? "  ok   " : "✗ FAIL ") + m); if (!c) fail++; };

const D = 86400000;
// 평일만 80봉. 종가 = 100 + 봉번호 라서 어느 구간을 받았는지 눈으로 갈린다.
const days = [], closes = [];
let t = Date.UTC(2026, 0, 1);
while (closes.length < 80) {
  const wd = new Date(t).getUTCDay();
  if (wd !== 0 && wd !== 6) { days.push(Math.floor(t / D)); closes.push(100 + closes.length); }
  t += D;
}
// 지수도 같은 날짜 축으로 둔다(alpha 라벨 정렬 확인용)
/* days 없는 옛 캐시용 별도 계열 — ★오늘까지 이어지게★ 만든다.
   그래야 _altBarIdx 의 평일세기 폴백이 "그럴듯한 인덱스" 를 실제로 내놓는다.
   이 계열이 앞 계열처럼 과거에서 끝나면 폴백이 어차피 범위 밖을 내서,
   _dailyCacheOk 가드를 빼도 결과가 같아진다 — 그러면 이 검사가 아무것도 안 지킨다. */
const oldDays = [], oldCloses = [];
{
  let d = Math.floor(Date.now() / D);
  while (oldCloses.length < 80) {
    const wd = new Date(d * D).getUTCDay();
    if (wd !== 0 && wd !== 6) { oldDays.push(d); oldCloses.push(200 + oldCloses.length); }
    d--;
  }
  oldDays.reverse(); oldCloses.reverse();
}
const store = {
  "daily:TEST": { closes, days, ts: Date.now() },
  "daily:OLD": { closes: oldCloses, ts: Date.now() },            // days 없는 옛 캐시
  "daily:OLDOK": { closes: oldCloses, days: oldDays, ts: Date.now() },
  "daily:^GSPC": { closes: closes.map((c) => c * 10), days, ts: Date.now() }
};
const DB = { prepare: () => ({ bind: (...b) => ({
  first: async () => (store[b[0]] ? { v: JSON.stringify(store[b[0]]) } : null),
  all: async () => ({ results: [] }), run: async () => ({}) }) }) };

const look = _cfPriceLookup(DB);
const H = 10;

// ① 진입 봉이 다르면 받는 창도 달라야 한다 — 끝정렬이면 전부 같은 창이 나온다.
const seen = [];
for (const bar of [20, 30, 40, 50]) {
  const r = await look("TEST", "us", days[bar] * D + 12 * 3600000, H);
  const want = closes.slice(bar + 1, bar + 1 + H);
  const got = r && r.closes;
  const good = got && got.length === H && got.every((v, i) => v === want[i]);
  ok(good, `진입 봉 ${bar} → [${got ? got[0] : "?"}…${got ? got[got.length - 1] : "?"}] (기대 [${want[0]}…${want[H - 1]}])`);
  seen.push(got && got[0]);
}
ok(new Set(seen).size === seen.length, `서로 다른 진입 ${seen.length}건이 서로 다른 창을 받는다(끝정렬이면 전부 같다)`);

// ② 라벨이 늦게 돌아도 창이 밀리지 않는다 — 종전 결함의 본체.
const early = (await look("TEST", "us", days[30] * D, H)).closes;
const late = (await look("TEST", "us", days[30] * D, H)).closes;   // 같은 진입, 며칠 뒤에 라벨
ok(JSON.stringify(early) === JSON.stringify(late), "같은 진입은 언제 라벨해도 같은 창을 받는다");

// ③ 진입 당일 종가는 포함하지 않는다(그건 이미 entry_price 다).
const r30 = (await look("TEST", "us", days[30] * D, H)).closes;
ok(r30[0] === closes[31], `창은 진입 ★다음★ 봉부터 시작한다(첫 값 ${r30[0]} = 봉31 ${closes[31]})`);

// ④ 지수(alpha) 창도 같은 날짜로 정렬된다 — 첫 원소가 진입 봉, 마지막이 만기 봉.
const ix = (await look("TEST", "us", days[30] * D, H)).idxCloses;
ok(Array.isArray(ix) && ix.length === H + 1, `지수 창 길이 ${ix ? ix.length : "-"} (기대 ${H + 1}: 진입~만기)`);
ok(ix && ix[0] === closes[30] * 10 && ix[H] === closes[40] * 10, "지수 창이 종목 창과 같은 날짜에 걸린다");

// ⑤ 맞출 수 없으면 만들지 않는다 — 어긋난 라벨보다 없는 라벨이 낫다.
{
  // 같은 계열·같은 진입인데 days 만 있고 없고가 다르다. days 가 있으면 창을 주고, 없으면 안 준다.
  const entry = oldDays[30] * D;
  const withDays = await look("OLDOK", "us", entry, H);
  const without = await look("OLD", "us", entry, H);
  ok(withDays && withDays.closes.length === H,
     `대조군: days 가 있으면 창을 준다 [${withDays ? withDays.closes[0] : "?"}…] (폴백이 무력한 경우가 아님을 확인)`);
  ok(without === null, "days 없는 옛 캐시 → null(평일세기로 추측하지 않는다)");
}
ok((await look("TEST", "us", days[75] * D, H)) === null, "지평이 아직 안 끝난 진입 → null");
ok((await look("TEST", "us", Date.UTC(2000, 0, 1), H)) === null, "첫 봉보다 앞선 진입 → null");
ok((await look("NOPE", "us", days[30] * D, H)) === null, "캐시에 없는 종목 → null");

console.log(fail ? `\n실패 ${fail}건` : "\n전부 통과");
process.exit(fail ? 1 : 0);
