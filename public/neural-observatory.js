/* Codex V33.324: new Canvas scene engine. Replaces the old SVG neural renderers.
 * Motion illustrates signal transport, never live activations. Data remains API-owned. */
(function(root){
  'use strict';
  const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
  const finite=n=>typeof n==='number'&&Number.isFinite(n);
  const value=n=>finite(n)?n:null;
  const TAU=Math.PI*2;
  function project(p,c){
    const x=p.x*Math.cos(c.yaw)+p.z*Math.sin(c.yaw);
    const z=-p.x*Math.sin(c.yaw)+p.z*Math.cos(c.yaw);
    const y=p.y*Math.cos(c.pitch)-z*Math.sin(c.pitch);
    const depth=p.y*Math.sin(c.pitch)+z*Math.cos(c.pitch);
    const k=900/(900+depth);
    return {x:x*k,y:y*k,z:depth,k};
  }
  function dense(layers){
    const nodes=[],edges=[],groups=[];
    layers.forEach((layer,l)=>{
      const strengths=layer.strength||[], count=strengths.length||1, group=[];
      const label=layer.tag||layer.name||(l===0?'IN':l===layers.length-1?'OUT':'H'+l);
      // Golden-angle nerve bodies: original indices and every neuron are retained.
      for(let i=0;i<count;i++){
        const a=i*2.39996323, r=Math.sqrt((i+.5)/count);
        const n={x:(l-(layers.length-1)/2)*100+Math.cos(a)*r*30,
          y:Math.sin(a)*r*(45+Math.sqrt(count)*3),z:0,l,i,
          v:value(strengths[i]), name:layer.names?.[i]||`${label} · #${i}`,
          label,kind:layer.kind};
        group.push(nodes.length);nodes.push(n);
      }
      groups.push({ids:group,label,count});
    });
    for(let l=0;l<groups.length-1;l++){
      const a=groups[l].ids,b=groups[l+1].ids;
      for(let i=0;i<Math.max(a.length,b.length);i++) edges.push({a:a[i%a.length],b:b[i%b.length],v:null});
    }
    return {nodes,edges,groups};
  }
  function attention(d,s){
    if(!d.trained) return null;
    const all=d.attnByBlock?.[s.block];
    if(!all) return null;
    const heads=s.head<0?all:[all[s.head]], rows=heads.map(h=>h?.[s.row]).filter(Boolean);
    if(!rows.length) return null;
    return Array.from({length:d.L||d.cfg?.L||16},(_,i)=>{
      const vals=rows.map(r=>r[i]).filter(finite);
      return vals.length?vals.reduce((a,b)=>a+b,0)/vals.length:null;
    });
  }
  function sequence(d,s){
    const L=d.L||d.cfg?.L||16, D=d.D||d.cfg?.D||75, width=d.d||d.cfg?.d||32;
    const nodes=[],edges=[],groups=[],attn=attention(d,s);
    const names=['입력','사영 + 위치','어텐션','FFN','출력'];
    const block=d.nodes?.byBlock?.[s.block];
    const rows=[d.vizSeq,d.nodes?.proj,block?.attn,block?.ffn];
    for(let l=0;l<5;l++){
      const ids=[],count=l===0?D:l===4?1:width;
      const times=l===4?[L-1]:Array.from({length:L},(_,i)=>i);
      for(const t of times){
        // Helical axons: time travels along X; stages occupy distinct 3D nerve bundles.
        const samples=s.detail||t===s.row?count:Math.min(count,6);
        for(let j=0;j<samples;j++){
          const i=Math.floor(j*count/samples),a=TAU*j/samples+t*.19;
          const r=l===4?0:22+Math.sqrt(count)*1.3;
          const n={x:(t-(L-1)/2)*24*s.spread,y:(l-2)*70+Math.cos(a)*r,
            z:Math.sin(a)*r+(l%2?30:-30),l,i,t,
            v:d.trained?value(l===4?d.attnP:rows[l]?.[t]?.[i]):null,
            name:l===0?(d.inputFeatures?.[i]?.name||'피처 #'+i):names[l]+' · #'+i,
            label:names[l],kind:l===0?'input':l===4?'output':'hidden'};
          ids.push(nodes.length);nodes.push(n);
        }
      }
      groups.push({ids,label:names[l],count:count*times.length});
    }
    for(let l=0;l<4;l++){
      const a=groups[l].ids,b=groups[l+1].ids;
      for(let j=0;j<b.length;j++){
        const target=nodes[b[j]],same=a.filter(id=>nodes[id].t===target.t);
        if(same.length) edges.push({a:same[j%same.length],b:b[j],v:null});
      }
    }
    // Only measured attention receives a quantitative edge weight. No invented values.
    if(attn){
      const ids=groups[2].ids, dest=ids.find(id=>nodes[id].t===s.row);
      for(let t=0;t<L;t++){
        const src=ids.find(id=>nodes[id].t===t);
        if(src!=null&&dest!=null&&finite(attn[t])&&attn[t]>0) edges.push({a:src,b:dest,v:attn[t],attention:true});
      }
    }
    return {nodes,edges,groups,attn};
  }
  let active=null;
  function mount(host,config){
    if(active) active.destroy();
    if(!host) return;
    const seq=config.kind==='seq',d=config.data||{},layers=config.layers||[];
    if(!seq&&!layers.length){host.textContent='구조 데이터 없음';return;}
    const L=d.L||d.cfg?.L||16;
    const reduced=matchMedia('(prefers-reduced-motion: reduce)');
    const s={block:Math.max(0,(d.layers||d.cfg?.layers||1)-1),head:-1,row:L-1,
      detail:false,spread:1,yaw:-.35,pitch:.3,zoom:1,panX:0,panY:0,spin:seq&&!reduced.matches,motion:!reduced.matches};
    let scene,points=[],selected=-1,raf=0,last=0,visible=true,dead=false,dirty=true,phase=0,w=1,h=1,draws=0,totalMs=0;
    const cache=document.createElement('canvas');let cached=false;
    host.innerHTML='<section class="nerve-room"><header class="nerve-heading"><div><span class="nerve-kicker">'+(seq?'TEMPORAL NEURAL VOLUME':'NEURAL SIGNAL FIELD')+'</span><h3>'+(seq?'시간을 연결하는 신경망':'신호가 모이고, 판단이 되는 과정')+'</h3></div><span class="nerve-status">'+(seq?'3D':'2D')+' / STRUCTURE</span></header><div class="nerve-controls"></div><div class="nerve-viewport"><canvas tabindex="0" role="img" aria-label="신경망 구조. 아래 층과 노드 선택으로 값을 확인할 수 있습니다."></canvas><div class="nerve-corner">'+(seq?'DRAG TO ORBIT':'INPUT → HIDDEN → OUTPUT')+'</div></div><div class="nerve-layers"></div><div class="nerve-inspector"><label>층 <select class="nerve-layer"></select></label><label>노드 <select class="nerve-node"></select></label><output aria-live="polite">노드를 선택하면 저장된 값을 확인합니다.</output></div><footer class="nerve-note">움직임은 신호 흐름의 연출입니다. 실시간 활성값이 아닙니다. 연결선은 구조를 간추려 표시합니다.</footer></section>';
    const room=host.firstElementChild,viewport=room.querySelector('.nerve-viewport'),canvas=room.querySelector('canvas'),ctx=canvas.getContext('2d');
    const controls=room.querySelector('.nerve-controls'),info=room.querySelector('output'),layerSelect=room.querySelector('.nerve-layer'),nodeSelect=room.querySelector('.nerve-node');
    function button(text,fn,pressed){const b=document.createElement('button');b.type='button';b.textContent=text;controls.append(b);if(pressed!=null)b.setAttribute('aria-pressed',pressed);b.onclick=()=>{fn(b);dirty=true;wake();};return b;}
    function select(label,count,start,fn,all){const wrap=document.createElement('label');wrap.textContent=label+' ';const el=document.createElement('select');if(all)el.add(new Option('전체 평균','-1'));for(let i=0;i<count;i++)el.add(new Option(String(i+1),String(i)));el.value=String(start);wrap.append(el);controls.append(wrap);el.onchange=()=>{fn(+el.value);rebuild();};return el;}
    if(seq){
      select('블록',d.layers||d.cfg?.layers||1,s.block,v=>s.block=v);
      select('헤드',d.heads||d.cfg?.heads||2,-1,v=>s.head=v,true);
      select('시점',L,s.row,v=>s.row=v);
      button('전체 노드',b=>{s.detail=!s.detail;if(s.detail){s.spin=false;spin?.setAttribute('aria-pressed','false');}b.setAttribute('aria-pressed',s.detail);rebuild();},false);
      button('시점 펼침',b=>{s.spread=s.spread===1?1.8:1;b.setAttribute('aria-pressed',s.spread>1);rebuild();},false);
    }
    const motion=button('신호 움직임',b=>{s.motion=!s.motion;b.setAttribute('aria-pressed',s.motion);},s.motion);
    const spin=seq?button('자동회전',b=>{s.spin=!s.spin;b.setAttribute('aria-pressed',s.spin);},s.spin):null;
    button('−',()=>s.zoom=clamp(s.zoom/1.25,.6,8)).setAttribute('aria-label','축소');
    button('+',()=>s.zoom=clamp(s.zoom*1.25,.6,8)).setAttribute('aria-label','확대');
    button('화면 맞춤',()=>{s.zoom=1;s.panX=s.panY=0;s.yaw=-.35;s.pitch=.3;});
    function populate(){
      nodeSelect.replaceChildren();const group=scene.groups[+layerSelect.value];if(!group)return;
      group.ids.forEach(id=>{const n=scene.nodes[id];nodeSelect.add(new Option((seq?'t'+n.t+' · ':'')+n.name,String(id)));});
    }
    function inspect(id){
      selected=id;const n=scene.nodes[id];if(!n)return;
      layerSelect.value=String(n.l);populate();nodeSelect.value=String(id);
      const role=seq?(n.l===0?d.inputFeatures?.[n.i]?.role:d.nodeRoles?.[n.i]?.top?.map(t=>t.name+' '+t.w).join(', ')):config.roles?.[n.name]?.role;
      let detail='';
      if(seq){
        const heads=d.attnByBlock?.[s.block],chosen=s.head<0?heads:[heads?.[s.head]];
        const incoming=(chosen||[]).flatMap(head=>(head||[]).map(row=>row?.[n.t])).filter(finite);
        const out=d.nodeRoles?.[n.i]?.out;
        detail=(scene.attn?.[n.t]!=null?' · 보는 비중 '+(scene.attn[n.t]*100).toFixed(1)+'%':'')
          +(incoming.length?' · 받는 주목(열 평균) '+(incoming.reduce((a,b)=>a+b,0)/incoming.length*100).toFixed(1)+'%':'')
          +(n.l>0&&n.l<4&&finite(out)?' · 출력 몫 '+(out*100).toFixed(1)+'%':'');
      }
      info.textContent=n.name+(seq?' · t'+n.t:'')+' — '+(n.v==null?'관측값 없음':(seq?'표본값 ':'가중치 강도 ')+n.v)+(role?' · '+role:'')+detail;
      dirty=true;wake();
    }
    layerSelect.onchange=()=>{populate();inspect(+nodeSelect.value);};nodeSelect.onchange=()=>inspect(+nodeSelect.value);
    function rebuild(){
      scene=seq?sequence(d,s):dense(layers);selected=-1;
      layerSelect.replaceChildren();room.querySelector('.nerve-layers').replaceChildren();
      scene.groups.forEach((g,i)=>{layerSelect.add(new Option(g.label,String(i)));const b=document.createElement('button');b.type='button';b.textContent=g.label+' / '+g.count;b.onclick=()=>inspect(g.ids[0]);room.querySelector('.nerve-layers').append(b);});
      populate();info.textContent=seq?(scene.attn?'선택 시점의 실제 표본 어텐션을 표시합니다.':'어텐션 표본 없음 · 구조만 표시합니다.'):'모든 뉴런을 표시합니다. 선은 연결 구조의 요약이며 개별 가중치가 아닙니다.';
      dirty=true;wake();
    }
    function signals(){
      if(!s.motion)return;
      const edges=scene.edges,step=Math.max(1,Math.ceil(edges.length/100));
      ctx.fillStyle='rgba(255,255,255,.85)';ctx.beginPath();
      for(let i=0;i<edges.length;i+=step){
        const e=edges[i],a=points[e.a],b=points[e.b],t=(phase*.3+i*.618)%1,u=1-t;
        const bend=seq?0:Math.min(30,Math.abs(b.x-a.x)*.2);
        const x=u*u*u*a.x+3*u*t*(a.x+b.x)/2+t*t*t*b.x;
        const y=u*u*u*a.y+3*u*u*t*(a.y-bend)+3*u*t*t*(b.y+bend)+t*t*t*b.y;
        ctx.moveTo(x+1.6,y);ctx.arc(x,y,1.6,0,TAU);
      }ctx.fill();
    }
    function record(started){draws++;totalMs+=performance.now()-started;canvas.dataset.nodes=scene.nodes.length;canvas.dataset.edges=scene.edges.length;canvas.dataset.draws=draws;canvas.dataset.averageMs=(totalMs/draws).toFixed(2);canvas.dataset.zoom=s.zoom.toFixed(2);dirty=false;}
    function draw(now){
      const started=performance.now();ctx.clearRect(0,0,w,h);
      // Dense geometry is rasterized only on interaction/resize, not on every signal frame.
      if(!seq&&cached&&!dirty){ctx.drawImage(cache,0,0,w,h);signals();record(started);return;}
      const camera={yaw:s.yaw+(s.spin?Math.sin(phase*.16)*.18:0),pitch:s.pitch};
      const narrow=!seq&&w<600;
      const raw=scene.nodes.map(n=>{
        if(seq)return project(n,camera);
        if(narrow){const row=Math.floor(n.l/3),col=row%2?2-n.l%3:n.l%3;
          return {x:(col-1)*150+(n.x-(n.l-(scene.groups.length-1)/2)*100)*1.3,
            y:(row-(Math.ceil(scene.groups.length/3)-1)/2)*135+n.y*.45,z:0,k:1};}
        return {x:n.x,y:n.y,z:0,k:1};
      });
      let xmin=Infinity,xmax=-Infinity,ymin=Infinity,ymax=-Infinity;
      for(const p of raw){xmin=Math.min(xmin,p.x);xmax=Math.max(xmax,p.x);ymin=Math.min(ymin,p.y);ymax=Math.max(ymax,p.y);}
      const fit=Math.min((w-48)/Math.max(1,xmax-xmin),(h-65)/Math.max(1,ymax-ymin));
      const scale=Math.max(.01,fit)*s.zoom,cx=(xmin+xmax)/2,cy=(ymin+ymax)/2;
      points=raw.map(p=>({x:(p.x-cx)*scale+w/2+s.panX,y:(p.y-cy)*scale+h/2+s.panY,z:p.z,k:p.k}));
      ctx.strokeStyle='rgba(255,255,255,.055)';ctx.lineWidth=1;
      ctx.beginPath();for(let x=24;x<w;x+=48){ctx.moveTo(x,20);ctx.lineTo(x,h-20);}for(let y=24;y<h;y+=48){ctx.moveTo(20,y);ctx.lineTo(w-20,y);}ctx.stroke();
      const edges=scene.edges;
      for(let i=0;i<edges.length;i++){
        const e=edges[i],a=points[e.a],b=points[e.b],focus=selected===e.a||selected===e.b;
        ctx.strokeStyle=focus?'rgba(255,255,255,.85)':e.attention?'rgba(255,255,255,'+(.2+.7*e.v)+')':'rgba(255,255,255,.10)';
        ctx.lineWidth=e.attention?1+e.v*3:focus?1:.5;
        ctx.beginPath();ctx.moveTo(a.x,a.y);const bend=seq?0:Math.min(30,Math.abs(b.x-a.x)*.2);
        ctx.bezierCurveTo((a.x+b.x)/2,a.y-bend,(a.x+b.x)/2,b.y+bend,b.x,b.y);ctx.stroke();
      }
      const order=points.map((p,i)=>i).sort((a,b)=>points[b].z-points[a].z);
      for(const i of order){const p=points[i],n=scene.nodes[i],v=n.v==null?.15:clamp(Math.abs(n.v),0,1),sel=i===selected;
        const r=sel?5:clamp((seq?2.2:narrow?.55:1.4)*Math.sqrt(s.zoom)*p.k,narrow?.45:1,4);
        const pulse=seq&&s.motion?.08*Math.sin(phase*2-n.l*.7+i*.09):0;
        ctx.fillStyle='rgba(255,255,255,'+clamp(.35+v*.6+pulse,.2,1)+')';ctx.beginPath();ctx.arc(p.x,p.y,r,0,TAU);ctx.fill();
        if(sel||v>.8&&i%8===0){ctx.strokeStyle=sel?'#fff':'rgba(255,255,255,.15)';ctx.beginPath();ctx.arc(p.x,p.y,r+3,0,TAU);ctx.stroke();}
      }
      ctx.font='10px monospace';ctx.fillStyle='#bcbcbc';ctx.textAlign='center';
      scene.groups.forEach(g=>{if(!g.ids.length)return;const gp=g.ids.map(id=>points[id]);const x=gp.reduce((sum,p)=>sum+p.x,0)/gp.length;const y=Math.max(14,Math.min(...gp.map(p=>p.y))-10);ctx.fillText(g.label,x,y);});
      if(seq){const g=scene.groups[0];for(let t=0;t<L;t+=Math.max(1,Math.ceil(L/5))){const id=g.ids.find(id=>scene.nodes[id].t===t);if(id!=null){const p=points[id];ctx.fillText('t'+t,p.x,Math.min(h-26,p.y+40));}}}
      if(!seq){cache.width=canvas.width;cache.height=canvas.height;cache.getContext('2d').drawImage(canvas,0,0);cached=true;}
      signals();record(started);
    }
    function tick(now){raf=0;if(dead)return;if(!host.isConnected){destroy();return;}if(!visible||document.hidden)return;
      if(now-last>=1000/30){phase+=Math.min(.1,(now-last)/1000);last=now;if(dirty||s.motion||s.spin)draw(now);}
      if(dirty||s.motion||s.spin)raf=requestAnimationFrame(tick);
    }
    function wake(){if(!dead&&!raf&&visible&&!document.hidden)raf=requestAnimationFrame(tick);}
    const resize=new ResizeObserver(()=>{const r=viewport.getBoundingClientRect();w=Math.max(1,r.width);h=Math.max(1,r.height);const ratio=Math.min(devicePixelRatio||1,1.5);canvas.width=Math.round(w*ratio);canvas.height=Math.round(h*ratio);ctx.setTransform(ratio,0,0,ratio,0,0);dirty=true;wake();});
    const intersection=new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;if(!visible&&raf){cancelAnimationFrame(raf);raf=0;}wake();});
    const visibility=()=>{if(document.hidden&&raf){cancelAnimationFrame(raf);raf=0;}else wake();};
    const reduce=()=>{if(reduced.matches){s.motion=s.spin=false;motion.setAttribute('aria-pressed','false');spin?.setAttribute('aria-pressed','false');}dirty=true;wake();};
    const pointers=new Map();let moved=false;
    canvas.onpointerdown=e=>{canvas.setPointerCapture(e.pointerId);pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});moved=false;s.spin=false;spin?.setAttribute('aria-pressed','false');};
    canvas.onpointermove=e=>{const old=pointers.get(e.pointerId);if(!old)return;const dx=e.clientX-old.x,dy=e.clientY-old.y;const other=[...pointers.entries()].find(([id])=>id!==e.pointerId)?.[1];
      if(other){const before=Math.hypot(old.x-other.x,old.y-other.y),after=Math.hypot(e.clientX-other.x,e.clientY-other.y);if(before>4)s.zoom=clamp(s.zoom*after/before,.6,8);s.panX+=dx/2;s.panY+=dy/2;}
      else if(seq&&!e.shiftKey){s.yaw-=dx*.006;s.pitch=clamp(s.pitch+dy*.006,-1.2,1.2);}else{s.panX+=dx;s.panY+=dy;}
      if(Math.abs(dx)+Math.abs(dy)>2)moved=true;pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});dirty=true;wake();};
    canvas.onpointerup=e=>{pointers.delete(e.pointerId);if(moved)return;const r=canvas.getBoundingClientRect();let hit=-1,best=225;points.forEach((p,i)=>{const dist=(p.x-e.clientX+r.left)**2+(p.y-e.clientY+r.top)**2;if(dist<best){best=dist;hit=i;}});if(hit>=0)inspect(hit);};
    canvas.onpointercancel=e=>pointers.delete(e.pointerId);
    canvas.onwheel=e=>{if(!e.ctrlKey)return;e.preventDefault();s.zoom=clamp(s.zoom*Math.exp(-e.deltaY*.002),.6,8);dirty=true;wake();};
    canvas.onkeydown=e=>{if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','-','Home'].includes(e.key)){e.preventDefault();if(e.key==='Home'){s.zoom=1;s.panX=s.panY=0;}else if(e.key==='+'||e.key==='-')s.zoom=clamp(s.zoom*(e.key==='+'?1.2:1/1.2),.6,8);else if(seq){s.yaw+=e.key==='ArrowLeft'?-.1:e.key==='ArrowRight'?.1:0;s.pitch=clamp(s.pitch+(e.key==='ArrowUp'?-.1:e.key==='ArrowDown'?.1:0),-1.2,1.2);}else{s.panX+=e.key==='ArrowLeft'?-20:e.key==='ArrowRight'?20:0;s.panY+=e.key==='ArrowUp'?-20:e.key==='ArrowDown'?20:0;}dirty=true;wake();}};
    function destroy(){dead=true;cancelAnimationFrame(raf);resize.disconnect();intersection.disconnect();document.removeEventListener('visibilitychange',visibility);reduced.removeEventListener('change',reduce);if(active?.destroy===destroy)active=null;}
    active={destroy};resize.observe(viewport);intersection.observe(viewport);document.addEventListener('visibilitychange',visibility);reduced.addEventListener('change',reduce);rebuild();
    return active;
  }
  root.NeuralObservatory={mount,dense,sequence,attention,project};
})(typeof window!=='undefined'?window:globalThis);
