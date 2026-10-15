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
    '#pbObs .k-prog{height:2px;background:var(--k-line);position:relative;overflow:hidden}#pbObs .k-prog i{position:absolute;inset:0 auto 0 0;background:var(--k-acc);animation:kprog 4.5s linear}',
    '@keyframes kprog{from{width:0}to{width:100%}}#pbObs .k-prog.off i{display:none}',
    '#pbObs .k-altw{overflow-x:auto;-webkit-overflow-scrolling:touch;margin-top:6px}#pbObs .k-alt td:first-child{white-space:normal;min-width:110px}',
    '#pbObs .k-alt td.on{color:var(--k-acc);font-weight:700}#pbObs .k-alt tr.off td{color:var(--k-dim);text-decoration:line-through}',
    '#pbObs .k-live{display:inline-flex;align-items:center;gap:6px}#pbObs .k-live:before{content:"";width:7px;height:7px;border-radius:50%;background:var(--k-good);box-shadow:0 0 0 0 var(--k-good);animation:kpulse 1.6s infinite}',
    '@keyframes kpulse{0%{box-shadow:0 0 0 0 rgba(61,220,151,.6)}70%{box-shadow:0 0 0 7px rgba(61,220,151,0)}100%{box-shadow:0 0 0 0 rgba(61,220,151,0)}}',
    '@media (max-width:1100px){#pbObs .k-scan{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}#pbObs .k-scan>div:last-child{grid-column:1/-1;border-left:0;border-top:1px solid var(--k-line)}}',
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
      return '<tr class="' + (off ? 'off' : '') + '"><td class="' + (on ? 'on' : '') + '">' + (on ? '✓ ' : '') + esc(nm(r[0])) + (off ? ' · 최근 성적으로 쉼' : '') + '</td>' +
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

  var root = null, timer = null, busy = false, data = null, mkSel = null, symSel = null, rot = null, pauseUntil = 0;
  function advance() {   // [V33.620] 스포트라이트 자동 순회(옛 'AI 스캔 순회' 처럼) — 누르면 30초 멈춤
    if (!root || !data || root.offsetParent === null || document.hidden || pauseUntil > Date.now()) return;
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
    var head = !r ? '매매법 표 대기' : (r.brake && r.brake.on) ? '실전 손실 제동 — 신규 매수 멈춤' : r.primary ? '매매법 AI 주력 운용' : '검증 전 — 그림자 판정';
    var why = !r ? '학습기(GitHub Actions)가 아직 이 시장 표를 올리지 않았습니다.'
      : (r.brake && r.brake.on) ? '최근 30일 실제 청산 ' + r.brake.n + '건 평균 ' + r.brake.mean + '% — 시뮬과 실전이 갈라져 새로 사지 않습니다(보유 청산은 그대로).'
      : r.primary ? '이 시장은 검증을 2회 연속 통과해 AI_PRIMARY 대신 매매법 AI 가 삽니다(크기 ×1.0).'
      : '후보마다 무엇을 골랐을지 계산만 하고 사지 않습니다. 검증을 2회 연속 통과하면 자동으로 주력이 됩니다(지금 연속 ' + (r.passStreak || 0) + '/2 · 그 전까지 AI_PRIMARY 유지).';
    return '<section class="k-panel k-brief"><div><span class="k-lab">PLAYBOOK · DECISION STATE</span><strong>' + esc(head) + '</strong><p>' + esc(why) + '</p></div>' +
      '<div><span class="k-lab">CANDIDATES</span><dd>' + ((lv && lv.n) || 0) + '</dd><small>OMNI-Q 상위 ' + candPct(j, mk) + '% 평가</small></div>' +
      '<div><span class="k-lab">FIRED</span><dd>' + fired + '</dd><small>지금 매매법 신호 뜸</small></div>' +
      '<div><span class="k-lab">CHOSEN</span><dd>' + chosen + (act ? '<small class="pos"> · 매수 ' + act + '</small>' : '') + '</dd><small>고른 매매법 있음</small></div>' +
      '<div><span class="k-lab">SCAN AGE</span><dd>' + esc(lv ? ago(lv.ts).replace(' 전', '') : '—') + '</dd><small>국면 ' + esc((lv && lv.regime) || (r && r.regime) || '—') + '</small></div></section>';
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
  }
  /* [V33.614] 매매법 AI 가 한 시장이라도 주력이면 01 작동 화면에서 AI_PRIMARY(위원회) 화면을 걷어낸다(#page-nnviz.pb-primary · CSS) */
  function primaryMode(j) {
    var m = (j && j.markets) || {}, on = !!((m.us && m.us.primary) || (m.kr && m.kr.primary));
    var pg = document.getElementById('page-nnviz');
    if (pg) pg.classList.toggle('pb-primary', on);
    var t = document.getElementById('nnvHeadcopy');
    if (t && on) t.textContent = '확률 높은 종목(OMNI-Q 상위)을 먼저 뽑고, 그 종목에서 지금 뜬 매매법 중 닮은 과거 성적이 가장 좋은 것으로 삽니다.';
  }
  function load() {
    if (busy || !root) return;
    busy = true;
    fetch('/api/playbook', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (j) { data = j || {}; window.__pbState = data; primaryMode(data); render(); })
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
      return true;
    },
    refresh: load
  };
})();
