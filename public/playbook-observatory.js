/* [V33.609·610] 매매법 AI 관측창 — 두뇌 페이지 '00 매매법 AI' 탭. 옛 MISSION CONTROL 과 같은 콘솔 문법(NOW · DECISION STATE · 스캔 순회 · 판정 깔때기).
   보여 주는 것: 이번 사이클 후보(OMNI-Q 상위 20%) 하나하나에서 ★지금 뜬 매매법★ 과 ★고른 매매법(또는 안 산 이유)★ ·
   작동 구조 · 시장별 검증/주력 전환 · 실전 보유·매수·청산 · 매매법 사전.
   데이터: GET /api/playbook (live = 워커가 매 사이클 남기는 후보별 판정). 읽기 전용 — 주문·학습을 건드리지 않는다. */
(function () {
  'use strict';
  var NAMES = {
    TREND_ALIGN: '추세 정렬', TR_BREAKOUT: '20일 돌파', RS_LEADER: '상대강도 상위', VT_TREND: '저변동 추세',
    TR_PULLBACK: '추세 눌림목', MA_PULLBACK: '20일선 지지', SN_RSI2: 'RSI2 반등', HA_REV: '하이킨아시 전환',
    BB_LOW: '볼린저 하단', STOCH_CROSS: '스토캐스틱 교차', STOCH_OS_EXIT: '스토캐스틱 과매도 이탈',
    VOL_BREAKOUT: '거래량 돌파', VOL_REVERT: '거래량 급락 반등', SQUEEZE: '스퀴즈 돌파', XS_ARB: '5일 낙폭 과대',
    DUAL_MOM: '듀얼 모멘텀', HERD_REBOUND: '거래량 2차 파동',
    OS_DEEP: '깊은 과매도 반등', CAPIT_REV: '투매 반등',
    ICHIMOKU: '이치모쿠 구름 돌파', KELTNER: '켈트너 채널 돌파', DONCHIAN: '돈치안 55일 돌파', MACD_X: 'MACD 교차', ENVELOPE: '이격도 반등',
    ELDER_RAY: '엘더 레이', WILLR: '윌리엄스 %R', CCI_REV: 'CCI 반등', PSAR: '파라볼릭 SAR', TRIPLE_SCR: '삼중창',
    IBS_LOW: 'IBS 저가 마감 반등', HI52_NEAR: '52주 고가 근접',
  GAP_FILL: '갭 메우기', PIVOT_BNC: '피봇 지지 반등',
    ORB: '시가 범위 돌파', DIP_REV: '장중 눌림 반등', STOCH5: '5분 스토캐스틱', MOM3: '5분 3봉 상승', VWAP_RE: 'VWAP 회복'
  };
  function nm(id) { return NAMES[id] || id || '—'; }
  var CSS = [
    '#pbObs{--k-bg:#0d1117;--k-panel:#11161e;--k-line:rgba(230,233,238,.10);--k-ink:#e6e9ee;--k-sub:#8b95a5;--k-dim:#5d6676;--k-acc:#39d0ff;--k-good:#3ddc97;--k-bad:#ff5d6c;--k-warn:#f5c451;',
    '--k-mono:"JetBrains Mono","SFMono-Regular",ui-monospace,Menlo,Consolas,monospace;display:flex;flex-direction:column;gap:12px;padding:2px 0 24px;color:var(--k-ink);font-size:13px}',
    'html[data-theme="light"] #pbObs{--k-bg:#f4f6f9;--k-panel:#fff;--k-line:#dde2ea;--k-ink:#141a22;--k-sub:#5a6474;--k-dim:#8a93a1;--k-acc:#0a6fb3;--k-good:#0d8a5c;--k-bad:#c8323f;--k-warn:#9a6a00}',
    '#pbObs .k-panel{background:var(--k-panel);border:1px solid var(--k-line);border-radius:12px;min-width:0}',
    '#pbObs .k-h{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:12px 14px;border-bottom:1px solid var(--k-line)}',
    '#pbObs .k-h b{font-family:var(--k-mono);font-size:12px;letter-spacing:1.6px;font-weight:700}',
    '#pbObs .k-h b:before{content:"";display:inline-block;width:14px;height:1px;background:currentColor;margin-right:8px;vertical-align:middle}',
    '#pbObs .k-h small{color:var(--k-sub);font-size:11px;margin-left:auto;font-family:var(--k-mono)}',
    '#pbObs .k-lab{font-family:var(--k-mono);font-size:10.5px;letter-spacing:1.8px;color:var(--k-sub);text-transform:uppercase}',
    '#pbObs .k-tag{font-family:var(--k-mono);font-size:10.5px;padding:2px 8px;border-radius:999px;border:1px solid var(--k-line);color:var(--k-sub);white-space:nowrap}',
    '#pbObs .k-tag.good{color:var(--k-good);border-color:currentColor}#pbObs .k-tag.warn{color:var(--k-warn);border-color:currentColor}#pbObs .k-tag.bad{color:var(--k-bad);border-color:currentColor}#pbObs .k-tag.acc{color:var(--k-acc);border-color:currentColor}',
    '#pbObs .k-orbit{display:grid;grid-template-columns:minmax(0,1fr) minmax(260px,1.5fr) minmax(0,1fr);align-items:center;gap:6px 10px;padding:16px 16px 12px;position:relative;overflow:hidden;background:radial-gradient(120% 90% at 50% 40%,rgba(57,208,255,.07),transparent 60%),var(--k-panel)}',
    '#pbObs .ko-side{display:flex;flex-direction:column;gap:10px;min-width:0}#pbObs .ko-k{border:1px solid var(--k-line);border-radius:14px;padding:12px 14px;background:rgba(255,255,255,.02);backdrop-filter:blur(6px)}#pbObs .ko-k.on{border-color:rgba(61,220,151,.45);box-shadow:0 0 0 1px rgba(61,220,151,.15) inset}',
    '#pbObs .ko-k dd{margin:6px 0 2px;font-family:var(--k-mono);font-size:26px;font-weight:600}#pbObs .ko-k small{color:var(--k-sub);font-size:11.5px}',
    '#pbObs .ko-c{position:relative;height:340px;min-width:0}#pbObs .ko-slot{position:absolute;inset:0;contain:strict}',
    '#pbObs .ko-omni{position:absolute;inset:0;display:grid;place-items:center;opacity:0;transition:opacity .6s}#pbObs .ko-omni.ready{opacity:1}',
    '#pbObs .ko-spin{position:relative;display:grid;place-items:center;max-width:100%;max-height:100%;cursor:crosshair;animation:koSpin 140s linear infinite;will-change:transform;border-radius:50%}#pbObs .ko-omni.sel .ko-spin{animation-play-state:paused}#pbObs .ko-mark{position:absolute;width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:50%;border:2px solid #ffcfb6;box-shadow:0 0 0 4px rgba(255,207,182,.25),0 0 14px #ffcfb6;pointer-events:none}',
    '#pbObs .ko-cv{display:block;max-width:100%;max-height:100%;border-radius:50%}#pbObs .ko-ring{display:none!important}',
    '#pbObs .ko-ring{position:absolute;left:50%;top:50%;border:1px solid rgba(150,200,255,.2);border-radius:50%;pointer-events:none}#pbObs .ko-ring.r1{width:min(100%,440px);aspect-ratio:3.1;transform:translate(-50%,-50%) rotate(-20deg)}#pbObs .ko-ring.r2{width:min(112%,500px);aspect-ratio:3.1;transform:translate(-50%,-50%) rotate(14deg)}',
    '#pbObs .ko-ring i{position:absolute;width:6px;height:6px;margin:-3px 0 0 -3px;border-radius:50%;background:rgba(180,210,255,.35)}#pbObs .ko-ring i.on.f{background:#f5c451;box-shadow:0 0 8px #f5c451}#pbObs .ko-ring i.on.c{background:#3ddc97;box-shadow:0 0 8px #3ddc97}',
    '#pbObs{container-type:inline-size}@container (max-width:640px){#pbObs .k-orbit{grid-template-columns:1fr 1fr}#pbObs .ko-c{grid-column:1/-1;grid-row:1;height:250px}#pbObs .ko-k{padding:10px 12px}#pbObs .ko-k dd{font-size:22px}}',
    '#pbObs .k-orbit.off .ko-spin{animation-play-state:paused}@keyframes koSpin{to{transform:rotate(1turn)}}@media (prefers-reduced-motion:reduce){#pbObs .ko-spin{animation:none}}',
    '#pbObs .ko-core{position:absolute;left:50%;bottom:6px;transform:translateX(-50%);text-align:center;width:min(92%,340px);pointer-events:none}#pbObs .ko-core strong{display:block;font-size:16px;margin-top:4px;letter-spacing:-.2px;text-shadow:0 2px 12px rgba(0,0,0,.6)}',
    '#pbObs .ko-dslot{grid-column:1/-1;min-width:0}#pbObs .ko-dos{margin-top:10px;border:1px solid var(--k-line);border-radius:16px;padding:12px 14px;display:flex;flex-direction:column;gap:10px;background:linear-gradient(160deg,rgba(255,255,255,.07),rgba(255,255,255,.015));box-shadow:inset 0 1px 0 rgba(255,255,255,.12)}',
    '#pbObs .kd-top{display:flex;flex-wrap:wrap;gap:4px 12px;align-items:baseline;justify-content:space-between}#pbObs .kd-sum{font-family:var(--k-mono);font-size:11px;color:var(--k-sub)}',
    '#pbObs .kd-grp{display:flex;flex-wrap:wrap;gap:6px}#pbObs .kd-grp button{font:inherit;font-size:12px;color:var(--k-sub);background:rgba(255,255,255,.04);border:1px solid var(--k-line);border-radius:999px;padding:5px 11px;cursor:pointer}#pbObs .kd-grp button b{font-family:var(--k-mono);font-weight:600;margin-left:4px;color:var(--k-ink)}#pbObs .kd-grp button[aria-pressed=true]{color:var(--k-ink);border-color:rgba(255,207,182,.55);background:rgba(255,207,182,.12)}',
    '#pbObs .kd-sel{font:inherit;font-size:12.5px;color:var(--k-ink);background:rgba(255,255,255,.05);border:1px solid var(--k-line);border-radius:10px;padding:7px 10px;max-width:100%}#pbObs .kd-sel option{background:#10131a;color:#eef}',
    '#pbObs .kd-card{border:1px solid rgba(255,207,182,.3);border-radius:14px;padding:12px 14px;background:rgba(255,207,182,.05)}#pbObs .kd-name{display:flex;align-items:center;gap:8px}#pbObs .kd-name i{width:9px;height:9px;border-radius:50%;background:#ffcfb6;box-shadow:0 0 8px #ffcfb6}#pbObs .kd-name b{font-family:var(--k-mono);font-size:15px;flex:1;min-width:0;overflow-wrap:anywhere}#pbObs .kd-name button{font:inherit;font-size:16px;line-height:1;color:var(--k-sub);background:none;border:0;cursor:pointer;padding:2px 6px}',
    '#pbObs .kd-kv{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin:10px 0 0}#pbObs .kd-kv div{min-width:0}#pbObs .kd-kv dt{font-family:var(--k-mono);font-size:10px;letter-spacing:1.2px;color:var(--k-sub)}#pbObs .kd-kv dd{margin:3px 0 0;font-family:var(--k-mono);font-size:14px;overflow-wrap:anywhere}#pbObs .kd-desc,#pbObs .kd-role{margin:10px 0 0;font-size:12.5px;line-height:1.6;color:var(--k-sub)}#pbObs .kd-role{color:var(--k-ink)}#pbObs .kd-empty{font-size:12.5px;color:var(--k-sub);line-height:1.6}',
    '@container (max-width:560px){#pbObs .kd-kv{grid-template-columns:repeat(2,minmax(0,1fr))}}',
    '#pbObs .ko-why{grid-column:1/-1;margin:4px 0 0;color:var(--k-sub);font-size:12.5px;line-height:1.55;text-align:center}',
    '@media (max-width:700px){#pbObs .k-orbit{grid-template-columns:1fr 1fr}#pbObs .ko-c{grid-column:1/-1;grid-row:1;height:240px}#pbObs .ko-side{flex-direction:column}}',
    '#pbObs .k-brief{display:grid;grid-template-columns:minmax(0,1.6fr) repeat(4,minmax(0,1fr))}',
    '#pbObs .k-brief>div{padding:14px;border-left:1px solid var(--k-line);min-width:0}#pbObs .k-brief>div:first-child{border-left:0}',
    '#pbObs .k-brief strong{display:block;font-size:20px;margin:6px 0 4px;letter-spacing:-.3px}',
    '#pbObs .k-brief p{margin:0;color:var(--k-sub);font-size:12px;line-height:1.5}',
    '#pbObs .k-brief dd{margin:6px 0 2px;font-family:var(--k-mono);font-size:24px;font-weight:600}#pbObs .k-brief small{color:var(--k-sub);font-size:11px}',
    '#pbObs .k-mkt{display:flex;gap:6px;margin-left:auto}#pbObs .k-mkt button{font-family:var(--k-mono);font-size:11px;padding:4px 10px;border-radius:7px;border:1px solid var(--k-line);background:transparent;color:var(--k-sub);cursor:pointer}',
    '#pbObs .k-mkt button[aria-pressed="true"]{background:var(--k-ink);color:var(--k-bg);border-color:var(--k-ink)}',
    '#pbObs .k-strip{display:flex;gap:8px;overflow-x:auto;padding:10px;scroll-snap-type:x proximity;-webkit-overflow-scrolling:touch}',
    '#pbObs .k-card{flex:0 0 200px;scroll-snap-align:start;border:1px solid var(--k-line);border-radius:10px;padding:10px;cursor:pointer;background:transparent;color:inherit;text-align:left;font:inherit}',
    '#pbObs .k-card.sel{border-color:var(--k-acc);box-shadow:0 0 0 1px var(--k-acc) inset}',
    '#pbObs .k-card .t{display:flex;justify-content:space-between;align-items:center;gap:6px}#pbObs .k-card .t b{font-family:var(--k-mono);font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '#pbObs .k-card .n{color:var(--k-sub);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px}',
    '#pbObs .k-card svg{display:block;width:100%;height:34px;margin:6px 0}',
    '#pbObs .k-card .r{font-family:var(--k-mono);font-size:11px;display:flex;justify-content:space-between;color:var(--k-sub)}',
    '#pbObs .k-card .p{margin-top:6px;font-size:12px;font-weight:600;min-height:17px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '#pbObs .k-card .f{display:flex;gap:4px;flex-wrap:wrap;margin-top:5px;min-height:18px}',
    '#pbObs .k-chip{font-size:10.5px;padding:1px 6px;border-radius:5px;border:1px solid var(--k-line);color:var(--k-sub);white-space:nowrap}#pbObs .k-chip.on{color:var(--k-acc);border-color:var(--k-acc)}',
    '#pbObs .k-detail{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);border-top:1px solid var(--k-line)}',
    '#pbObs .k-detail>div{padding:14px;min-width:0}#pbObs .k-detail>div+div{border-left:1px solid var(--k-line)}',
    '#pbObs .k-big{display:flex;align-items:baseline;justify-content:space-between;gap:8px}#pbObs .k-big b{font-family:var(--k-mono);font-size:22px}#pbObs .k-big span{font-family:var(--k-mono);font-size:26px;color:var(--k-acc)}',
    '#pbObs .k-row{display:flex;justify-content:space-between;gap:10px;padding:6px 0;border-bottom:1px solid var(--k-line);font-size:12px}#pbObs .k-row span:first-child{color:var(--k-sub)}#pbObs .k-row span:last-child{font-family:var(--k-mono);text-align:right}',
    '#pbObs .k-steps{display:flex;flex-direction:column;gap:0;margin-top:8px}#pbObs .k-step{display:grid;grid-template-columns:22px minmax(0,1fr);gap:8px;padding:6px 0;font-size:12px}',
    '#pbObs .k-step i{width:20px;height:20px;border-radius:50%;border:1px solid var(--k-line);display:grid;place-items:center;font-style:normal;font-family:var(--k-mono);font-size:10px;color:var(--k-sub)}',
    '#pbObs .k-step.ok i{border-color:var(--k-good);color:var(--k-good)}#pbObs .k-step.no i{border-color:var(--k-bad);color:var(--k-bad)}#pbObs .k-step small{display:block;color:var(--k-sub);font-size:11px}',
    '#pbObs .k-funnel{padding:12px 14px;display:flex;flex-direction:column;gap:8px}',
    '#pbObs .k-fs{display:grid;grid-template-columns:170px minmax(0,1fr) 60px;gap:10px;align-items:center;font-size:12px}#pbObs .k-fs i{display:block;height:8px;border-radius:4px;background:var(--k-acc);opacity:.8}#pbObs .k-fs span:last-child{font-family:var(--k-mono);text-align:right}',
    '#pbObs .k-flow{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:0}',
    '#pbObs .k-flow>div{padding:12px;border-left:1px solid var(--k-line);min-width:0}#pbObs .k-flow>div:first-child{border-left:0}',
    '#pbObs .k-flow b{display:block;font-size:12.5px;margin:4px 0}#pbObs .k-flow p{margin:0;font-size:11.5px;color:var(--k-sub);line-height:1.5}#pbObs .k-flow em{display:block;margin-top:6px;font-style:normal;font-family:var(--k-mono);font-size:11px;color:var(--k-ink)}',
    '#pbObs .k-loop{padding:9px 14px;border-top:1px dashed var(--k-line);font-size:11.5px;color:var(--k-sub)}',
    '#pbObs .k-grid2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}',
    '#pbObs .k-kv{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));border-bottom:1px solid var(--k-line)}#pbObs .k-kv div{padding:10px 12px;border-left:1px solid var(--k-line)}#pbObs .k-kv div:first-child{border-left:0}',
    '#pbObs .k-kv dd{margin:4px 0 0;font-family:var(--k-mono);font-size:17px;font-weight:600}',
    '#pbObs .k-body{padding:10px 14px}',
    '#pbObs table{width:100%;border-collapse:collapse;font-size:11.5px}#pbObs th,#pbObs td{text-align:left;padding:5px 6px;border-bottom:1px solid var(--k-line);white-space:nowrap}',
    '#pbObs th{color:var(--k-sub);font-weight:500;font-family:var(--k-mono);font-size:10.5px;letter-spacing:.6px}#pbObs td.num,#pbObs th.num{text-align:right;font-family:var(--k-mono)}#pbObs tr.sel td{color:var(--k-acc);font-weight:700}',
    '#pbObs .k-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch}',
    '#pbObs .k-dict{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:6px;padding:10px 14px}#pbObs .k-dict div{border:1px solid var(--k-line);border-radius:8px;padding:7px 9px;font-size:11.5px}#pbObs .k-dict b{display:block;font-size:12px}#pbObs .k-dict small{color:var(--k-sub);line-height:1.45;display:block}',
    '#pbObs .k-empty{color:var(--k-sub);font-size:12px;padding:12px 14px}',
    '#pbObs .pos{color:var(--k-good)}#pbObs .neg{color:var(--k-bad)}',
    /* [V33.620] AI 스캔 · 매매법 판정(옛 위원회 스캔 순회를 합침) */
    '#pbObs .k-scan{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(0,1fr) minmax(0,1.1fr);border-top:1px solid var(--k-line)}',
    '#pbObs .k-scan>div{padding:14px;min-width:0}#pbObs .k-scan>div+div{border-left:1px solid var(--k-line)}',
    '#pbObs .k-chart{display:block;width:100%;height:150px;margin:8px 0 10px}',
    '#pbObs .k-ind{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px}#pbObs .k-ind div{border:1px solid var(--k-line);border-radius:8px;padding:6px 8px;min-width:0}',
    '#pbObs .k-ind span{display:block;font-size:10.5px;color:var(--k-sub);white-space:nowrap}#pbObs .k-ind b{font-family:var(--k-mono);font-size:14px}',
    '#pbObs .k-prog{height:2px;background:var(--k-line);position:relative;overflow:hidden}#pbObs .k-prog i{position:absolute;inset:0;background:var(--k-acc);transform-origin:0 50%;animation:kprog 4.5s linear}',
    '@keyframes kprog{from{transform:scaleX(0)}to{transform:scaleX(1)}}#pbObs .k-prog.off i{display:none}',
    '#pbObs .k-altw{overflow-x:auto;-webkit-overflow-scrolling:touch;margin-top:6px}#pbObs .k-alt td:first-child{white-space:normal;min-width:110px}',
    '#pbObs .k-alt td.on{color:var(--k-acc);font-weight:700}#pbObs .k-alt tr.off td{color:var(--k-dim);text-decoration:line-through}',
    '#pbObs .k-live{display:inline-flex;align-items:center;gap:6px}#pbObs .k-live:before{content:"";width:7px;height:7px;border-radius:50%;background:var(--k-good);box-shadow:0 0 6px rgba(61,220,151,.7);animation:kpulse 1.6s infinite}',
    '@keyframes kpulse{0%,100%{opacity:1}50%{opacity:.45}}',
    '@media (max-width:1100px){#pbObs .k-scan{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}#pbObs .k-scan>div:last-child{grid-column:1/-1;border-left:0;border-top:1px solid var(--k-line)}}',
    '@container (max-width:860px){#pbObs .k-scan{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}#pbObs .k-scan>div:last-child{grid-column:1/-1;border-left:0;border-top:1px solid var(--k-line)}}',
    '@container (max-width:560px){#pbObs .k-scan{grid-template-columns:minmax(0,1fr)}#pbObs .k-scan>div+div{border-left:0;border-top:1px solid var(--k-line)}#pbObs .k-ind{grid-template-columns:repeat(2,minmax(0,1fr))}#pbObs .k-detail,#pbObs .k-grid2{grid-template-columns:minmax(0,1fr)}#pbObs .k-detail>div+div{border-left:0;border-top:1px solid var(--k-line)}}',
    '#pbObs>*{flex-shrink:0}',
    '@media (max-width:700px){#pbObs .k-scan{grid-template-columns:minmax(0,1fr)}#pbObs .k-scan>div+div{border-left:0;border-top:1px solid var(--k-line)}#pbObs .k-ind{grid-template-columns:repeat(2,minmax(0,1fr))}}',
    '@media (max-width:900px){#pbObs .k-brief{grid-template-columns:repeat(2,minmax(0,1fr))}#pbObs .k-brief>div:first-child{grid-column:1/-1}#pbObs .k-brief>div:nth-child(2){border-left:0}',
    '#pbObs .k-brief>div{border-top:1px solid var(--k-line)}#pbObs .k-brief>div:first-child{border-top:0}#pbObs .k-flow{grid-template-columns:repeat(2,minmax(0,1fr))}#pbObs .k-flow>div:nth-child(odd){border-left:0}#pbObs .k-flow>div{border-top:1px solid var(--k-line)}',
    '#pbObs .k-detail,#pbObs .k-grid2{grid-template-columns:minmax(0,1fr)}#pbObs .k-detail>div+div{border-left:0;border-top:1px solid var(--k-line)}#pbObs .k-kv{grid-template-columns:repeat(2,minmax(0,1fr))}#pbObs .k-fs{grid-template-columns:110px minmax(0,1fr) 44px}}'
  ].join('\n');

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function pct(v, d) { return v == null || !isFinite(v) ? '—' : (v > 0 ? '+' : '') + Number(v).toFixed(d == null ? 2 : d) + '%'; }
  function cls(v) { return v == null || !isFinite(v) ? '' : v > 0 ? 'pos' : v < 0 ? 'neg' : ''; }
  function ago(ts) {
    if (!ts) return '—';
    var m = Math.round((Date.now() - ts) / 60000);
    return m < 1 ? '방금' : m < 60 ? m + '분 전' : m < 1440 ? Math.round(m / 60) + '시간 전' : Math.round(m / 1440) + '일 전';
  }
  function spark(a) {
    if (!Array.isArray(a) || a.length < 2) return '<svg viewBox="0 0 100 34"></svg>';
    var lo = Math.min.apply(null, a), hi = Math.max.apply(null, a), r = hi - lo || 1;
    var pts = a.map(function (v, i) { return (i / (a.length - 1) * 100).toFixed(1) + ',' + (32 - (v - lo) / r * 30).toFixed(1); }).join(' ');
    var up = a[a.length - 1] >= a[0];
    return '<svg viewBox="0 0 100 34" preserveAspectRatio="none"><polyline fill="none" stroke="' + (up ? 'var(--k-good)' : 'var(--k-bad)') + '" stroke-width="1.4" vector-effect="non-scaling-stroke" points="' + pts + '"/></svg>';
  }
  function chart(a) {   // [V33.620] 60일 종가 + 20일선
    if (!Array.isArray(a) || a.length < 5) return '<svg class="k-chart" viewBox="0 0 300 150"></svg>';
    var lo = Math.min.apply(null, a), hi = Math.max.apply(null, a), r = hi - lo || 1, n = a.length;
    var X = function (i) { return (i / (n - 1) * 296 + 2).toFixed(1); }, Y = function (v) { return (140 - (v - lo) / r * 128).toFixed(1); };
    var pts = a.map(function (v, i) { return X(i) + ',' + Y(v); }).join(' ');
    var ma = [], s = 0;
    for (var i = 0; i < n; i++) { s += a[i]; if (i >= 20) s -= a[i - 20]; if (i >= 19) ma.push(X(i) + ',' + Y(s / 20)); }
    var up = a[n - 1] >= a[0], col = up ? 'var(--k-good)' : 'var(--k-bad)';
    return '<svg class="k-chart" viewBox="0 0 300 150" preserveAspectRatio="none">' +
      '<polygon fill="' + col + '" opacity=".08" points="2,142 ' + pts + ' 298,142"/>' +
      (ma.length > 1 ? '<polyline fill="none" stroke="var(--k-sub)" stroke-dasharray="3 3" stroke-width="1" vector-effect="non-scaling-stroke" points="' + ma.join(' ') + '"/>' : '') +
      '<polyline fill="none" stroke="' + col + '" stroke-width="1.6" vector-effect="non-scaling-stroke" points="' + pts + '"/>' +
      '<circle cx="' + X(n - 1) + '" cy="' + Y(a[n - 1]) + '" r="3" fill="' + col + '"/>' +
      '<text x="4" y="12" fill="var(--k-sub)" font-size="9">' + Number(hi).toLocaleString() + '</text><text x="4" y="148" fill="var(--k-sub)" font-size="9">' + Number(lo).toLocaleString() + '</text></svg>';
  }
  function ind(it) {
    var x = it.ind || {}, f = function (v, d, suf) { return v == null ? '—' : (+v).toFixed(d) + (suf || ''); };
    var cells = [['RSI14', f(x.rsi, 0), x.rsi != null && (x.rsi < 30 ? 'pos' : x.rsi > 70 ? 'neg' : '')], ['RSI2', f(x.rsi2, 0), x.rsi2 != null && (x.rsi2 <= 10 ? 'pos' : '')],
      ['20일선', x.g20 == null ? '—' : pct(x.g20, 1), cls(x.g20)], ['5일 수익', x.r5 == null ? '—' : pct(x.r5, 1), cls(x.r5)],
      ['거래량 배수', f(x.vr, 2, '×'), ''], ['ATR', f(x.atr, 1, '%'), ''], ['200일선', x.ma200 == null ? '—' : pct(x.ma200, 0), cls(x.ma200)], ['OMNI-Q', '상위 ' + Math.max(1, Math.round((1 - it.q) * 100)) + '%', '']];
    return '<div class="k-ind">' + cells.map(function (c) { return '<div><span>' + c[0] + '</span><b class="' + (c[2] || '') + '">' + c[1] + '</b></div>'; }).join('') + '</div>';
  }
  function altTable(it) {
    var alt = it.alt || [], bench = it.bench || [];
    var seen = {}; alt.forEach(function (r) { seen[r[0]] = 1; });
    (it.fired || []).forEach(function (f) { if (!seen[f]) alt.push([f, null, null, 0, null]); });
    if (!alt.length) return '<div class="k-empty">지금 뜬 매매법이 없습니다 — 진입 조건이 뜰 때까지 기다립니다.</div>';
    alt = alt.slice().sort(function (a, b) { return (b[4] == null ? -99 : b[4]) - (a[4] == null ? -99 : a[4]); });
    return '<div class="k-altw"><table class="k-alt"><thead><tr><th>뜬 매매법</th><th class="num">닮은 과거 평균</th><th class="num">승률</th><th class="num">표본</th></tr></thead><tbody>' + alt.map(function (r) {
      var on = r[0] === it.pb, off = bench.indexOf(r[0]) >= 0;
      return '<tr class="' + (off ? 'off' : '') + '"><td class="' + (on ? 'on' : '') + '">' + (on ? '✓ ' : '') + esc(nm(r[0])) + (off ? ' · 최근 성적으로 쉼' : '') + (r[5] ? ' · ' + esc(r[5]) : '') + '</td>' +
        '<td class="num ' + cls(r[1]) + '">' + (r[1] == null ? '표 없음' : pct(r[1])) + '</td><td class="num">' + (r[2] == null ? '—' : Math.round(r[2] * 100) + '%') + '</td><td class="num">' + (r[3] || '—') + '</td></tr>';
    }).join('') + '</tbody></table></div>';
  }
  function candPct(j, mk) { var r = (j.markets || {})[mk], q = r && r.daily && r.daily.val && r.daily.val.candQ; return Math.round((1 - (typeof q === 'number' ? q : 0.8)) * 100); }   // [V33.620] 검증이 고른 후보 폭
  function state(it) {   // 카드 배지
    if (it.act) return ['매수 후보', 'good'];
    if (it.why === '보유 중') return ['보유 중', 'acc'];
    if (it.pb) return ['선택(기록)', 'warn'];
    return ['대기', ''];
  }
  function exitTxt(it) {
    if (!it.pb) return '—';
    if (it.kind === 'intra') return (it.tpPct != null ? '+' + it.tpPct + '% 익절 · ' : '') + '−' + (it.stop || '—') + '% 손절 · ' + (it.bars ? it.bars * 5 + '분' : '장 끝까지');
    return '−' + (it.stop || '—') + '% 손절 · ' + (it.tpR ? it.tpR + 'R 익절 · ' : '익절 없음 · ') + (it.hold || '—') + '거래일';
  }

  var root = null, timer = null, busy = false, data = null, mkSel = null, symSel = null, rot = null, pauseUntil = 0, rootVis = true, rootIO = null;
  function advance() {   // [V33.620] 스포트라이트 자동 순회(옛 'AI 스캔 순회' 처럼) — 누르면 30초 멈춤
    if (!root || !data || !rootVis || root.offsetParent === null || document.hidden || pauseUntil > Date.now()) return;   // [V33.850] 화면 밖(아래 OMNI 를 볼 때)이면 패널을 다시 그리지 않는다
    var lv = (data.live || {})[mkSel], items = (lv && lv.items) || [];
    if (items.length < 2) return;
    var k = items.map(function (x) { return x.s; }).indexOf(symSel);
    symSel = items[(k + 1) % items.length].s;
    render();
    var c = root.querySelector('.k-card.sel'), s = root.querySelector('.k-strip');
    if (c && s) s.scrollTo({ left: Math.max(0, c.offsetLeft - s.offsetLeft - 20), behavior: 'smooth' });
  }

  function brief(j, mk) {
    var lv = (j.live || {})[mk], r = (j.markets || {})[mk];
    var items = (lv && lv.items) || [];
    var fired = lv && lv.f != null ? lv.f : items.filter(function (x) { return x.fired && x.fired.length; }).length, chosen = lv && lv.c != null ? lv.c : items.filter(function (x) { return x.pb; }).length, act = lv && lv.a != null ? lv.a : items.filter(function (x) { return x.act; }).length;
    /* [V33.656] 상태 4가지 — 종전엔 '검증 통과(시험 매수)' 칸이 없어 통과한 시장도 '검증 전 — 그림자 판정' 으로 보였다 · 퇴역한 AI_PRIMARY 문구 제거 */
    var dPass = !!(r && r.pass && r.pass.daily), aPass = !dPass && !!(r && r.pass && r.pass.absTrial);   // [V33.669] 미국 절대 성적 기준 시험 매수
    var tPass = !dPass && !aPass && !!(r && r.pass && r.pass.trialWhy === 'trade');   // [V33.680] (나) 종전 기준 시험 매수 — 종전엔 이 경우 '그림자 판정 · 사지 않음' 으로 잘못 보였다
    var head = !r ? '매매법 표 대기' : (r.brake && r.brake.on) ? '실전 손실 제동 — 신규 매수 멈춤' : r.primary ? '매매법 AI 주력 운용' : dPass ? '검증 통과 — 시험 매수(절반 크기)' : aPass ? '절대 성적 기준 — 시험 매수(절반 크기)' : tPass ? '종전 기준 통과 — 시험 매수(절반 크기)' : '검증 미통과 — 그림자 판정';
    var why = !r ? '학습기(GitHub Actions)가 아직 이 시장 표를 올리지 않았습니다.'
      : (r.brake && r.brake.on) ? '최근 30일 실제 청산 ' + r.brake.n + '건 평균 ' + r.brake.mean + '% — 시뮬과 실전이 갈라져 새로 사지 않습니다(보유 청산은 그대로).'
      : r.primary ? '겹치지 않는 판정 구간 두 곳에서 검증을 통과해 매매법 AI 가 정규 크기(×1.0)로 삽니다.'
      : dPass ? '최근 학습의 판정 구간을 통과해 정규장 마감 전 30분 · 프리·애프터마켓(종가 ±2% 안)에 절반 크기로 삽니다(하루 최대 3건 · 동시 6종목). 겹치지 않는 판정 구간 두 곳에서 통과하면 주력(×1.0)이 됩니다 — 독립 통과 ' + (r.indep || 0) + '/2 · 연속 통과 ' + (r.passStreak || 0) + '회.'
      : aPass ? '판정 구간에서 수익(평균 > 0 · t ≥ 2)이지만 무작위로 골랐을 때보다는 낫지 않아, 사용자 승인(10/25)에 따라 절대 성적 기준으로 절반 크기만 삽니다. 주력(×1.0)은 무작위보다 나음을 독립 구간 두 번 통과해야 합니다.'
      : tPass ? '종전 기준(뜬 신호 전부 · 무작위보다 나음 · t ≥ 2)은 통과해 절반 크기로 삽니다(사용자 선택 (나) 10/26). 주력(×1.0)은 새 기준 — 실전 상한 · 같은 달 무작위 대비 달 묶음 t ≥ 2 · 10/27 이후 전진 구간 60일 통과 — 이 필요합니다.'
      : '최근 학습의 판정 구간을 통과하지 못해 후보마다 무엇을 골랐을지 계산만 하고 사지 않습니다(독립 통과 ' + (r.indep || 0) + '/2).';
    /* [V33.843] ★오빗 배치★(사용자 11/16 인스타 'Orbit' 대시보드처럼) — 가운데 입자 구체(AI 코어 · 신호가 뜰수록 밝고 빠르게 돈다) · 둘레에 숫자 카드 4개 · 아래 판정 설명 */
    var sa = esc(lv ? ago(lv.ts).replace(' 전', '') : '—'), rg = esc((lv && lv.regime) || (r && r.regime) || '—');
    orbitLv = { n: (lv && lv.n) || 0, f: fired, c: chosen, a: act };
    var card = function (lab, val, sub, cls) { return '<div class="ko-k' + (cls ? ' ' + cls : '') + '"><span class="k-lab">' + lab + '</span><dd>' + val + '</dd><small>' + sub + '</small></div>'; };
    return '<section class="k-panel k-orbit">' +
      '<div class="ko-side">' + card('CANDIDATES · 후보', (lv && lv.n) || 0, 'OMNI-Q 상위 ' + candPct(j, mk) + '% 평가') + card('FIRED · 뜬 신호', fired, '지금 매매법 신호 뜸', fired ? 'on' : '') + '</div>' +
      '<div class="ko-c"><div class="ko-slot"></div><div class="ko-core"><span class="k-lab">PLAYBOOK · DECISION STATE</span><strong>' + esc(head) + '</strong></div></div>' +
      '<div class="ko-side">' + card('CHOSEN · 고름', chosen + (act ? '<small class="pos"> · 매수 ' + act + '</small>' : ''), '고른 매매법 있음', chosen ? 'on' : '') + card('SCAN AGE · 마지막 판정', sa, '국면 ' + rg + (r && r.panic ? ' · 공황' : '')) + '</div>' +
      '<p class="ko-why">' + esc(why) + '</p><div class="ko-dslot"></div></section>';
  }
  /* [V33.850] ★AI 코어 = OMNI 코어★(사용자 11/17 "ai코어에서 돌아가는거 omni코어 보는걸로 대체 · 렉 없이") — 예전 입자 구체는 900점을 30fps 로
     메인 스레드에서 계속 그렸다. 이제 OMNI 구조(/api/omni-structure · CDN 5분 · 두뇌 스튜디오와 같은 응답)를 한 번만 받아
     뉴런·가중치를 한 장에 나눠 긋고(장면당 3천 줄 · 쉬는 틈에), 회전은 CSS 가 그 한 장을 돌린다(합성기 · 메인 스레드 0).
     4.5초마다 패널을 새로 그려도 같은 캔버스를 옮겨 끼운다 — 다시 그리지 않는다.
     [V33.851] ★노드·역할은 여기서★(사용자 11/17) — 구체의 점을 누르거나 묶음·목록에서 고르면 그 뉴런의 선만 밝게 다시 긋고(누를 때 한 번),
     아래 노드 카드에 이름·묶음·세기·닿은 선·역할을 보인다. 클릭 좌표는 CSS 회전각을 되돌려 원래 그림 좌표로 바꿔 가장 가까운 점을 고른다. */
  var orbitLv = null, orbitWrap = null, orbitBusy = false, orbitDone = false, orbitIO = null;
  var orbitSc = null, orbitV = null, orbitG = null, orbitS = 0, orbitDos = null, orbitSel = -1, orbitTok = 0, orbitGrp = 0;
  function orbitMount() {
    var slot = root && root.querySelector('.ko-slot'); if (!slot) return;
    if (!orbitWrap) {
      orbitWrap = document.createElement('div'); orbitWrap.className = 'ko-omni';
      orbitWrap.innerHTML = '<div class="ko-spin" role="button" tabindex="-1" aria-label="OMNI 코어 — 점을 눌러 뉴런 역할 보기"><canvas class="ko-cv"></canvas><i class="ko-mark" hidden></i></div><span class="ko-ring r1"></span><span class="ko-ring r2"></span>';
      orbitWrap.querySelector('.ko-spin').addEventListener('click', orbitPick);
    }
    if (orbitWrap.parentNode !== slot) slot.appendChild(orbitWrap);
    var ds = root.querySelector('.ko-dslot');
    if (ds) { if (!orbitDos) { orbitDos = document.createElement('div'); orbitDos.className = 'ko-dos'; orbitDos.addEventListener('click', orbitDosClick); orbitDos.addEventListener('change', function (e) { if (e.target.matches('select')) orbitSelect(+e.target.value); }); orbitDosFill(); } if (orbitDos.parentNode !== ds) ds.appendChild(orbitDos); }
    orbitSat();
    if (!orbitDone && !orbitBusy) orbitBuild();
    var sec = slot.closest('.k-orbit');   // 화면 밖이면 회전도 멈춘다(합성기 일도 0)
    if (sec && window.IntersectionObserver) { if (!orbitIO) orbitIO = new IntersectionObserver(function (es) { es.forEach(function (e) { e.target.classList.toggle('off', !e.isIntersecting); }); }); orbitIO.disconnect(); orbitIO.observe(sec); }
  }
  function orbitSat() {   // 위성: 뜬 신호(금) · 고른 매매법(초록) — 점 몇 개만 바꾼다(그리기 없음)
    if (!orbitWrap) return; var lv = orbitLv || {}, f = Math.min(12, lv.f || 0), c = Math.min(8, lv.c || 0);
    var key = f + ':' + c; if (orbitWrap.__sat === key) return; orbitWrap.__sat = key;
    [['r1', f, Math.max(f, 3), 'f'], ['r2', c, Math.max(c, 1), 'c']].forEach(function (o) {
      var el = orbitWrap.querySelector('.' + o[0]), h = '';
      for (var q = 0; q < o[2]; q++) { var an = q * Math.PI * 2 / o[2] + (o[3] === 'c' ? 0.6 : 0.2); h += '<i class="' + (q < o[1] ? 'on ' + o[3] : '') + '" style="left:' + (50 + 50 * Math.cos(an)).toFixed(1) + '%;top:' + (50 + 50 * Math.sin(an)).toFixed(1) + '%"></i>'; }
      el.innerHTML = h;
    });
  }
  /* [V33.856] ★OMNI 코어 다시 그리기 — 푸른 홀로그램 구체★(사용자 11/17 "장난감 같다 · 선과 점 · 푸른 색감 · 지금처럼 복잡하게 · 노드 보기 유지").
     NeuralObservatory 의 분홍 그림 대신 같은 구조(omniCore 의 점·선·묶음)를 여기서 직접 투영해 긋는다:
       ① 짙은 남색 빛무리 + 위도·경도 격자(홀로그램 구면) ② 가중치 선 3.7만 줄 = 세기 7단 · 앞쪽일수록 밝게 · 푸른→하늘색(가산 합성)
       ③ 뉴런 점 = 묶음별 크기·색(입력 하늘 · 몸통 파랑 · 머리 흰 빛 고리 · 나무 청록) ④ 바깥 눈금 고리(HUD).
     한 번 긋고(쉬는 틈에 나눠서) CSS 가 돌린다 — 메인 스레드는 고를 때만 다시 긋는다. */
  function orbitProject(sc, S) {
    var n = sc.n, P = sc.P, yaw = .4, pitch = .32, cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    var mx = 1; for (var i = 0; i < n; i++) { var r0 = sc.ring[i]; if (r0 >= 0) { mx = Math.max(mx, sc.rings[r0].R); continue; } mx = Math.max(mx, Math.hypot(P[i * 3], P[i * 3 + 1], P[i * 3 + 2])); }
    var scale = S * 0.43 / mx, ox = S / 2, oy = S / 2;
    sc.SX = new Float32Array(n); sc.SY = new Float32Array(n); sc.SZ = new Float32Array(n); sc._mx = mx; sc._sc = scale;
    var rot = function (x, y, z, o) { var xr = x * cy + z * sy, zr = -x * sy + z * cy, yr = y * cp - zr * sp, dp = y * sp + zr * cp, k = 900 / (900 + dp * 400 / mx); o[0] = xr * k * scale + ox; o[1] = yr * k * scale + oy; o[2] = dp / mx; return o; };
    var o = [0, 0, 0];
    for (var j = 0; j < n; j++) { var x, y, z, r = sc.ring[j]; if (r >= 0) { var R = sc.rings[r], a = sc.ang[j], c = Math.cos(a) * R.R, s = Math.sin(a) * R.R; x = R.e1[0] * c + R.e2[0] * s; y = R.e1[1] * c + R.e2[1] * s; z = R.e1[2] * c + R.e2[2] * s; } else { x = P[j * 3]; y = P[j * 3 + 1]; z = P[j * 3 + 2]; }
      rot(x, y, z, o); sc.SX[j] = o[0]; sc.SY[j] = o[1]; sc.SZ[j] = o[2]; }
    sc._rot = rot;
  }
  function orbitDraw() {
    var g = orbitG, sc = orbitSc, S = orbitS, tok = ++orbitTok; if (!g || !sc) return;
    if (!sc.SX || sc._S !== S) { orbitProject(sc, S); sc._S = S; }
    if (!sc._role) { sc._role = new Uint8Array(sc.n); sc.groups.forEach(function (gr) { var lb = String(gr.label), k = lb === '입력' ? 1 : lb.indexOf('몸통') === 0 ? 2 : lb === '머리' ? 3 : lb === '나무' ? 4 : 5; gr.ids.forEach(function (id) { sc._role[id] = k; }); }); }
    var sel = orbitSel, cx = S / 2, rot = sc._rot, mx = sc._mx, SX = sc.SX, SY = sc.SY, SZ = sc.SZ, la = sc.la, lb = sc.lb, ls = sc.ls, m = la.length;
    g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, g.canvas.width, g.canvas.height); g.restore();
    // ① 빛무리 + 홀로그램 격자
    var halo = g.createRadialGradient(cx, cx, S * .05, cx, cx, S * .5); halo.addColorStop(0, 'rgba(40,110,255,.22)'); halo.addColorStop(.55, 'rgba(14,40,110,.18)'); halo.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = halo; g.fillRect(0, 0, S, S);
    g.lineWidth = .6; var o = [0, 0, 0], Rg = mx * 1.02;
    var poly = function (pts) { g.beginPath(); for (var q = 0; q < pts.length; q++) { rot(pts[q][0], pts[q][1], pts[q][2], o); q ? g.lineTo(o[0], o[1]) : g.moveTo(o[0], o[1]); } g.stroke(); };
    g.strokeStyle = 'rgba(90,160,255,.13)';
    for (var la_ = -75; la_ <= 75; la_ += 15) { var ph = la_ * Math.PI / 180, pts = []; for (var t = 0; t <= 72; t++) { var th = t / 72 * Math.PI * 2; pts.push([Math.cos(ph) * Math.cos(th) * Rg, Math.sin(ph) * Rg, Math.cos(ph) * Math.sin(th) * Rg]); } poly(pts); }
    for (var lo = 0; lo < 180; lo += 15) { var l2 = lo * Math.PI / 180, pm = []; for (var u = 0; u <= 72; u++) { var a2 = u / 72 * Math.PI * 2; pm.push([Math.cos(a2) * Math.cos(l2) * Rg, Math.sin(a2) * Rg, Math.cos(a2) * Math.sin(l2) * Rg]); } poly(pm); }
    // ④ 바깥 눈금 고리(HUD) — 회전과 함께 돈다
    g.strokeStyle = 'rgba(120,190,255,.35)'; g.lineWidth = 1; g.beginPath(); g.arc(cx, cx, S * .475, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = 'rgba(120,190,255,.18)'; g.setLineDash([2, 5]); g.beginPath(); g.arc(cx, cx, S * .455, 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
    g.beginPath(); for (var tk = 0; tk < 120; tk++) { var aa = tk / 120 * Math.PI * 2, l1 = tk % 10 === 0 ? S * .445 : S * .462; g.moveTo(cx + Math.cos(aa) * l1, cx + Math.sin(aa) * l1); g.lineTo(cx + Math.cos(aa) * S * .475, cx + Math.sin(aa) * S * .475); } g.strokeStyle = 'rgba(120,190,255,.28)'; g.stroke();
    g.lineWidth = 2.2; g.strokeStyle = 'rgba(140,210,255,.55)'; [[.15, .55], [1.9, 2.35], [3.6, 4.4], [5.2, 5.5]].forEach(function (ar) { g.beginPath(); g.arc(cx, cx, S * .487, ar[0], ar[1]); g.stroke(); });
    // ② 가중치 선 — 세기 7단(앞쪽 밝게) · 고른 뉴런이 있으면 나머지는 어둡게
    var L = 7, buckets = []; for (var b = 0; b < L; b++) buckets.push([]);
    var hi = [], dim = sel >= 0 ? .35 : 1, KW = [1.25, 1.4, 1.6, .9, .9, .5], kk;   // 종류별 무게: 0 입력→몸통 · 1 몸통→몸통 · 2 머리 · 3 나무 분기(1.4만 줄 — 고리 사이를 가로질러 판처럼 보여 강한 것만 옅게) · 4 장식
    for (var e = 0; e < m; e++) { var A = la[e], B = lb[e]; if (sel >= 0 && (A === sel || B === sel)) { hi.push(e); continue; }
      var dep = 1 - ((SZ[A] + SZ[B]) * .5 + 1) * .5, kk = sc.lk[e], v = Math.pow(Math.max(0, Math.min(1, ls[e] * KW[kk])), .8) * (.3 + .7 * dep) * dim; if (kk === 3) { if (ls[e] < .5) continue; v *= .2; } var lv = Math.min(L - 1, Math.floor(v * L)); buckets[lv].push(e); }
    var ex = 1, cols = [.012, .02, .032, .05, .08, .13, .22].map(function (a, q) { var c = ['40,90,210', '45,105,225', '55,125,240', '70,145,250', '90,170,255', '125,200,255', '175,228,255'][q]; return 'rgba(' + c + ',' + (a * ex * (q > 3 ? 1.8 : 1)).toFixed(4) + ')'; });
    g.globalCompositeOperation = 'lighter'; g.lineWidth = .6;
    var lvl = 0, idx = 0;
    var step = function () {
      if (tok !== orbitTok) return;
      var t0 = performance.now();
      while (lvl < L && performance.now() - t0 < 12) {
        var arr = buckets[lvl], end = Math.min(arr.length, idx + 4000); g.strokeStyle = cols[lvl]; g.beginPath();
        for (; idx < end; idx++) { var ee = arr[idx]; g.moveTo(SX[la[ee]], SY[la[ee]]); g.lineTo(SX[lb[ee]], SY[lb[ee]]); }
        g.stroke(); if (idx >= arr.length) { lvl++; idx = 0; }
      }
      if (lvl < L) { (window.requestIdleCallback || function (f) { return setTimeout(f, 16); })(step, { timeout: 200 }); return; }
      if (hi.length) { g.strokeStyle = 'rgba(220,240,255,.75)'; g.lineWidth = 1.1; g.beginPath(); hi.forEach(function (ee) { g.moveTo(SX[la[ee]], SY[la[ee]]); g.lineTo(SX[lb[ee]], SY[lb[ee]]); }); g.stroke(); }
      g.globalCompositeOperation = 'source-over';
      // ③ 뉴런 점 — 뒤에서 앞으로
      var role = sc._role, ord = []; for (var i = 0; i < sc.n; i++) if (role[i]) ord.push(i); ord.sort(function (p, q) { return SZ[q] - SZ[p]; });
      ord.forEach(function (i) { var k = role[i], f = (1 - (SZ[i] + 1) * .5), al = (.35 + .65 * f) * (sel >= 0 && i !== sel ? .55 : 1), r = k === 3 ? 3.4 : k === 2 ? 1.5 : k === 4 ? 1.1 : 1.3;
        g.fillStyle = k === 3 ? 'rgba(235,248,255,' + al + ')' : k === 1 ? 'rgba(125,215,255,' + al + ')' : k === 2 ? 'rgba(80,150,255,' + al + ')' : k === 4 ? 'rgba(90,230,215,' + (al * .8) + ')' : 'rgba(160,190,255,' + al + ')';
        g.beginPath(); g.arc(SX[i], SY[i], r, 0, Math.PI * 2); g.fill();
        if (k === 3) { g.strokeStyle = 'rgba(140,210,255,' + (al * .7) + ')'; g.lineWidth = 1; g.beginPath(); g.arc(SX[i], SY[i], 7, 0, Math.PI * 2); g.stroke(); } });
      orbitBusy = false; orbitDone = true;
    };
    orbitWrap.classList.add('ready'); step();
  }
  function orbitBuild() {
    var NO = window.NeuralObservatory; if (!NO || !NO.omniCore) { setTimeout(function () { if (orbitWrap && orbitWrap.isConnected) orbitMount(); }, 1500); return; }
    orbitBusy = true;
    fetch('/api/omni-structure').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }).then(function (st) {
      var cv = orbitWrap.querySelector('canvas'), box = orbitWrap.getBoundingClientRect();
      var S = Math.max(220, Math.round(Math.min(box.width || 300, box.height || 300))), dpr = Math.min(2, window.devicePixelRatio || 1);
      cv.width = Math.round(S * dpr); cv.height = Math.round(S * dpr); cv.style.width = cv.style.height = S + 'px';
      try { orbitSc = NO.omniCore({}, st && st.ok ? st : null); } catch (e) { orbitBusy = false; return; }
      orbitG = cv.getContext('2d'); orbitG.setTransform(dpr, 0, 0, dpr, 0, 0); orbitS = S;
      orbitV = { yaw: .4, pitch: .32, zoom: 1.08, panX: 0, panY: 0, selected: -1, motion: false, spin: false, glow: false, small: null, lite: false, lod: false, fit: S, fxOut: true, budget: 3000 };
      orbitDraw(); orbitDosFill();
    });
  }
  function orbitPick(e) {   // 화면 좌표 → CSS 회전 되돌림 → 그림 좌표 → 가장 가까운 점
    var sc = orbitSc; if (!sc || !sc.SX) return;
    var sp = e.currentTarget, rc = sp.getBoundingClientRect(), cv = sp.querySelector('canvas'), k = (cv.clientWidth || orbitS) / orbitS;
    var m = getComputedStyle(sp).transform, a = 1, b = 0; if (m && m !== 'none') { var p = m.match(/matrix\(([^)]+)\)/); if (p) { var q = p[1].split(','); a = +q[0]; b = +q[1]; } }
    var th = Math.atan2(b, a), dx = e.clientX - (rc.left + rc.width / 2), dy = e.clientY - (rc.top + rc.height / 2);
    var x = orbitS / 2 + (dx * Math.cos(th) + dy * Math.sin(th)) / k, y = orbitS / 2 + (-dx * Math.sin(th) + dy * Math.cos(th)) / k;
    var best = -1, bd = Math.pow(14 / k, 2);
    if (!sc.__pick) { sc.__pick = new Uint8Array(sc.n); sc.groups.forEach(function (g) { g.ids.forEach(function (id) { sc.__pick[id] = 1; }); }); }   // 장식 점(고리·눈금)은 고르지 않는다 — 묶음에 든 뉴런만
    for (var i = 0; i < sc.n; i++) { if (!sc.__pick[i]) continue; var ddx = sc.SX[i] - x, ddy = sc.SY[i] - y, d2 = ddx * ddx + ddy * ddy - (sc.SZ[i] < 0 ? 4 : 0); if (d2 < bd) { bd = d2; best = i; } }
    orbitSelect(best);
  }
  function orbitKind(id) { var sc = orbitSc, gk = sc.groups.find(function (x) { return x.ids.indexOf(id) >= 0; }), lb = gk ? String(gk.label) : ''; return [lb, lb === '입력' ? 0 : lb.indexOf('몸통') === 0 ? 1 : lb === '머리' ? 3 : lb === '나무' ? 4 : -1]; }
  function orbitSelect(id) {
    if (!orbitSc) return; orbitSel = id >= 0 ? id : -1;
    var mk = orbitWrap.querySelector('.ko-mark');
    if (orbitSel >= 0 && orbitSc.SX) { mk.hidden = false; mk.style.left = (orbitSc.SX[orbitSel] / orbitS * 100).toFixed(2) + '%'; mk.style.top = (orbitSc.SY[orbitSel] / orbitS * 100).toFixed(2) + '%'; var gi = orbitSc.groups.findIndex(function (x) { return x.ids.indexOf(orbitSel) >= 0; }); if (gi >= 0) orbitGrp = gi; }
    else mk.hidden = true;
    orbitWrap.classList.toggle('sel', orbitSel >= 0);
    orbitDraw(); orbitDosFill();
  }
  function orbitDosClick(e) {
    var b = e.target.closest('[data-kg]'); if (b) { orbitGrp = +b.getAttribute('data-kg'); var g = orbitSc && orbitSc.groups[orbitGrp]; orbitSelect(g && g.ids.length ? g.ids[0] : -1); return; }
    if (e.target.closest('[data-kclr]')) orbitSelect(-1);
  }
  function orbitDosFill() {
    var el = orbitDos, sc = orbitSc; if (!el) return;
    if (!sc) { el.innerHTML = '<div class="kd-empty">OMNI 구조 불러오는 중…</div>'; return; }
    var NO = window.NeuralObservatory, f = function (x) { return Number(x || 0).toLocaleString('ko-KR'); }, I = sc.info || {};
    var h = '<div class="kd-top"><span class="k-lab">NODE DOSSIER · 노드 역할</span><span class="kd-sum">' + (I.full ? '신경망 ' + esc((I.sizes || []).join('→')) + ' · 가중치 ' + f(I.params) + ' · 나무 ' + f(I.trees) + '그루 · 분기 ' + f(I.splits) : '대표 연결만') + '</span></div>';
    h += '<div class="kd-grp">' + sc.groups.map(function (g, q) { return '<button type="button" data-kg="' + q + '" aria-pressed="' + (q === orbitGrp) + '">' + esc(g.label) + ' <b>' + f(g.ids.length) + '</b></button>'; }).join('') + '</div>';
    var g = sc.groups[orbitGrp] || sc.groups[0];
    h += '<select class="kd-sel" aria-label="노드 고르기"><option value="-1">' + esc(g ? g.label : '') + ' — 노드 고르기</option>' + (g ? g.ids.slice(0, 600).map(function (id) { return '<option value="' + id + '"' + (id === orbitSel ? ' selected' : '') + '>' + esc(String(sc.name[id] || '').split(' — ')[0]) + '</option>'; }).join('') : '') + '</select>';
    if (orbitSel >= 0) {
      var id = orbitSel, k = orbitKind(id), vv = sc.val[id], cnt = 0, base = String(sc.name[id] || ''), role = '';
      for (var j = 0; j < sc.la.length; j++) if (sc.la[j] === id || sc.lb[j] === id) cnt++;
      try { role = NO.NODE_ROLE.omniRole(k[1], base); } catch (e) {}
      h += '<div class="kd-card"><div class="kd-name"><i></i><b>' + esc(base.split(' — ')[0]) + '</b><button type="button" data-kclr aria-label="선택 지우기">×</button></div>' +
        '<dl class="kd-kv"><div><dt>묶음</dt><dd>' + esc(k[0] || '—') + '</dd></div><div><dt>세기</dt><dd>' + (vv === vv ? (vv * 100).toFixed(0) + '%' : '—') + '</dd></div><div><dt>닿은 선</dt><dd>' + f(cnt) + '</dd></div><div><dt>번호</dt><dd>#' + id + '</dd></div></dl>' +
        (base.indexOf(' — ') > 0 ? '<p class="kd-desc">' + esc(base.split(' — ').slice(1).join(' — ')) + '</p>' : '') +
        (role ? '<p class="kd-role">' + esc(role) + '</p>' : '') + '</div>';
    } else h += '<div class="kd-empty">구체의 점을 누르거나 위 묶음·목록에서 고르면 그 뉴런의 연결만 밝게 남고 역할이 여기 나옵니다.</div>';
    el.innerHTML = h;
  }

  function strip(j, mk) {
    var lv = (j.live || {})[mk], items = (lv && lv.items) || [];
    var pos = items.length ? Math.max(0, items.map(function (x) { return x.s; }).indexOf(symSel)) + 1 : 0;
    var h = '<section class="k-panel"><div class="k-h"><b>AI 스캔 · 매매법 판정</b><span class="k-tag">' + (mk === 'us' ? '미국' : '한국') + '</span>' +
      '<span class="k-live" style="font-size:11px;color:var(--k-sub)">' + (pauseUntil > Date.now() ? '고정(30초 뒤 다시 순회)' : '순회 중 ' + pos + '/' + items.length) + '</span>' +
      '<small>' + (lv ? '최근 사이클 ' + esc(ago(lv.ts)) + (lv.mtc != null ? ' · 마감까지 ' + lv.mtc + '분' : ' · 장 밖') : '아직 기록 없음') + '</small></div>' +
      '<div class="k-prog' + (pauseUntil > Date.now() ? ' off' : '') + '"><i></i></div>';
    if (!items.length) return h + '<div class="k-empty">이번 사이클에 OMNI-Q 상위 ' + candPct(j, mk) + '% 후보가 평가되지 않았습니다(장 밖이거나 OMNI-Q 점수가 낡음).</div></section>';
    if (!symSel || !items.some(function (x) { return x.s === symSel; })) symSel = items[0].s;
    h += '<div class="k-strip">' + items.map(function (it) {
      var st = state(it);
      return '<button type="button" class="k-card' + (it.s === symSel ? ' sel' : '') + '" data-pbsym="' + esc(it.s) + '">' +
        '<div class="t"><b>' + esc(it.s) + '</b><span class="k-tag ' + st[1] + '">' + st[0] + '</span></div><div class="n">' + esc(it.nm || '') + '</div>' + spark(it.sp) +
        '<div class="r"><span>OMNI-Q 상위 ' + Math.max(1, Math.round((1 - it.q) * 100)) + '%</span><span class="' + cls(it.dp) + '">' + pct(it.dp) + '</span></div>' +
        '<div class="p">' + (it.pb ? '→ ' + esc(nm(it.pb)) : '<span style="color:var(--k-dim)">' + esc(it.why || '대기') + '</span>') + '</div>' +
        '<div class="f">' + (it.fired || []).slice(0, 4).map(function (f) { return '<span class="k-chip' + (f === it.pb ? ' on' : '') + '">' + esc(nm(f)) + '</span>'; }).join('') + '</div></button>';
    }).join('') + '</div>';
    var it = items.filter(function (x) { return x.s === symSel; })[0];
    if (it) {
      var steps = [
        [true, '후보', 'OMNI-Q 5일 상위 ' + Math.max(1, Math.round((1 - it.q) * 100)) + '% (점수 ' + it.q + ')'],
        [(it.fired || []).length > 0, '지금 뜬 매매법', (it.fired || []).length ? it.fired.map(nm).join(' · ') : '없음 — 진입 조건이 뜨기 전엔 사지 않습니다'],
        [!!it.pb, '닮은 과거 칸에서 선택', it.pb ? nm(it.pb) + ' · 모의 성공 ' + (it.w != null ? Math.round(it.w * 100) + '%' : '—') + ' · 평균 ' + pct(it.m) + ' · 표본 ' + (it.n || '—') : (it.why || '성적 기준을 넘는 매매법 없음')],
        [!!it.act, '매수', it.act ? it.act : (it.why || '—')]
      ];
      h += '<div class="k-scan"><div><div class="k-big"><b>' + esc(it.s) + '</b><span class="' + cls(it.dp) + '" style="font-size:18px">' + Number(it.px).toLocaleString() + ' · ' + pct(it.dp) + '</span></div>' +
        '<div style="color:var(--k-sub);font-size:12px">' + esc(it.nm || '') + '</div>' + chart(it.sp) + ind(it) + '</div>' +
        '<div><span class="k-lab">판정 단계</span><div class="k-steps">' + steps.map(function (s, i) { return '<div class="k-step ' + (s[0] ? 'ok' : 'no') + '"><i>' + (i + 1) + '</i><div>' + esc(s[1]) + '<small>' + esc(s[2]) + '</small></div></div>'; }).join('') + '</div>' +
        '<div class="k-row" style="margin-top:6px"><span>매도 규칙</span><span>' + esc(exitTxt(it)) + '</span></div><div class="k-row"><span>상태</span><span>' + esc(it.act || it.why || '—') + '</span></div></div>' +
        '<div><span class="k-lab">왜 이 매매법인가 — 뜬 매매법 비교</span>' + altTable(it) + '</div></div>';
    }
    return h + '</section>';
  }

  function funnel(j, mk) {
    var lv = (j.live || {})[mk], items = (lv && lv.items) || [];
    var n = (lv && lv.n) || 0, f = lv && lv.f != null ? lv.f : items.filter(function (x) { return x.fired && x.fired.length; }).length,
        c = lv && lv.c != null ? lv.c : items.filter(function (x) { return x.pb; }).length, a = lv && lv.a != null ? lv.a : items.filter(function (x) { return x.act; }).length;
    var mx = Math.max(1, n);
    var rows = [['① 후보(OMNI-Q 상위 ' + candPct(j, mk) + '%)', n], ['② 매매법 신호 뜸', f], ['③ 매매법 선택', c], ['④ 매수 후보', a]];
    return '<section class="k-panel"><div class="k-h"><b>판정 깔때기</b><small>' + '이번 사이클 · 평가 ' + n + '종목' + '</small></div><div class="k-funnel">' +
      rows.map(function (r) { return '<div class="k-fs"><span>' + r[0] + '</span><i style="width:' + Math.max(2, Math.round(r[1] / mx * 100)) + '%"></i><span>' + r[1] + '</span></div>'; }).join('') + '</div></section>';
  }

  function live(j) {
    var open = j.open || [], rec = j.recent || [], ex = j.exits || [];
    var h = '<section class="k-panel"><div class="k-h"><b>실전 기록</b><small>보유 ' + open.length + ' · 최근 매수 ' + rec.length + ' · 청산 ' + ex.length + '</small></div><div class="k-body k-scroll">';
    if (!open.length && !rec.length && !ex.length) return h + '<div class="k-empty" style="padding:4px 0">아직 매매법 AI 거래가 없습니다 — 검증을 통과한 시장에서만 삽니다.</div></div></section>';
    if (open.length) h += '<table><thead><tr><th>보유</th><th>매매법</th><th class="num">진입가</th><th class="num">손절</th><th>진입</th></tr></thead><tbody>' + open.map(function (p) {
      var s = p.sr || {}; return '<tr><td>' + esc(p.symbol) + '</td><td>' + esc(nm(s.sid)) + (s.primary ? ' ★' : '') + '</td><td class="num">' + Number(p.avg).toLocaleString() + '</td><td class="num">−' + (s.stop || '—') + '%</td><td>' + esc(ago(p.opened)) + '</td></tr>';
    }).join('') + '</tbody></table>';
    if (ex.length) h += '<table style="margin-top:8px"><thead><tr><th>청산</th><th>종목</th><th class="num">손익</th><th>사유</th></tr></thead><tbody>' + ex.map(function (t) {
      return '<tr><td>' + esc(ago(t.ts)) + '</td><td>' + esc(t.symbol) + '</td><td class="num ' + cls(t.pnl_pct) + '">' + pct(t.pnl_pct) + '</td><td>' + esc(String(t.reason || '').slice(0, 50)) + '</td></tr>';
    }).join('') + '</tbody></table>';
    return h + '</div></section>';
  }
  function render() {
    if (!root || !data) return;
    var j = data;
    if (!mkSel) { var lu = (j.live || {}).us, lk = (j.live || {}).kr; mkSel = (lk && (!lu || lk.ts > lu.ts)) ? 'kr' : 'us'; }
    var keepX = {}; root.querySelectorAll('.k-strip').forEach(function (s, i) { keepX[i] = s.scrollLeft; });
    root.innerHTML =
      '<div style="display:flex;align-items:center;gap:8px"><span class="k-lab">매매법 AI · 실시간 판정 — 모델 설명·검증은 02 모델 구조</span><div class="k-mkt">' +
      ['us', 'kr'].map(function (m) { return '<button type="button" data-pbmk="' + m + '" aria-pressed="' + (m === mkSel) + '">' + (m === 'us' ? 'US' : 'KR') + '</button>'; }).join('') + '</div></div>' +
      brief(j, mkSel) + strip(j, mkSel) + funnel(j, mkSel) + live(j);   // [V33.612] 작동 구조·검증·사전은 02 모델 구조(Brain Studio '매매법 AI')
    root.querySelectorAll('.k-strip').forEach(function (s, i) { if (keepX[i]) s.scrollLeft = keepX[i]; });
    try { orbitMount(); } catch (e) {}
  }
  /* [V33.614] 매매법 AI 가 한 시장이라도 주력이면 01 작동 화면에서 AI_PRIMARY(위원회) 화면을 걷어낸다(#page-nnviz.pb-primary · CSS) */
  function primaryMode(j) {
    var m = (j && j.markets) || {}, on = !!((m.us && m.us.primary) || (m.kr && m.kr.primary));
    var pg = document.getElementById('page-nnviz');
    if (pg) pg.classList.toggle('pb-primary', on);
    var t = document.getElementById('nnvHeadcopy');
    if (t && on) t.textContent = '확률 높은 종목(OMNI-Q 상위)을 먼저 뽑고, 그 종목에서 지금 뜬 매매법 중 닮은 과거 성적이 가장 좋은 것으로 삽니다.';
  }
  /* [V33.691] ★빨리 보이게★ — ① 지난번 자료(localStorage)로 바로 그리고 ② 진행 중인 같은 요청(window.__pbFetchP · 10초 안)이 있으면 그것을 나눠 쓴다
     (종전: 01 화면 위 요약칸과 이 패널이 /api/playbook 을 동시에 두 번 받았다). 30초 주기 갱신은 새 요청. */
  var LSK = 'pbObs:last';
  function load() {
    if (busy || !root) return;
    busy = true;
    if (!data) { try { var c = JSON.parse(localStorage.getItem(LSK) || 'null'); if (c && c.markets) { data = c; window.__pbState = window.__pbState || c; primaryMode(c); render(); } } catch (e) {} }
    var fresh = window.__pbFetchP && (Date.now() - (window.__pbFetchAt || 0)) < 10000;
    var pr = fresh ? window.__pbFetchP : fetch('/api/playbook', { cache: 'no-store' }).then(function (r) { return r.json(); });
    if (!fresh) { window.__pbFetchP = pr; window.__pbFetchAt = Date.now(); }
    pr.then(function (j) { data = j || {}; window.__pbState = data; primaryMode(data); render(); try { var t = JSON.stringify(j); if (t.length < 300000) localStorage.setItem(LSK, t); } catch (e) {} })
      .catch(function () { if (root && !data) root.innerHTML = '<section class="k-panel"><div class="k-empty">매매법 AI 상태를 불러오지 못했습니다. 잠시 뒤 다시 시도합니다.</div></section>'; })
      .then(function () { busy = false; });
  }
  window.PlaybookObs = {
    mount: function (el) {
      if (!el) return false;
      if (!document.getElementById('pbObsCss')) { var st = document.createElement('style'); st.id = 'pbObsCss'; st.textContent = CSS; document.head.appendChild(st); }
      if (root !== el) {
        root = el;
        root.addEventListener('click', function (e) {
          var b = e.target.closest('[data-pbmk]'); if (b) { mkSel = b.getAttribute('data-pbmk'); symSel = null; render(); return; }
          var c = e.target.closest('[data-pbsym]'); if (c) { symSel = c.getAttribute('data-pbsym'); pauseUntil = Date.now() + 30000; render(); }
        });
      }
      if (!root.innerHTML) root.innerHTML = '<section class="k-panel"><div class="k-empty">매매법 AI 상태 불러오는 중…</div></section>';
      load();
      if (!timer) timer = setInterval(function () { if (root && root.offsetParent !== null && !document.hidden) load(); }, 30000);
      if (!rot) rot = setInterval(advance, 4500);
      if (!rootIO && window.IntersectionObserver) { rootIO = new IntersectionObserver(function (es) { rootVis = es[es.length - 1].isIntersecting; }); rootIO.observe(root); }
      return true;
    },
    refresh: load
  };
})();
