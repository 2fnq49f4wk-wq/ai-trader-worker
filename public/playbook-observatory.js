/* [V33.609] 매매법 AI 관측창 — 두뇌 페이지 '00 매매법 AI' 탭.
   작동 구조(후보 → 지금 뜬 매매법 → 닮은 과거 칸 → 선택 → 매수 → 매매법 매도 → 매 회차 재시뮬)를 실제 상태와 함께 보여준다.
   데이터: GET /api/playbook (표 요약 · 검증 · 매매법 정의 · 최근 매수/청산 · 보유). 읽기 전용 — 주문·학습을 건드리지 않는다. */
(function () {
  'use strict';
  var NAMES = {
    TREND_ALIGN: '추세 정렬', TR_BREAKOUT: '20일 돌파', RS_LEADER: '상대강도 상위', VT_TREND: '저변동 추세',
    TR_PULLBACK: '추세 눌림목', MA_PULLBACK: '20일선 지지', SN_RSI2: 'RSI2 반등', HA_REV: '하이킨아시 전환',
    BB_LOW: '볼린저 하단', STOCH_CROSS: '스토캐스틱 교차', STOCH_OS_EXIT: '스토캐스틱 과매도 이탈',
    VOL_BREAKOUT: '거래량 돌파', VOL_REVERT: '거래량 급락 반등', SQUEEZE: '스퀴즈 돌파', XS_ARB: '5일 낙폭 과대',
    DUAL_MOM: '듀얼 모멘텀', HERD_REBOUND: '거래량 2차 파동',
    ORB: '시가 범위 돌파', DIP_REV: '장중 눌림 반등', STOCH5: '5분 스토캐스틱', MOM3: '5분 3봉 상승', VWAP_RE: 'VWAP 회복'
  };
  var RULE_TXT = function (r) {
    if (!r) return '—';
    return (r.score === 'lcb' ? '하한(평균−오차)' : '평균') + ' · ' + (r.level === 'global' ? '매매법 전체 성적' : r.level === 'regime' ? '국면 칸까지' : '상황 칸 전체');
  };
  var CSS = [
    '#pbObs{--pb-bg:rgba(20,28,44,.55);--pb-line:rgba(140,170,220,.18);--pb-ink:#e3ebf8;--pb-sub:#8fa3c4;--pb-good:#5fe0b0;--pb-warn:#ffc46b;--pb-bad:#ff8f8f;--pb-acc:#7cc4ff;',
    'display:flex;flex-direction:column;gap:14px;padding:4px 0 24px;color:var(--pb-ink);font-size:13px;}',
    'html[data-theme="light"] #pbObs{--pb-bg:#fff;--pb-line:#dbe3ee;--pb-ink:#16202e;--pb-sub:#5b6b82;--pb-good:#0f8a5f;--pb-warn:#a36a00;--pb-bad:#c23b3b;--pb-acc:#0b5fb8;}',
    '#pbObs h3{margin:0;font-size:15px;font-weight:700;letter-spacing:-.2px}',
    '#pbObs .pb-sub{color:var(--pb-sub);font-size:12px;line-height:1.55;margin:4px 0 0}',
    '#pbObs .pb-card{background:var(--pb-bg);border:1px solid var(--pb-line);border-radius:12px;padding:14px 16px;min-width:0}',
    '#pbObs .pb-flow{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-top:12px;counter-reset:pbstep}',
    '#pbObs .pb-step{position:relative;border:1px solid var(--pb-line);border-radius:10px;padding:10px 11px;background:rgba(124,196,255,.04);min-width:0}',
    '#pbObs .pb-step b{display:block;font-size:12.5px;margin-bottom:3px}',
    '#pbObs .pb-step b:before{counter-increment:pbstep;content:counter(pbstep);display:inline-grid;place-items:center;width:18px;height:18px;border-radius:50%;margin-right:6px;font-size:10.5px;background:var(--pb-acc);color:#08111f}',
    '#pbObs .pb-step p{margin:0;color:var(--pb-sub);font-size:11.5px;line-height:1.5}',
    '#pbObs .pb-step .pb-live{margin-top:6px;font-size:11.5px;color:var(--pb-ink);font-variant-numeric:tabular-nums}',
    '#pbObs .pb-step.loop{border-style:dashed;grid-column:1/-1}',
    '#pbObs .pb-step.loop b:after{content:" ↺ 다시 ①로";color:var(--pb-sub);font-weight:400;font-size:11px}',
    '#pbObs .pb-mk{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px}',
    '#pbObs .pb-mkh{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px}',
    '#pbObs .pb-badge{font-size:11px;padding:2px 9px;border-radius:999px;border:1px solid currentColor;white-space:nowrap}',
    '#pbObs .pb-badge.good{color:var(--pb-good)}#pbObs .pb-badge.warn{color:var(--pb-warn)}#pbObs .pb-badge.bad{color:var(--pb-bad)}#pbObs .pb-badge.dim{color:var(--pb-sub)}',
    '#pbObs .pb-kv{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;margin:8px 0}',
    '#pbObs .pb-kv div{border:1px solid var(--pb-line);border-radius:8px;padding:6px 8px;min-width:0}',
    '#pbObs .pb-kv dt{font-size:10.5px;color:var(--pb-sub)}#pbObs .pb-kv dd{margin:2px 0 0;font-size:14px;font-weight:700;font-variant-numeric:tabular-nums}',
    '#pbObs table{width:100%;border-collapse:collapse;font-size:11.5px;font-variant-numeric:tabular-nums}',
    '#pbObs th,#pbObs td{text-align:left;padding:4px 6px;border-bottom:1px solid var(--pb-line);white-space:nowrap}',
    '#pbObs th{color:var(--pb-sub);font-weight:500}#pbObs td.num,#pbObs th.num{text-align:right}',
    '#pbObs tr.sel td{color:var(--pb-acc);font-weight:700}',
    '#pbObs .pb-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch}',
    '#pbObs .pb-bars{display:flex;flex-direction:column;gap:4px;margin-top:6px}',
    '#pbObs .pb-bar{display:grid;grid-template-columns:110px minmax(0,1fr) 40px;gap:6px;align-items:center;font-size:11.5px}',
    '#pbObs .pb-bar i{display:block;height:7px;border-radius:4px;background:var(--pb-acc);opacity:.75}',
    '#pbObs .pb-bar span:last-child{text-align:right;color:var(--pb-sub);font-variant-numeric:tabular-nums}',
    '#pbObs .pb-sec{font-size:12px;color:var(--pb-sub);margin:10px 0 4px;font-weight:600}',
    '#pbObs .pb-dict{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:6px}',
    '#pbObs .pb-dict div{border:1px solid var(--pb-line);border-radius:8px;padding:7px 9px;font-size:11.5px;min-width:0}',
    '#pbObs .pb-dict b{display:block;font-size:12px}#pbObs .pb-dict small{color:var(--pb-sub);display:block;line-height:1.45}',
    '#pbObs .pb-empty{color:var(--pb-sub);font-size:12px;padding:6px 0}',
    '#pbObs .pos{color:var(--pb-good)}#pbObs .neg{color:var(--pb-bad)}',
    '@media (max-width:560px){#pbObs .pb-kv{grid-template-columns:repeat(2,minmax(0,1fr))}#pbObs .pb-bar{grid-template-columns:92px minmax(0,1fr) 34px}}'
  ].join('\n');

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function pct(v, d) { return v == null || !isFinite(v) ? '—' : (v > 0 ? '+' : '') + Number(v).toFixed(d == null ? 2 : d) + '%'; }
  function cls(v) { return v == null || !isFinite(v) ? '' : v > 0 ? 'pos' : v < 0 ? 'neg' : ''; }
  function ago(ts) {
    if (!ts) return '—';
    var m = Math.round((Date.now() - ts) / 60000);
    return m < 60 ? m + '분 전' : m < 1440 ? Math.round(m / 60) + '시간 전' : Math.round(m / 1440) + '일 전';
  }
  function nm(id) { return NAMES[id] || id; }

  function valBlock(v, label) {
    if (!v) return '<div class="pb-empty">' + esc(label) + ' — 아직 표 없음</div>';
    if (v.why) return '<div class="pb-empty">' + esc(label) + ' — ' + esc(v.why) + '</div>';
    var h = '<div class="pb-sec">' + esc(label) + ' · 손대지 않은 마지막 20% 구간 판정</div>' +
      '<dl class="pb-kv">' +
      '<div><dt>고른 매매법 평균</dt><dd class="' + cls(v.mean) + '">' + pct(v.mean) + '</dd></div>' +
      '<div><dt>아무거나 평균</dt><dd class="' + cls(v.base) + '">' + pct(v.base) + '</dd></div>' +
      '<div><dt>t 값 (기준 ≥ 2)</dt><dd>' + (v.t == null ? '—' : Number(v.t).toFixed(2)) + '</dd></div>' +
      '<div><dt>거래 · 승률</dt><dd>' + (v.n || 0) + ' · ' + (v.win == null ? '—' : v.win + '%') + '</dd></div></dl>' +
      '<div class="pb-sub">선택 규칙: <b>' + esc(RULE_TXT(v.rule)) + '</b> (검증 구간에서 4개 중 고름)</div>';
    if (Array.isArray(v.valCmp) && v.valCmp.length) {
      h += '<div class="pb-scroll"><table><thead><tr><th>규칙 후보</th><th class="num">거래</th><th class="num">평균</th><th class="num">t</th><th class="num">아무거나</th></tr></thead><tbody>';
      v.valCmp.forEach(function (c) {
        var sel = v.rule && c.rule && c.rule.score === v.rule.score && c.rule.level === v.rule.level;
        h += '<tr' + (sel ? ' class="sel"' : '') + '><td>' + esc(RULE_TXT(c.rule)) + '</td><td class="num">' + (c.n || 0) + '</td><td class="num ' + cls(c.mean) + '">' + pct(c.mean) +
          '</td><td class="num">' + (c.t == null ? '—' : Number(c.t).toFixed(2)) + '</td><td class="num">' + pct(c.base) + '</td></tr>';
      });
      h += '</tbody></table></div>';
    }
    var by = v.byPb || {}, keys = Object.keys(by).sort(function (a, b) { return by[b] - by[a]; }).slice(0, 8), mx = keys.length ? by[keys[0]] : 1;
    if (keys.length) {
      h += '<div class="pb-sec">판정 구간에서 고른 매매법</div><div class="pb-bars">';
      keys.forEach(function (k) { h += '<div class="pb-bar"><span>' + esc(nm(k)) + '</span><i style="width:' + Math.max(4, Math.round(by[k] / mx * 100)) + '%"></i><span>' + by[k] + '</span></div>'; });
      h += '</div>';
    }
    return h;
  }

  function marketCard(mk, r) {
    var title = mk === 'us' ? '미국' : '한국';
    if (!r) return '<div class="pb-card"><div class="pb-mkh"><h3>' + title + '</h3><span class="pb-badge dim">표 없음</span></div><div class="pb-empty">학습기(GitHub Actions)가 아직 이 시장 표를 올리지 않았습니다.</div></div>';
    var badge = r.primary ? '<span class="pb-badge good">주력 — AI_PRIMARY 퇴역</span>'
      : (r.pass && r.pass.daily ? '<span class="pb-badge warn">통과 · 표가 낡음</span>' : '<span class="pb-badge warn">검증 미통과 — AI_PRIMARY 유지</span>');
    return '<div class="pb-card"><div class="pb-mkh"><h3>' + title + '</h3>' + badge +
      '<span class="pb-badge dim">국면 ' + esc(r.regime || '—') + '</span><span class="pb-badge dim">표 ' + esc(ago(r.ts)) + '</span></div>' +
      valBlock(r.daily && r.daily.val, '일봉 매매법 ' + ((r.daily && r.daily.cells) || 0) + '칸') +
      valBlock(r.intra && r.intra.val, '5분 단타 ' + ((r.intra && r.intra.cells) || 0) + '칸') + '</div>';
  }

  function dict(j) {
    var any = null;
    ['us', 'kr'].forEach(function (m) { if (!any && j.markets && j.markets[m]) any = j.markets[m]; });
    if (!any) return '';
    var h = '<div class="pb-card"><h3>매매법 사전 — 사는 조건이 다르고, 파는 규칙도 다르다</h3><p class="pb-sub">후보 종목에서 아래 매매법의 진입 신호가 ★지금★ 떠야 삽니다. 여러 개가 뜨면 그 종목의 지금 상황 칸에서 성적이 가장 좋은 것 하나로 삽니다.</p>';
    var d = (any.daily && any.daily.pb) || {}, it = (any.intra && any.intra.pb) || {};
    h += '<div class="pb-sec">일봉 (스윙) · ' + Object.keys(d).length + '종</div><div class="pb-dict">';
    Object.keys(d).forEach(function (k) {
      var p = d[k];
      h += '<div><b>' + esc(nm(k)) + '</b><small>' + esc(p.family || '') + ' · 손절 ' + p.stop + '% (ATR×' + p.atr + ' 중 작은 쪽) · 본전 ' + p.be + 'R · ' +
        (p.tpR ? '익절 ' + p.tpR + 'R · ' : '익절 없음 · ') + '최대 ' + p.hold + '거래일</small></div>';
    });
    h += '</div><div class="pb-sec">5분 단타 · ' + Object.keys(it).length + '종</div><div class="pb-dict">';
    Object.keys(it).forEach(function (k) {
      var p = it[k];
      h += '<div><b>' + esc(nm(k)) + '</b><small>' + esc(p.label || '') + ' · 익절 ' + (p.tpPct == null ? '없음' : '+' + p.tpPct + '%') + ' · 손절 −' + p.sl + '% · ' + (p.bars ? p.bars * 5 + '분' : '장 끝까지') + '</small></div>';
    });
    return h + '</div></div>';
  }

  function live(j) {
    var h = '<div class="pb-card"><h3>실전 — 매매법 AI 가 산 것</h3>';
    var open = j.open || [], rec = j.recent || [], ex = j.exits || [];
    h += '<div class="pb-sec">보유 중 ' + open.length + '건</div>';
    if (!open.length) h += '<div class="pb-empty">없음</div>';
    else {
      h += '<div class="pb-scroll"><table><thead><tr><th>종목</th><th>매매법</th><th class="num">진입가</th><th class="num">손절</th><th>매도 규칙</th><th>진입</th></tr></thead><tbody>';
      open.forEach(function (p) {
        var s = p.sr || {};
        var rule = s.kind === 'intra' ? (s.tpPct ? '+' + s.tpPct + '% · ' : '') + (s.bars ? s.bars * 5 + '분' : '장 끝') : (s.tpR ? s.tpR + 'R 익절 · ' : '') + (s.hold || '—') + '거래일';
        h += '<tr><td>' + esc(p.symbol) + '</td><td>' + esc(nm(s.sid)) + (s.primary ? ' ★' : '') + '</td><td class="num">' + Number(p.avg).toLocaleString() + '</td><td class="num">−' + (s.stop || '—') + '%</td><td>' + esc(rule) + '</td><td>' + esc(ago(p.opened)) + '</td></tr>';
      });
      h += '</tbody></table></div>';
    }
    h += '<div class="pb-sec">최근 매수</div>';
    h += rec.length ? '<div class="pb-scroll"><table><tbody>' + rec.map(function (t) {
      return '<tr><td>' + esc(ago(t.ts)) + '</td><td>' + esc(t.symbol) + '</td><td>' + esc(String(t.reason || '').replace(/^\[SROUTE\]\[[A-Z]+\]\s*/, '').slice(0, 90)) + '</td></tr>';
    }).join('') + '</tbody></table></div>' : '<div class="pb-empty">아직 없음 — 검증을 통과한 시장에서만 삽니다.</div>';
    h += '<div class="pb-sec">최근 매매법 청산</div>';
    h += ex.length ? '<div class="pb-scroll"><table><tbody>' + ex.map(function (t) {
      return '<tr><td>' + esc(ago(t.ts)) + '</td><td>' + esc(t.symbol) + '</td><td class="num ' + cls(t.pnl_pct) + '">' + pct(t.pnl_pct) + '</td><td>' + esc(String(t.reason || '').slice(0, 60)) + '</td></tr>';
    }).join('') + '</tbody></table></div>' : '<div class="pb-empty">아직 없음</div>';
    return h + '</div>';
  }

  function flow(j) {
    var mk = j.markets || {}, caps = j.caps || {}, route = j.route || {};
    var st = function (fn) { return ['us', 'kr'].map(function (m) { return (m === 'us' ? '미 ' : '한 ') + fn(mk[m]); }).join(' · '); };
    var steps = [
      ['후보', 'OMNI-Q 5일 머리 상위 ' + Math.round((1 - (route.candMin || 0.8)) * 100) + '% 종목만 봅니다. 매매법 신호가 먼저가 아닙니다.', '매 분 · 오를 확률 높은 종목'],
      ['지금 뜬 매매법', '그 종목에서 일봉 17종 · 5분 단타 5종의 진입 조건을 지금 가격으로 계산합니다.', '스토캐스틱 · RSI2 · 눌림 · 돌파 · ORB · VWAP …'],
      ['닮은 과거 칸', '지금 상황(국면 · RSI · 20일선 거리 · 5일 수익 · 거래량 · FOMC/CPI / 장중 등락 · 시간)과 같은 칸의 과거 시뮬 성적을 찾습니다.', st(function (r) { return r ? ((r.daily && r.daily.cells) || 0) + '칸' : '—'; })],
      ['선택', '뜬 매매법 중 그 칸 점수가 가장 높고 성공확률 ≥ 50% 인 것 하나. 없으면 안 삽니다.', st(function (r) { return r && r.daily && r.daily.val ? RULE_TXT(r.daily.val.rule) : '—'; })],
      ['매수', '검증을 통과한 시장만. 통과 시장은 AI_PRIMARY 를 끄고 주력(크기 ×' + ((caps.primary && caps.primary.mult) || 1) + ' · 하루 ' + ((caps.primary && caps.primary.maxPerDay) || '—') + '건).', st(function (r) { return r ? (r.primary ? '주력' : '미통과') : '—'; })],
      ['그 매매법의 매도', '손절 · 익절 · 본전 이동 · 최대 보유일 · 단타는 장 끝 10분 전. 위원회 청산은 걸지 않습니다.', '보유 ' + ((j.open || []).length) + '건'],
      ['매 회차 재시뮬 · 검증', 'GitHub Actions 가 과거 전 종목에 모든 매매법을 다시 적용해 표를 새로 만들고, 손대지 않은 마지막 구간에서만 통과를 판정합니다.', st(function (r) { return r ? ago(r.ts) : '—'; })]
    ];
    return '<div class="pb-card"><h3>작동 구조 — 확률 높은 종목을 먼저 뽑고, 그 종목에 맞는 매매법으로 산다</h3>' +
      '<p class="pb-sub">모든 단계 아래 줄은 지금 실제 상태입니다. 위원회(AI_PRIMARY)는 검증을 통과한 시장부터 자동으로 퇴역합니다.</p><div class="pb-flow">' +
      steps.map(function (s, i) { return '<div class="pb-step' + (i === steps.length - 1 ? ' loop' : '') + '"><b>' + esc(s[0]) + '</b><p>' + esc(s[1]) + '</p><div class="pb-live">' + esc(s[2]) + '</div></div>'; }).join('') +
      '</div></div>';
  }

  var root = null, timer = null, busy = false;
  function render(j) {
    if (!root) return;
    root.innerHTML = flow(j) + '<div class="pb-mk">' + marketCard('us', j.markets && j.markets.us) + marketCard('kr', j.markets && j.markets.kr) + '</div>' + live(j) + dict(j);
  }
  function load() {
    if (busy || !root) return;
    busy = true;
    fetch('/api/playbook', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (j) { render(j || {}); })
      .catch(function () { if (root && !root.innerHTML) root.innerHTML = '<div class="pb-card"><div class="pb-empty">매매법 AI 상태를 불러오지 못했습니다. 잠시 뒤 다시 시도합니다.</div></div>'; })
      .then(function () { busy = false; });
  }
  window.PlaybookObs = {
    mount: function (el) {
      if (!el) return false;
      if (!document.getElementById('pbObsCss')) { var st = document.createElement('style'); st.id = 'pbObsCss'; st.textContent = CSS; document.head.appendChild(st); }
      root = el;
      if (!root.innerHTML) root.innerHTML = '<div class="pb-card"><div class="pb-empty">매매법 AI 상태 불러오는 중…</div></div>';
      load();
      if (!timer) timer = setInterval(function () { if (root && root.offsetParent !== null && !document.hidden) load(); }, 60000);
      return true;
    },
    refresh: load
  };
})();
