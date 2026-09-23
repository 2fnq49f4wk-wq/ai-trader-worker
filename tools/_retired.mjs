/* [V33.422] 퇴역 명부를 ★소스에서 읽는다★ — 게이트마다 손으로 적으면 또 갈라진다.
   src/index.js 의 RETIRED 가 유일한 출처이고, 여기는 그것을 읽기만 한다. */
import { readFileSync } from "node:fs";
const S = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const block = (S.match(/const RETIRED = \{[\s\S]*?\n\};/) || [""])[0];
export const RETIRED = [...block.matchAll(/^\s{2}([a-z_]+):\s*\{/gm)].map((m) => m[1]);
export const isRetired = (k) => RETIRED.includes(String(k || "").toLowerCase());
/* 이름·함수·상수에서 퇴역 모델을 걸러내는 도우미 — 게이트가 목록을 줄일 때 쓴다. */
export const keep = (arr, pick) => arr.filter((x) => !isRetired(pick ? pick(x) : x));
