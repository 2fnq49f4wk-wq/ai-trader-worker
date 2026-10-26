// [V33.677] 웹 푸시 검사 — 암호화가 RFC 8291 부록 A 시험값과 바이트 단위로 같고, VAPID 서명이 검증되며,
//   서비스워커가 push·notificationclick 을 받고, 구독 주소는 알려진 푸시 서비스만 받는다(아무 주소로 워커가 POST 하지 않게).
import { readFileSync } from "node:fs";
let fails = 0;
const chk = (c, m, d) => { if (c) console.log("  ok   " + m); else { fails++; console.log("  FAIL " + m + (d ? " — " + d : "")); } };
const S = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const SW = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
const H = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const src = S.slice(S.indexOf("const PUSH_MAX = 20;"), S.indexOf("function pushTradeMsg"));
const M = new Function("getState", "setState", src + "; return { PUSH_HOSTS, _pb64, _pcat, _hkdf, pushEncrypt, _pushJwt };")(async () => null, async () => {});
const te = new TextEncoder(), d = M._pb64.dec, e = M._pb64.enc;
const asPub = d("BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8");
const uaPub = d("BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4");
const jwk = (pub, dd) => ({ kty: "EC", crv: "P-256", x: e(pub.slice(1, 33)), y: e(pub.slice(33, 65)), d: dd, ext: true });
const asPriv = await crypto.subtle.importKey("jwk", jwk(asPub, "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw"), { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: await crypto.subtle.importKey("raw", uaPub, { name: "ECDH", namedCurve: "P-256" }, false, []) }, asPriv, 256));
const auth = d("BTBZMqHH6r4Tts7J_aSIgg"), salt = d("DGv6ra1nlYgDCS1FRnbzlw");
const ikm = await M._hkdf(shared, auth, M._pcat(te.encode("WebPush: info\0"), uaPub, asPub), 256);
const cek = await M._hkdf(ikm, salt, te.encode("Content-Encoding: aes128gcm\0"), 128);
const nonce = await M._hkdf(ikm, salt, te.encode("Content-Encoding: nonce\0"), 96);
const k = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, k, M._pcat(te.encode("When I grow up, I want to be a watermelon"), new Uint8Array([2]))));
chk(e(M._pcat(salt, new Uint8Array([0, 0, 16, 0]), new Uint8Array([65]), asPub, ct)) === "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
    "aes128gcm 암호화 = RFC 8291 부록 A 시험값(바이트 단위)");
// 왕복: pushEncrypt 출력 → 수신 절차 복호
const ua = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
const up = new Uint8Array(await crypto.subtle.exportKey("raw", ua.publicKey)), au = crypto.getRandomValues(new Uint8Array(16));
const body = await M.pushEncrypt({ keys: { p256dh: e(up), auth: e(au) } }, "한글 ✓");
const sl = body.slice(0, 16), ap = body.slice(21, 86), c2 = body.slice(86);
const sh2 = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: await crypto.subtle.importKey("raw", ap, { name: "ECDH", namedCurve: "P-256" }, false, []) }, ua.privateKey, 256));
const ik2 = await M._hkdf(sh2, au, M._pcat(te.encode("WebPush: info\0"), up, ap), 256);
const k2 = await crypto.subtle.importKey("raw", await M._hkdf(ik2, sl, te.encode("Content-Encoding: aes128gcm\0"), 128), "AES-GCM", false, ["decrypt"]);
const pt = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: await M._hkdf(ik2, sl, te.encode("Content-Encoding: nonce\0"), 96) }, k2, c2));
chk(new TextDecoder().decode(pt.slice(0, -1)) === "한글 ✓" && pt[pt.length - 1] === 2 && body[20] === 65, "pushEncrypt 왕복 복호(마지막 레코드 구분 0x02 · 키 길이 65)");
const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const jwt = await M._pushJwt({ jwk: await crypto.subtle.exportKey("jwk", kp.privateKey) }, "https://fcm.googleapis.com");
const [h, b, sg] = jwt.split(".");
chk(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, kp.publicKey, d(sg), te.encode(h + "." + b)) && JSON.parse(new TextDecoder().decode(d(b))).aud === "https://fcm.googleapis.com", "VAPID JWT ES256 서명 검증 · aud = 푸시 서비스 origin");
chk(M.PUSH_HOSTS.test("https://fcm.googleapis.com/fcm/send/abc") && M.PUSH_HOSTS.test("https://web.push.apple.com/QG") && M.PUSH_HOSTS.test("https://jmt17.google.com/fcm/send/x") && M.PUSH_HOSTS.test("https://updates.push.services.mozilla.com/wpush/v2/x")
    && !M.PUSH_HOSTS.test("https://evil.example.com/fcm.googleapis.com/") && !M.PUSH_HOSTS.test("http://fcm.googleapis.com/x"), "구독 주소는 알려진 푸시 서비스(https)만");
