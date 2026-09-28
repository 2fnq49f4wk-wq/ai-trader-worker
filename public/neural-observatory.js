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
  /* [V33.429c] ★옆으로 눕힌 세계수 모양 · 흰색만★ — 모양만 빌린다(신화 그대로가 아니다). 흐름은 왼 → 오:
   *     뿌리(입력 묶음마다 한 가닥) → 줄기(공유 몸통 64 → 32) → 가지(지평 머리 5) → 수관(나무 숲) → 끝눈(최종 확률)
   * [V33.430c] ★선이 겹쳐 보였다(사용자)★ — 뉴런마다 실제 연결 3개씩, 수백 줄을 한꺼번에 그려 줄기에 흰 덩어리가
   *   생겼다. → ★평소엔 다발만★ 그린다(모두 실측의 합):
   *     · 뿌리 가닥   = 그 묶음의 칸들을 잇는 가는 선 하나(구조)
   *     · 뿌리 → 줄기 = 묶음마다 굵은 선 하나(굵기 = 그 묶음 칸들의 나가는 |w| 합)
   *     · 몸통1 → 몸통2 = 리본 하나 · 몸통2 → 가지 = 다섯 줄(굵기 = 그 가지로 들어오는 |w| 합)
   *     · 가지 → 끝눈 = α · 수관 → 끝눈 = 1−α · 뿌리 묶음 → 수관 = gain 비중
   *   뉴런 하나하나의 실제 가중치 선(detail)은 ★그 점을 눌렀을 때만★ 그 점에 닿은 것만 보인다.
   * 밝기·굵기 = 실측값. 값이 없으면 흐리게(v=null) — 지어내지 않는다. */
  const OMNI_GROUPS=[['m_','5분봉'],['s_','세션'],['h_','60분봉'],['d_','일봉'],['a_','형식알파'],
    ['q_','횡단면'],['p_','피어'],['x_','맥락'],['st_','매매법'],['결측:','결측표시']];
  const OMNI_GAIN={'5분봉':'5분봉(단타)','세션':'세션','60분봉':'60분봉','일봉':'일봉(장타)','형식알파':'형식알파',
    '횡단면':'횡단면·피어','피어':'횡단면·피어','맥락':'맥락','매매법':'매매법'};
  const HZ_TXT={'30m':'30분','60m':'60분','1d':'1일','5d':'5일','20d':'20일'};
  function omniScene(d,s){
    const nodes=[],edges=[],groups=[];
    const nv=d.nnViz&&Array.isArray(d.nnViz.layers)?d.nnViz:null;
    const hz=d.horizons||['30m','60m','1d','5d','20d'];
    const alpha=Array.isArray(d.alpha)?d.alpha:hz.map(()=>0);
    const norm=a=>{const m=Math.max(1e-12,...a.filter(finite).map(Math.abs));return a.map(v=>finite(v)?v/m:null);};
    const add=(n,g)=>{g.push(nodes.length);nodes.push(n);return nodes.length-1;};
    const sp=s.spread;
    const X0=-200,X1=200;
    // ── 뿌리: 묶음마다 한 가닥(왼쪽으로 부채꼴). 가닥 안은 가는 선 하나로 잇는다 ──
    const inNames=nv?nv.layers[0].names:(d.feats||[]);
    const inRaw=nv?(nv.layers[0].strength||[]):[];
    const inV=nv?norm(inRaw):inNames.map(()=>null);
    const gOf=nm=>{const g=OMNI_GROUPS.findIndex(([p])=>String(nm).indexOf(p)===0);return g<0?7:g;};
    const byG=OMNI_GROUPS.map(()=>[]);
    inNames.forEach((nm,i)=>byG[gOf(nm)].push(i));
    const live=byG.map((ix,g)=>[ix,g]).filter(([ix])=>ix.length);
    const inId=new Array(inNames.length),gIds={},collar=[],gSum=[];
    live.forEach(([ix,g],r)=>{
      const ph=TAU*r/live.length+.3,ids=[];
      ix.forEach((i,j)=>{
        const u=(j+.5)/ix.length,len=(90+280*u)*sp,rad=(40+170*Math.pow(u,1.2))*sp,tw=ph+.35*u;
        inId[i]=add({x:X0-len,y:Math.sin(tw)*rad,z:Math.cos(tw)*rad,
          l:groups.length,i,v:inV[i],name:inNames[i],label:'뿌리 · '+OMNI_GROUPS[g][1],kind:'input',
          desc:OMNI_GROUPS[g][1]+(inV[i]==null?' · 입력 칸':' · 나가는 연결 세기 '+(inV[i]*100).toFixed(0)+'%(최대 대비)')},ids);
        if(j)edges.push({a:ids[j-1],b:ids[j],v:.5,strand:true});
      });
      // 뿌리 목(가닥이 줄기에 닿는 자리) — 구조 점(값 없음)
      const c=add({x:X0-40*sp,y:Math.sin(ph)*28*sp,z:Math.cos(ph)*28*sp,l:groups.length,i:-1,v:null,
        name:OMNI_GROUPS[g][1]+' 뿌리 목',label:'뿌리 · '+OMNI_GROUPS[g][1],kind:'hidden',desc:'뿌리 가닥이 줄기에 닿는 자리'},ids);
      edges.push({a:ids[0],b:c,v:.5,strand:true});
      collar.push(c);gSum.push(ix.reduce((a,i)=>a+(finite(inRaw[i])?inRaw[i]:0),0));
      gIds[OMNI_GROUPS[g][1]]=ids;
      groups.push({ids,label:OMNI_GROUPS[g][1],count:ix.length,at:ids[ix.length-1]});   // 이름표는 가닥 바깥 끝에
    });
    // ── 줄기: 몸통 층마다 원판 하나(옆에서 보면 기둥) ──
    const layerIds=[inId];
    const trunk=nv?nv.layers.slice(1,-1):[];
    trunk.forEach((ly,k)=>{
      const ids=[],v=norm(ly.strength||[]),n=ly.size||v.length,x=X0+(k+.5)*(X1-X0)/Math.max(1,trunk.length),R=(58-k*14)*sp;
      for(let i=0;i<n;i++){const a=i*2.39996323,r=Math.sqrt((i+.5)/n)*R;
        add({x,y:Math.sin(a)*r,z:Math.cos(a)*r,l:groups.length,i,v:v[i],name:ly.name+' · #'+i,
          label:'줄기 · '+ly.name,kind:'hidden',
          desc:(v[i]==null?'':'나가는 연결 세기 '+(v[i]*100).toFixed(0)+'%(최대 대비) · ')+'모든 지평이 같이 쓴다 · 누르면 실제 연결선'},ids);}
      layerIds.push(ids);groups.push({ids,label:ly.name+' · '+n,count:n});
    });
    // ── 가지: 지평 머리 5 ──
    const hl=nv?nv.layers[nv.layers.length-1]:null,hv=hl?hl.strength||[]:[],bids=[];
    hz.forEach((h,k)=>{const ph=TAU*k/hz.length+Math.PI/5,e=hv[k],R=150*sp;
      add({x:X1+170,y:Math.sin(ph)*R,z:Math.cos(ph)*R,l:groups.length,i:k,
        v:finite(e)?clamp(e/0.05,0,1):null,name:'가지 · '+(HZ_TXT[h]||h)+' 머리',label:'가지',kind:'output',
        desc:nv?(finite(e)?'신경망 단독 홀드아웃 AUC '+(0.5+e).toFixed(3):'홀드아웃 못 쟀다'):'신경망이 아직 없다'},bids);});
    layerIds.push(bids);groups.push({ids:bids,label:'가지 · 지평 머리',count:hz.length});
    // ── 다발(평소 보이는 선) ──
    if(nv&&trunk.length){
      const t1=layerIds[1],t2=layerIds[layerIds.length-2];
      const gN=norm(gSum);
      collar.forEach((c,q)=>edges.push({a:c,b:t1[Math.floor(t1.length/2)],v:gN[q]==null?.2:gN[q],bundle:true}));
      if(trunk.length>1){const st=(nv.layers[1].strength||[]).filter(finite),m=st.length?st.reduce((a,b)=>a+b,0)/st.length:0;
        edges.push({a:t1[0],b:t2[0],v:.8,bundle:true,ribbon:true,raw:m});}
      const into=hz.map(()=>0);
      const last=(nv.edges||[])[(nv.edges||[]).length-1]||[];
      last.forEach(([i,k,v])=>{if(finite(v)&&into[k]!=null)into[k]+=v;});
      const iN=norm(into);
      bids.forEach((b,k)=>edges.push({a:t2[k%t2.length],b,v:iN[k]==null?.2:iN[k],bundle:true}));
      // 뉴런 하나하나의 실제 선 — 누른 점에 닿은 것만 보인다
      (nv.edges||[]).forEach((es,l)=>{const A=layerIds[l],B=layerIds[l+1];if(!A||!B)return;
        es.forEach(([i,k,v])=>{if(A[i]!=null&&B[k]!=null&&finite(v))edges.push({a:A[i],b:B[k],v:clamp(v,0,1),measured:true,detail:true});});});
    }
    // ── 수관: 나무 숲(오른쪽을 향한 반구 껍질) ──
    const seeds=Math.max(1,Math.min(8,d.seeds||1)),per=Math.max(20,Math.min(40,Math.round((d.nTrees||60)/seeds))),fid=[];
    const NL=seeds*per,CX=X1+230,CR=190*sp;
    for(let q=0;q<NL;q++){const ux=-.2+1.2*(q+.5)/NL,rr=Math.sqrt(Math.max(0,1-ux*ux)),az=q*2.39996323,sd=q%seeds;
      add({x:CX+ux*CR*.75,y:Math.sin(az)*rr*CR,z:Math.cos(az)*rr*CR,l:groups.length,i:q,v:null,
        name:'나무 숲 · 시드 '+(sd+1),label:'수관 · 나무 숲',kind:'hidden',
        desc:(d.nTrees||0)+'그루 · 시드 '+seeds+'개 앙상블'+(d.gbdt?' · 구성 '+d.gbdt.name+'('+d.gbdt.why+')':'')+' · 잎은 구조 약식'},fid);}
    groups.push({ids:fid,label:'나무 숲 · '+(d.nTrees||0)+'그루',count:d.nTrees||0});
    const gshare={};(d.groups||[]).forEach(g=>{gshare[g.name]=g.share;});
    const gmax=Math.max(1e-9,...Object.values(gshare).filter(finite));
    Object.keys(gIds).forEach((lbl,q)=>{const sh=gshare[OMNI_GAIN[lbl]],ids=gIds[lbl];
      if(!finite(sh)||!ids.length)return;
      edges.push({a:ids[ids.length-1],b:fid[(q*7)%fid.length],v:clamp(sh/gmax,0,1),measured:true,detail:true});});
    // ── 끝눈: 지평별 최종 확률 ──
    const heads=d.heads||[],aid=[];
    hz.forEach((h,k)=>{const hd=heads.find(x=>x&&x.hz===h)||{},a=finite(alpha[k])?alpha[k]:0,ph=TAU*k/hz.length+Math.PI/5,R=200*sp;
      const id=add({x:X1+470,y:Math.sin(ph)*R,z:Math.cos(ph)*R,l:groups.length,i:k,
        v:finite(hd.auc)?clamp((hd.auc-0.5)/0.05,0,1):null,name:'최종 확률 · '+(HZ_TXT[h]||h),label:'최종 확률',kind:'output',
        desc:'(1−α)·나무 숲 + α·가지 · α '+a.toFixed(1)+' · 홀드아웃 AUC '+(finite(hd.auc)?hd.auc.toFixed(3):'—')+(hd.ok?' · 발언 문턱 통과':' · 보류')},aid);
      edges.push({a:fid[(k*per+Math.floor(per/2))%fid.length],b:id,v:clamp(1-a,0,1),measured:true,bundle:true});
      if(a>0)edges.push({a:bids[k],b:id,v:clamp(a,0,1),measured:true,bundle:true});});
    groups.push({ids:aid,label:'최종 확률',count:hz.length});
    return {nodes,edges,groups};
  }
  let active=null;
  function mount(host,config){
    if(active) active.destroy();
    if(!host) return;
    const seq=config.kind==='seq',om=config.kind==='omni',vol=seq||om,d=config.data||{},layers=config.layers||[];
    if(!vol&&!layers.length){host.textContent='구조 데이터 없음';return;}
    const L=d.L||d.cfg?.L||16;
    const reduced=matchMedia('(prefers-reduced-motion: reduce)');
    const s={block:Math.max(0,(d.layers||d.cfg?.layers||1)-1),head:-1,row:L-1,
      detail:false,spread:1,yaw:config.kind==='omni'?-.25:-.35,pitch:config.kind==='omni'?.35:.3,zoom:1,panX:0,panY:0,spin:vol&&!reduced.matches,motion:!reduced.matches};
    let scene,points=[],selected=-1,raf=0,last=0,visible=true,dead=false,dirty=true,phase=0,w=1,h=1,draws=0,totalMs=0;
    const cache=document.createElement('canvas');let cached=false;
    host.innerHTML='<section class="nerve-room"><header class="nerve-heading"><div><span class="nerve-kicker">'+(seq?'TEMPORAL NEURAL VOLUME':om?'TREE-SHAPED NEURAL VOLUME':'NEURAL SIGNAL FIELD')+'</span><h3>'+(seq?'시간을 연결하는 신경망':om?'뿌리(입력) → 줄기(공유 몸통) → 가지(지평 머리) — 나무 숲과 섞여 최종 확률':'신호가 모이고, 판단이 되는 과정')+'</h3></div><span class="nerve-status">'+(vol?'3D':'2D')+' / STRUCTURE</span></header><div class="nerve-controls"></div><div class="nerve-viewport"><canvas tabindex="0" role="img" aria-label="신경망 구조. 아래 층과 노드 선택으로 값을 확인할 수 있습니다."></canvas><div class="nerve-corner">'+(vol?'DRAG TO ORBIT':'INPUT → HIDDEN → OUTPUT')+'</div></div><div class="nerve-layers"></div><div class="nerve-inspector"><label>층 <select class="nerve-layer"></select></label><label>노드 <select class="nerve-node"></select></label><output aria-live="polite">노드를 선택하면 저장된 값을 확인합니다.</output></div><footer class="nerve-note">움직임은 신호 흐름의 연출입니다. 실시간 활성값이 아닙니다. 연결선은 구조를 간추려 표시합니다.</footer></section>';
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
    if(om) button('가지 펼침',b=>{s.spread=s.spread===1?1.7:1;b.setAttribute('aria-pressed',s.spread>1);rebuild();},false);
    const spin=vol?button('자동회전',b=>{s.spin=!s.spin;b.setAttribute('aria-pressed',s.spin);},s.spin):null;
    button('−',()=>s.zoom=clamp(s.zoom/1.25,.6,8)).setAttribute('aria-label','축소');
    button('+',()=>s.zoom=clamp(s.zoom*1.25,.6,8)).setAttribute('aria-label','확대');
    button('화면 맞춤',()=>{s.zoom=1;s.panX=s.panY=0;s.yaw=om?-.25:-.35;s.pitch=om?.35:.3;});
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
      info.textContent=om?(n.name+' — '+(n.desc||'관측값 없음')):(n.name+(seq?' · t'+n.t:'')+' — '+(n.v==null?'관측값 없음':(seq?'표본값 ':'가중치 강도 ')+n.v)+(role?' · '+role:'')+detail);
      dirty=true;wake();
    }
    layerSelect.onchange=()=>{populate();inspect(+nodeSelect.value);};nodeSelect.onchange=()=>inspect(+nodeSelect.value);
    function rebuild(){
      scene=seq?sequence(d,s):om?omniScene(d,s):dense(layers);selected=-1;
      layerSelect.replaceChildren();room.querySelector('.nerve-layers').replaceChildren();
      scene.groups.forEach((g,i)=>{layerSelect.add(new Option(g.label,String(i)));const b=document.createElement('button');b.type='button';b.textContent=g.label+' / '+g.count;b.onclick=()=>inspect(g.ids[0]);room.querySelector('.nerve-layers').append(b);});
      populate();info.textContent=seq?(scene.attn?'선택 시점의 실제 표본 어텐션을 표시합니다.':'어텐션 표본 없음 · 구조만 표시합니다.'):om?(d.nnViz?'모든 뉴런을 표시합니다. 굵은 선은 묶음별 실제 가중치의 합입니다. 점을 누르면 그 뉴런의 실제 연결선만 보입니다.':'신경망이 아직 안 올라왔습니다 — 나무 숲 구조만 표시합니다.'):'모든 뉴런을 표시합니다. 선은 연결 구조의 요약이며 개별 가중치가 아닙니다.';
      dirty=true;wake();
    }
    function signals(){
      if(!s.motion)return;
      const edges=scene.edges.filter(e=>!e.detail&&!e.strand),step=Math.max(1,Math.ceil(edges.length/100));
      ctx.fillStyle='rgba(255,255,255,.85)';ctx.beginPath();
      for(let i=0;i<edges.length;i+=step){
        const e=edges[i],a=points[e.a],b=points[e.b],t=(phase*.3+i*.618)%1,u=1-t;
        const bend=vol?0:Math.min(30,Math.abs(b.x-a.x)*.2);
        const x=u*u*u*a.x+3*u*t*(a.x+b.x)/2+t*t*t*b.x;
        const y=u*u*u*a.y+3*u*u*t*(a.y-bend)+3*u*t*t*(b.y+bend)+t*t*t*b.y;
        ctx.moveTo(x+1.6,y);ctx.arc(x,y,1.6,0,TAU);
      }ctx.fill();
    }
    function record(started){draws++;totalMs+=performance.now()-started;canvas.dataset.nodes=scene.nodes.length;canvas.dataset.edges=scene.edges.length;canvas.dataset.draws=draws;canvas.dataset.averageMs=(totalMs/draws).toFixed(2);canvas.dataset.zoom=s.zoom.toFixed(2);dirty=false;}
    function draw(now){
      const started=performance.now();ctx.clearRect(0,0,w,h);
      // Dense geometry is rasterized only on interaction/resize, not on every signal frame.
      if(!vol&&cached&&!dirty){ctx.drawImage(cache,0,0,w,h);signals();record(started);return;}
      const camera={yaw:s.yaw+(s.spin?Math.sin(phase*.16)*.18:0),pitch:s.pitch};
      const narrow=!vol&&w<600;
      const raw=scene.nodes.map(n=>{
        if(vol)return project(n,camera);
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
        if(e.detail&&!focus)continue;               // [V33.430c] 개별 가중치 선은 누른 점에 닿은 것만
        ctx.strokeStyle=focus?'rgba(255,255,255,.85)':e.attention?'rgba(255,255,255,'+(.2+.7*e.v)+')':
          e.strand?'rgba(255,255,255,.22)':e.bundle?'rgba(255,255,255,'+(.18+.5*e.v)+')':
          e.measured?'rgba(255,255,255,'+(.04+.5*e.v)+')':'rgba(255,255,255,.10)';
        ctx.lineWidth=e.attention?1+e.v*3:e.ribbon?14:e.bundle?1+e.v*6:e.strand?.8:e.measured?.4+e.v*1.6:focus?1:.5;
        ctx.beginPath();ctx.moveTo(a.x,a.y);const bend=vol?0:Math.min(30,Math.abs(b.x-a.x)*.2);
        ctx.bezierCurveTo((a.x+b.x)/2,a.y-bend,(a.x+b.x)/2,b.y+bend,b.x,b.y);ctx.stroke();
      }
      const order=points.map((p,i)=>i).sort((a,b)=>points[b].z-points[a].z);
      for(const i of order){const p=points[i],n=scene.nodes[i],v=n.v==null?.15:clamp(Math.abs(n.v),0,1),sel=i===selected;
        const r=sel?5:clamp((seq?2.2:om?(n.kind==='output'?4.2:1.9):narrow?.55:1.4)*Math.sqrt(s.zoom)*p.k,narrow?.45:1,om&&n.kind==='output'?7:4);
        const pulse=vol&&s.motion?.08*Math.sin(phase*2-n.l*.7+i*.09):0;
        ctx.fillStyle='rgba(255,255,255,'+clamp(.35+v*.6+pulse,.2,1)+')';ctx.beginPath();ctx.arc(p.x,p.y,r,0,TAU);ctx.fill();
        if(sel||v>.8&&i%8===0){ctx.strokeStyle=sel?'#fff':'rgba(255,255,255,.15)';ctx.beginPath();ctx.arc(p.x,p.y,r+3,0,TAU);ctx.stroke();}
      }
      ctx.font='10px monospace';ctx.fillStyle='#bcbcbc';ctx.textAlign='center';
      // [V33.430c] 좁은 화면에서는 나무 그림의 이름표를 그리지 않는다(겹치고 잘린다) — 같은 이름이 아래 버튼에 있다
      if(!(om&&w<600))scene.groups.forEach(g=>{if(!g.ids.length)return;
        if(g.at!=null&&points[g.at]){const p=points[g.at];ctx.textAlign='right';ctx.fillText(g.label,p.x-8,p.y+3);ctx.textAlign='center';return;}
        const gp=g.ids.map(id=>points[id]);const x=gp.reduce((sum,p)=>sum+p.x,0)/gp.length;const y=Math.max(14,Math.min(...gp.map(p=>p.y))-10);ctx.fillText(g.label,x,y);});
      if(seq){const g=scene.groups[0];for(let t=0;t<L;t+=Math.max(1,Math.ceil(L/5))){const id=g.ids.find(id=>scene.nodes[id].t===t);if(id!=null){const p=points[id];ctx.fillText('t'+t,p.x,Math.min(h-26,p.y+40));}}}
      if(!vol){cache.width=canvas.width;cache.height=canvas.height;cache.getContext('2d').drawImage(canvas,0,0);cached=true;}
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
      else if(vol&&!e.shiftKey){s.yaw-=dx*.006;s.pitch=clamp(s.pitch+dy*.006,-1.2,1.2);}else{s.panX+=dx;s.panY+=dy;}
      if(Math.abs(dx)+Math.abs(dy)>2)moved=true;pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});dirty=true;wake();};
    canvas.onpointerup=e=>{pointers.delete(e.pointerId);if(moved)return;const r=canvas.getBoundingClientRect();let hit=-1,best=225;points.forEach((p,i)=>{const dist=(p.x-e.clientX+r.left)**2+(p.y-e.clientY+r.top)**2;if(dist<best){best=dist;hit=i;}});if(hit>=0)inspect(hit);};
    canvas.onpointercancel=e=>pointers.delete(e.pointerId);
    canvas.onwheel=e=>{if(!e.ctrlKey)return;e.preventDefault();s.zoom=clamp(s.zoom*Math.exp(-e.deltaY*.002),.6,8);dirty=true;wake();};
    canvas.onkeydown=e=>{if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','-','Home'].includes(e.key)){e.preventDefault();if(e.key==='Home'){s.zoom=1;s.panX=s.panY=0;}else if(e.key==='+'||e.key==='-')s.zoom=clamp(s.zoom*(e.key==='+'?1.2:1/1.2),.6,8);else if(vol){s.yaw+=e.key==='ArrowLeft'?-.1:e.key==='ArrowRight'?.1:0;s.pitch=clamp(s.pitch+(e.key==='ArrowUp'?-.1:e.key==='ArrowDown'?.1:0),-1.2,1.2);}else{s.panX+=e.key==='ArrowLeft'?-20:e.key==='ArrowRight'?20:0;s.panY+=e.key==='ArrowUp'?-20:e.key==='ArrowDown'?20:0;}dirty=true;wake();}};
    function destroy(){dead=true;cancelAnimationFrame(raf);resize.disconnect();intersection.disconnect();document.removeEventListener('visibilitychange',visibility);reduced.removeEventListener('change',reduce);if(active?.destroy===destroy)active=null;}
    active={destroy};resize.observe(viewport);intersection.observe(viewport);document.addEventListener('visibilitychange',visibility);reduced.addEventListener('change',reduce);rebuild();
    return active;
  }
  root.NeuralObservatory={mount,dense,sequence,attention,project,omniScene};
})(typeof window!=='undefined'?window:globalThis);
