/* Codex V33.329: observational UI only. No order calls, fetches, timers or client-side admission. */
(function(){
  'use strict';
  var last='';
  function el(tag,cls,text){var n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n;}
  var labels={full:'정식 합류',provisional:'잠정 합류',pending:'검증 대기',reject:'성능 미달'};
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
      card.querySelector('.evidence-tier').textContent=r.featVerOk===false?'모델 판 불일치':(!r.trained?'학습 대기':(labels[r.tier]||'상태 확인'));
      card.querySelector('.evidence-weight').textContent='×'+(Number.isFinite(r.mult)?r.mult.toFixed(2):'—');
      card.querySelector('.evidence-reason').textContent=r.why||'상세 근거 응답 대기';
      var m=alt[r.key], measures=[];
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