chk(/addEventListener\('push'/.test(SW) && /addEventListener\('notificationclick'/.test(SW) && /showNotification/.test(SW), "서비스워커: push → 알림 · 누르면 앱으로");
chk(/try \{ await pushNotifyTick\(env\); \} catch/.test(S) && /if \(!Array\.isArray\(subs\) \|\| !subs\.length\) return;/.test(S), "크론: 구독 없으면 상태 1건 읽고 끝(D1 낭비 없음)");
chk(/id="btnPush"/.test(H) && /window\.__luxPush = async function/.test(H) && /id="btnInstall"/.test(H), "화면: 앱 설치 · 체결 알림 버튼");
{ // [V33.679] 앱 푸시(FCM HTTP v1) — 서비스 계정 키로 만든 RS256 JWT 가 공개키로 검증되고, 토큰 → messages:send 로 이어진다(가짜 fetch)
  const src2 = S.slice(S.indexOf("let __fcmTok = null;"), S.indexOf("function pushTradeMsg"));
  const kp2 = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const pk8 = Buffer.from(await crypto.subtle.exportKey("pkcs8", kp2.privateKey)).toString("base64").replace(/(.{64})/g, "$1\n");
  const env = { FCM_SA: JSON.stringify({ client_email: "x@p.iam.gserviceaccount.com", project_id: "lux-test", private_key: "-----BEGIN PRIVATE KEY-----\n" + pk8 + "\n-----END PRIVATE KEY-----\n" }) };
  const calls = [];
  const fakeFetch = async (u, o) => { calls.push([u, o]); if (/oauth2/.test(u)) return { status: 200, json: async () => ({ access_token: "tok", expires_in: 3600 }) }; return { status: 200, text: async () => "" }; };
  const F = new Function("fetch", "_pb64", "pushSend", src2 + "; return { fcmSend, pushOne };")(fakeFetch, M._pb64, async () => 201);
  const st = await F.fcmSend(env, "tokABC", { title: "t", body: "b", url: "/x", tag: "g" });
  const asr = new URLSearchParams(calls[0][1].body).get("assertion").split(".");
  const okSig = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", kp2.publicKey, d(asr[2]), te.encode(asr[0] + "." + asr[1]));
  const claim = JSON.parse(new TextDecoder().decode(d(asr[1]))), msg = JSON.parse(calls[1][1].body);
  chk(st === 200 && okSig && claim.scope === "https://www.googleapis.com/auth/firebase.messaging" && /projects\/lux-test\/messages:send/.test(calls[1][0]) && calls[1][1].headers.Authorization === "Bearer tok" && msg.message.token === "tokABC",
      "앱 푸시(FCM v1): 서비스 계정 RS256 서명 검증 · OAuth → messages:send · 토큰 전달");
  chk(await F.pushOne({}, null, { fcm: "t" }, {}) === 0 && /if \(b && typeof b\.fcm === "string"\)/.test(S), "FCM 키가 없으면 앱 구독은 저장만(보내지 않음) · 웹 푸시는 그대로");
}
const P = readFileSync(new URL("../public/privacy.html", import.meta.url), "utf8");
chk(/모의투자 서비스입니다/.test(P) && /생체 정보를 받거나 저장하지 않습니다/.test(P) && /href="\/privacy"/.test(H), "개인정보처리방침 · 모의투자 표기 페이지 + 메뉴 연결");
if (fails) { console.log("check-webpush: FAIL " + fails); process.exit(1); }
console.log("check-webpush: ok");
