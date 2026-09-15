/* Codex V33.329: observational UI only. No order calls, fetches, timers or client-side admission. */
(function(){
  'use strict';
  var last='';
  function el(tag,cls,text){var n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n;}
  /* ══ [V33.363] ★이 카드가 나머지 화면과 다른 잣대로 갈리고 있었다★ ═══════════════
     사용자 화면 실측(2026-09-15): 이 카드들은 XGB/LGB/CAT 에 "모델 판 불일치" 를 붙였는데,
     바로 그 카드 본문(r.why)은 "재학습은 돌고 있다 — featVer 17 모델이 47분 전 도착했으나
     승격 거절…" 이라고 정확히 적고 있었다. ★뱃지와 본문이 서로를 반박했다.★

     원인이 둘이다.
       ① featVerOk 가 ★낡은 승격기록★ 에서 나왔다 → 서버에서 고쳤다(V33.363).
       ② ★이 파일만 `r.tier` 로 갈렸다.★ 나머지 화면(LUXR)은 `r.state` 를 쓴다 —
          서버 rosterCls 가 낸 ★단일 출처★ 다. tier 로 직접 갈리면
          `tier:"full"` + `mult:0` 같은 조합이 "정식 합류 ×0.00" 으로 나온다(모순).
          V33.301 이 "판정이 여러 곳에 있다" 를 없애려고 state 를 만들었는데,
          이 파일이 그 뒤에 생기며 다시 tier 를 봤다.
     → state 를 그대로 쓴다. 이 파일은 색과 글자만 칠한다(다시 판정하지 않는다). */
  var labels={full:'정식 합류',provisional:'잠정 합류',pending:'검증 대기',reject:'성능 미달'};
  function tierText(r){
    var st=r&&r.state;
    if(st==='on')return '정식 합류';
    if(st==='prov')return '잠정 합류';
    if(st==='bad')return r.tier==='pending'?'검증 대기':'성능 미달';
    /* off = 잴 것이 없다 — 학습이 안 됐거나 판이 안 맞는다.
       ★"판 불일치" 는 현재 판이 ★정말 안 왔을 때만★ 쓴다 — 왔는데 거절된 것과는
       처방이 정반대다(전자는 기다리면 되고, 후자는 기다려도 안 된다). */
    if(!r||!r.trained)return '학습 대기';
    return '모델 판 불일치';
  }
  window.renderModelEvidence=function(mode){
    var root=document.getElementById('modelEvidenceRows'), counter=document.getElementById('modelEvidenceCount');
    var alt=mode&&mode.alt, roster=alt&&alt.roster;
    if(!root||!Array.isArray(roster)||!roster.length)return;
    var models=roster.filter(function(r){return r.key!=='rule'&&r.key!=='dual';});
    var fingerprint=JSON.stringify([models,alt.flow,alt.xalpha,alt.stack,alt.memo]);
    if(fingerprint===last)return; last=fingerprint;
    var active=models.filter(function(r){return r.state==='on'||r.state==='prov';}).length;
    counter.textContent='참여 '+active+' / '+models.length+' 모델';
    models.forEach(function(r){
      // Keyed nodes preserve focus, disclosure state, and scroll anchoring on refresh.
      var id='evidence-'+r.key, card=document.getElementById(id);
      if(!card){
        card=el('details','evidence-card');card.id=id;
        var summary=el('summary');summary.append(el('strong','evidence-name'),el('span','evidence-tier'),el('span','evidence-weight'));
        card.append(summary,el('p','evidence-reason'),el('p','evidence-measures'));root.append(card);
      }
      card.dataset.tier=r.tier||'unknown';
      card.querySelector('.evidence-name').textContent=r.key.toUpperCase().replace('_',' · ');
      card.dataset.state=r.state||'off';
      card.querySelector('.evidence-tier').textContent=tierText(r);
      card.querySelector('.evidence-weight').textContent='×'+(Number.isFinite(r.mult)?r.mult.toFixed(2):'—');
      card.querySelector('.evidence-reason').textContent=r.why||'상세 근거 응답 대기';
      var m=alt[r.key], measures=[];
      /* [V33.363] 현재 판은 왔는데 승격된 것은 옛 판인 상태 — 그 사실을 숨기지 않는다.
         (뱃지는 '성능 미달' 이 맞지만, 실제로 투표 자격이 있는 판이 따로 있다는 건 사실이다) */
      if(r.activeFeatVer!=null&&r.featVer!=null&&r.activeFeatVer!==r.featVer)
        measures.push('수신 판 v'+r.featVer+' · 승격돼 있는 판 v'+r.activeFeatVer+'(투표 안 함)');
      if(r.core)measures.push('코어 '+r.core);
      if(m){
        if(Number.isFinite(m.ts))measures.push('학습 '+new Date(m.ts).toLocaleString('ko-KR'));
        if(m.holdDays!=null)measures.push('홀드아웃 '+m.holdDays+'일');
        if(m.icT!=null)measures.push('홀드아웃 t '+Number(m.icT).toFixed(2));
        if(m.minFwd)measures.push('전진 표본 '+(m.fwdN||0)+' / '+m.minFwd);
        if(m.minFwdDays)measures.push('전진 날짜 '+(m.fwdDays||0)+' / '+m.minFwdDays+'일');
        if(m.fwdWhy)measures.push(m.fwdWhy);
      }
      card.querySelector('.evidence-measures').textContent=measures.join(' · ')||r.name;
    });
    Array.from(root.children).forEach(function(n){if(!models.some(function(r){return n.id==='evidence-'+r.key;}))n.remove();});
  };
})();
