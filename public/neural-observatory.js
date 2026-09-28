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
  /* [V33.433] ★홀로그램 구체 신경망 핵★ — 사용자: "옴니 디자인 버리고 영화 속 AI 비서처럼 3D 로".
   *   (영화 이름·로고는 쓰지 않는다 — 빛나는 금빛 고리 구체라는 ★형태★ 만 빌린다.)
   * [V33.436] 사용자가 보낸 참고 그림처럼: ★여러 방향으로 기운 금빛 고리가 겹쳐 구를 이루고★, 빛이 겹치면 더 밝고(가산 합성),
   *   가운데는 홍채 같은 핵, 둘레엔 따로 도는 자이로 고리 · 빛줄기 · 불꽃.
   *   ① 입력 = ★묶음마다 기운 대원(大圓) 고리 하나★ — 그 묶음의 칸들이 고리 위 밝은 호 구간으로 줄지어 선다.
   *   ② 몸통 뉴런 = 가장 센 입력 바로 안쪽(V33.435 바큇살) · ③ 선 = 구면을 따라 휘는 호 · 평소엔 뉴런마다 가장 센 한 줄.
   *   ④ 장식(자이로 고리 · 홍채 고리 · 빛줄기 · 불꽃 · 고리 조각)은 ★값이 없다★ — 밝기는 연출이고 숫자를 말하지 않는다.
   * 밝기 = 실측값(입력 = 나가는 |w| 합 · 몸통 = 대표 네트 세기 · 선 = |w| · 핵 = 신경망 홀드아웃 AUC ·
   *   위성 = 섞은 홀드아웃 AUC · 위성 선 = α / 1−α). 값이 없으면 흐리게 — 지어내지 않는다. */
  const OMNI_GROUPS=[['m_','5분봉'],['s_','세션'],['h_','60분봉'],['d_','일봉'],['a_','형식알파'],
    ['q_','횡단면'],['p_','피어'],['x_','맥락'],['st_','매매법'],['결측:','결측표시']];
  const OMNI_GAIN={'5분봉':'5분봉(단타)','세션':'세션','60분봉':'60분봉','일봉':'일봉(장타)','형식알파':'형식알파',
    '횡단면':'횡단면·피어','피어':'횡단면·피어','맥락':'맥락','매매법':'매매법'};
  const HZ_TXT={'30m':'30분','60m':'60분','1d':'1일','5d':'5일','20d':'20일'};
  const CORE='255,184,92', HUD='255,214,150', CORE_HI='255,236,196';
  function omniScene(d,s){
    const nodes=[],edges=[],groups=[];
    const nv=d.nnViz&&Array.isArray(d.nnViz.layers)?d.nnViz:null;
    const hz=d.horizons||['30m','60m','1d','5d','20d'];
    const alpha=Array.isArray(d.alpha)?d.alpha:hz.map(()=>0);
    const norm=a=>{const m=Math.max(1e-12,...a.filter(finite).map(Math.abs));return a.map(v=>finite(v)?v/m:null);};
    const add=(n,g)=>{g.push(nodes.length);nodes.push(n);return nodes.length-1;};
    const sp=s.spread,R3=300*sp,R2=232*sp,R1=168*sp,R0=40*sp;
    const unit=(x,y,z)=>{const l=Math.hypot(x,y,z)||1;return [x/l,y/l,z/l];};
    const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
    const sph=(lon,lat)=>[Math.cos(lat)*Math.cos(lon),Math.sin(lat),Math.cos(lat)*Math.sin(lon)];
    const basis=(n)=>{const t=Math.abs(n[1])<.9?[0,1,0]:[1,0,0],e1=unit(...cross(n,t));return [e1,cross(n,e1)];};
    const onRing=(n,t)=>{const [e1,e2]=basis(n);return unit(e1[0]*Math.cos(t)+e2[0]*Math.sin(t),e1[1]*Math.cos(t)+e2[1]*Math.sin(t),e1[2]*Math.cos(t)+e2[2]*Math.sin(t));};
    let seed=7;const rnd=()=>{seed=(seed*16807)%2147483647;return (seed-1)/2147483646;};   // 장식 배치 고정(매번 같은 그림)
    const via=(p,o)=>{nodes.push(Object.assign({x:p[0],y:p[1],z:p[2],hidden:true,l:-1,i:-1,v:null,name:'',label:'',kind:'via'},o||{}));return nodes.length-1;};
    const dir=[],rad=[];
    const guide=(a,b,tone,o)=>edges.push(Object.assign({a,b,v:.3,guide:true,straight:true,tone},o||{}));
    // 고리(구조 표시 · 값 없음): 조각난 금빛 호. rot 이 있으면 제 축으로 돈다(연출).
    const ring=(n,R,m,tone,keep,rot)=>{const ids=[];for(let q=0;q<m;q++){const u=onRing(n,TAU*q/m);ids.push(via([u[0]*R,u[1]*R,u[2]*R],rot?{rot}:null));}
      for(let q=0;q<m;q++)if(rnd()<keep)guide(ids[q],ids[(q+1)%m],tone);return ids;};
    // ── ① 입력: 묶음마다 기운 대원 고리 하나 ──
    const inNames=nv?nv.layers[0].names:(d.feats||[]);
    const inRaw=nv?(nv.layers[0].strength||[]):[];
    const inV=nv?norm(inRaw):inNames.map(()=>null);
    const gOf=nm=>{const g=OMNI_GROUPS.findIndex(([p])=>String(nm).indexOf(p)===0);return g<0?7:g;};
    const gIds={},members={};
    inNames.forEach((nm,i)=>{(members[gOf(nm)]=members[gOf(nm)]||[]).push(i);});
    const gKeys=Object.keys(members).map(Number).sort((a,b)=>a-b),G=gKeys.length,inId=new Array(inNames.length);
    const STEP=.085;                                   // 고리 위 칸 간격(라디안)
    gKeys.forEach((g,q)=>{const ms=members[g],m=ms.length;
      // 고리 기울기: 반구 위 피보나치 — 고리들이 서로 다른 방향으로 겹쳐 구를 이룬다
      const yy=1-(q+.5)/G,rr=Math.sqrt(Math.max(0,1-yy*yy)),tt=q*2.39996323,nrm=unit(Math.cos(tt)*rr,yy,Math.sin(tt)*rr);
      const span=Math.min(TAU*.92,m*STEP),t0=rnd()*TAU;
      ms.forEach((i,j)=>{const u=onRing(nrm,t0+(m>1?span*j/(m-1):0)-span/2);
        const id=add({x:u[0]*R3,y:u[1]*R3,z:u[2]*R3,l:0,i,v:inV[i],name:inNames[i],label:'입력 · '+OMNI_GROUPS[g][1],kind:'input',rgb:CORE,
          desc:OMNI_GROUPS[g][1]+' 고리'+(inV[i]==null?' · 입력 칸':' · 나가는 연결 세기 '+(inV[i]*100).toFixed(0)+'%(최대 대비)')},(gIds[g]=gIds[g]||[]));
        inId[i]=id;dir[id]=u;rad[id]=R3;});
      // 그 묶음의 칸들을 잇는 밝은 호(구조 표시) + 고리의 나머지는 흐린 조각
      const ids=gIds[g];for(let j=0;j+1<ids.length;j++)guide(ids[j],ids[j+1],'data');
      ring(nrm,R3,96,'ring',.6);ring(nrm,R3*1.018,96,'ring',.3);   // 겹고리 — 참고 그림의 빽빽한 금빛 결
      const lu=onRing(nrm,t0-span/2-.18),lid=via([lu[0]*R3*1.06,lu[1]*R3*1.06,lu[2]*R3*1.06]);
      nodes[lid].tag=OMNI_GROUPS[g][1];nodes[lid].front=true;});
    gKeys.forEach(g=>{const ids=gIds[g];groups.push({ids,label:OMNI_GROUPS[g][1]+' 고리',count:ids.length,at:ids[Math.floor(ids.length/2)]});});
    groups.forEach((g,q)=>g.ids.forEach(id=>{nodes[id].l=q;}));
    // ── ② 몸통: 가장 센 입력 바로 안쪽(바큇살) ──
    const top1={};
    if(nv)(nv.edges||[]).forEach((es,l)=>{const t={};es.forEach(([i,k,v])=>{if(finite(v)&&(t[k]==null||v>t[k][1]))t[k]=[i,v];});top1[l]=t;});
    const layerIds=[inId];
    const trunk=nv?nv.layers.slice(1,-1):[];
    let prev=inId;
    trunk.forEach((ly,k)=>{
      const ids=[],v=norm(ly.strength||[]),n=ly.size||v.length,R=k?R1:R2,t1=top1[k]||{},used={};
      for(let i=0;i<n;i++){
        let u;const src=t1[i]!=null?prev[t1[i][0]]:null;
        if(src!=null){const du=dir[src],lon=Math.atan2(du[2],du[0]),lat=Math.asin(clamp(du[1],-1,1)),c=used[src]=(used[src]||0)+1;
          const sh=(c-1)?(c%2?-1:1)*Math.ceil((c-1)/2)*STEP*.6:0;u=sph(lon+sh,lat*(k?.8:.9));}
        else u=sph(TAU*i/n,0);
        const id=add({x:u[0]*R,y:u[1]*R,z:u[2]*R,l:groups.length,i,v:v[i],name:ly.name+' · #'+i,label:ly.name,kind:'hidden',rgb:CORE,
          desc:(v[i]==null?'':'나가는 연결 세기 '+(v[i]*100).toFixed(0)+'%(최대 대비) · ')+'모든 지평이 같이 쓴다 · 누르면 실제 연결선 전부'},ids);
        dir[id]=u;rad[id]=R;}
      layerIds.push(ids);groups.push({ids,label:ly.name+' · '+n,count:n});prev=ids;
    });
    // ── 중심 핵: 지평 머리 5 + 홍채 고리(장식 · 제 축으로 돈다) ──
    const hl=nv?nv.layers[nv.layers.length-1]:null,hv=hl?hl.strength||[]:[],bids=[];
    hz.forEach((h,k)=>{const t=TAU*k/hz.length,e=hv[k];
      const id=add({x:Math.cos(t)*R0,y:0,z:Math.sin(t)*R0,l:groups.length,i:k,v:finite(e)?clamp(e/0.05,0,1):null,
        name:'핵 · '+(HZ_TXT[h]||h)+' 머리',label:'핵',kind:'output',rgb:CORE_HI,
        desc:nv?(finite(e)?'신경망 단독 홀드아웃 AUC '+(0.5+e).toFixed(3):'홀드아웃 못 쟀다'):'신경망이 아직 없다'},bids);
      dir[id]=[Math.cos(t),0,Math.sin(t)];rad[id]=R0;});
    bids.forEach((id,j)=>guide(id,bids[(j+1)%bids.length],'data'));
    [[18,.95,.7],[28,.8,-.5],[52,.9,.3],[60,.55,-.4],[76,.6,.22],[100,.45,-.15]].forEach(([r,keep,w],q)=>{
      const nrm=unit(Math.sin(q*1.7)*.3,1,Math.cos(q*1.7)*.3);ring(nrm,r*sp,48,q<4?'iris':'ring',keep,{ax:nrm,w});});
    {const ax=[0,1,0],ids=[];   // 홍채 눈금(장식): 핵 둘레의 짧은 방사선
      for(let j=0;j<48;j++){const t=TAU*j/48,r0=(j%4?84:80)*sp,r1=90*sp;
        guide(via([Math.cos(t)*r0,0,Math.sin(t)*r0],{rot:{ax,w:-.1}}),via([Math.cos(t)*r1,0,Math.sin(t)*r1],{rot:{ax,w:-.1}}),'iris');}}
    layerIds.push(bids);groups.push({ids:bids,label:'핵 · 지평 머리',count:hz.length});
    // ── ③ 실제 연결: 한 줄씩 · 구면 호 · 평소엔 뉴런마다 가장 센 한 줄 ──
    const SEG=6;
    const arc=(a,b)=>{const ua=dir[a],ub=dir[b],ra=rad[a],rb=rad[b],path=[a];
      const dot=clamp(ua[0]*ub[0]+ua[1]*ub[1]+ua[2]*ub[2],-1,1),om=Math.acos(dot),so=Math.sin(om);
      for(let q=1;q<SEG;q++){const t=q/SEG,r=ra+(rb-ra)*t;
        const f0=so>1e-6?Math.sin((1-t)*om)/so:1-t,f1=so>1e-6?Math.sin(t*om)/so:t;
        const u=unit(ua[0]*f0+ub[0]*f1,ua[1]*f0+ub[1]*f1,ua[2]*f0+ub[2]*f1);
        path.push(via([u[0]*r,u[1]*r,u[2]*r]));}
      path.push(b);return path;};
    if(nv)(nv.edges||[]).forEach((es,l)=>{const A=layerIds[l],B=layerIds[l+1];if(!A||!B)return;
      const last=l===nv.edges.length-1,t1=top1[l]||{};
      es.forEach(([i,k,v])=>{if(A[i]!=null&&B[k]!=null&&finite(v)){
        const main=last||(t1[k]&&t1[k][0]===i);
        edges.push({a:A[i],b:B[k],v:clamp(v,0,1),measured:true,strand:true,detail:!main,path:arc(A[i],B[k])});}});});
    // ── ④ 장식(값 없음): 자이로 고리(각자 돈다) · 빛줄기 · 불꽃 ──
    for(let q=0;q<6;q++){const nrm=unit(rnd()-.5,rnd()-.5,rnd()-.5),R=R3*(1.08+q*.035);
      ring(nrm,R,120,'gyro',.42+rnd()*.3,{ax:unit(rnd()-.5,1,rnd()-.5),w:(q%2?-1:1)*(.05+rnd()*.08)});}
    {const ax=unit(.35,1,-.25);   // 기운 축을 따라 평행한 작은 고리들(위도 고리 · 장식) — 구의 윤곽
      for(let q=-3;q<=3;q++){if(!q)continue;const hh=q/4*R3*1.03,rr=Math.sqrt(Math.max(0,(R3*1.03)**2-hh*hh)),[e1,e2]=basis(ax),ids=[];
        for(let j=0;j<72;j++){const t=TAU*j/72;ids.push(via([ax[0]*hh+(e1[0]*Math.cos(t)+e2[0]*Math.sin(t))*rr,ax[1]*hh+(e1[1]*Math.cos(t)+e2[1]*Math.sin(t))*rr,ax[2]*hh+(e1[2]*Math.cos(t)+e2[2]*Math.sin(t))*rr],{rot:{ax,w:.04}}));}
        for(let j=0;j<72;j++)if(rnd()<.5)guide(ids[j],ids[(j+1)%72],'lat');}}
    for(let q=0;q<14;q++){const u=unit(rnd()-.5,rnd()-.5,rnd()-.5),w=unit(-u[0]+(rnd()-.5)*.8,-u[1]+(rnd()-.5)*.8,-u[2]+(rnd()-.5)*.8),Ra=R3*(1.1+rnd()*.35),Rb=R3*(.9+rnd()*.4);
      guide(via([u[0]*Ra,u[1]*Ra,u[2]*Ra]),via([w[0]*Rb,w[1]*Rb,w[2]*Rb]),'streak');}
    for(let q=0;q<180;q++){const u=unit(rnd()-.5,rnd()-.5,rnd()-.5),r=R3*(.35+rnd()*.85);
      nodes.push({x:u[0]*r,y:u[1]*r,z:u[2]*r,l:-1,i:q,v:null,name:'',label:'',kind:'spark',deco:true});}
    // ── 적도 고리: 나무 숲(시드마다 호 · 눈금은 구조 약식) ──
    const seeds=Math.max(1,Math.min(8,d.seeds||1)),per=Math.max(12,Math.min(30,Math.round((d.nTrees||60)/seeds/3))),fid=[];
    const RR=350*sp,gap=.08;
    for(let sd=0;sd<seeds;sd++)for(let j=0;j<per;j++){const t=TAU*sd/seeds+gap/2+(TAU/seeds-gap)*(j+.5)/per;
      add({x:Math.cos(t)*RR,y:0,z:Math.sin(t)*RR,l:groups.length,i:sd*per+j,v:null,
        name:'나무 숲 · 시드 '+(sd+1),label:'고리 · 나무 숲',kind:'hidden',rgb:HUD,
        desc:(d.nTrees||0)+'그루 · 시드 '+seeds+'개 앙상블'+(d.gbdt?' · 구성 '+d.gbdt.name+'('+d.gbdt.why+')':'')+' · 눈금은 구조 약식'},fid);
      if(j)guide(fid[fid.length-2],fid[fid.length-1],'hud');}
    groups.push({ids:fid,label:'고리 · 나무 숲 '+(d.nTrees||0)+'그루',count:d.nTrees||0});
    const gshare={};(d.groups||[]).forEach(g=>{gshare[g.name]=g.share;});
    const gmax=Math.max(1e-9,...Object.values(gshare).filter(finite));
    gKeys.forEach((g,q)=>{const sh=gshare[OMNI_GAIN[OMNI_GROUPS[g][1]]],ids=gIds[g];
      if(!finite(sh)||!ids||!ids.length)return;
      edges.push({a:ids[Math.floor(ids.length/2)],b:fid[(q*7)%fid.length],v:clamp(sh/gmax,0,1),measured:true,detail:true,straight:true});});
    // ── 위성: 지평별 최종 확률 ──
    const heads=d.heads||[],aid=[];
    hz.forEach((h,k)=>{const hd=heads.find(x=>x&&x.hz===h)||{},a=finite(alpha[k])?alpha[k]:0,t=TAU*k/hz.length,RS=420*sp;
      const id=add({x:Math.cos(t)*RS,y:0,z:Math.sin(t)*RS,l:groups.length,i:k,
        v:finite(hd.auc)?clamp((hd.auc-0.5)/0.05,0,1):null,name:'위성 · '+(HZ_TXT[h]||h)+' 최종 확률',label:'최종 확률',kind:'output',rgb:CORE_HI,tag:HZ_TXT[h]||h,
        desc:'(1−α)·나무 숲 + α·핵 · α '+a.toFixed(1)+' · 홀드아웃 AUC '+(finite(hd.auc)?hd.auc.toFixed(3):'—')+(hd.ok?' · 발언 문턱 통과':' · 보류')},aid);
      const fk=fid.reduce((best,f)=>{const n=nodes[f],dd=(n.x-Math.cos(t)*RR)**2+(n.z-Math.sin(t)*RR)**2;return dd<best[1]?[f,dd]:best;},[fid[0],Infinity])[0];
      edges.push({a:fk,b:id,v:clamp(1-a,0,1),measured:true,strand:true,straight:true,hud:true});
      if(a>0)edges.push({a:bids[k],b:id,v:clamp(a,0,1),measured:true,strand:true,straight:true});});
    groups.push({ids:aid,label:'위성 · 최종 확률',count:hz.length});
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
      detail:false,spread:1,yaw:config.kind==='omni'?.3:-.35,pitch:config.kind==='omni'?.28:.3,zoom:1,panX:0,panY:0,spin:vol&&!reduced.matches,motion:!reduced.matches};
    let scene,points=[],selected=-1,raf=0,last=0,visible=true,dead=false,dirty=true,phase=0,w=1,h=1,draws=0,totalMs=0;
    const cache=document.createElement('canvas');let cached=false;
    host.innerHTML='<section class="nerve-room"><header class="nerve-heading"><div><span class="nerve-kicker">'+(seq?'TEMPORAL NEURAL VOLUME':om?'HOLOGRAPHIC NEURAL CORE':'NEURAL SIGNAL FIELD')+'</span><h3>'+(seq?'시간을 연결하는 신경망':om?'입력 고리 → 몸통 → 핵(지평 머리) · 적도 고리 = 나무 숲 · 위성 = 최종 확률':'신호가 모이고, 판단이 되는 과정')+'</h3></div><span class="nerve-status">'+(vol?'3D':'2D')+' / STRUCTURE</span></header><div class="nerve-controls"></div><div class="nerve-viewport"><canvas tabindex="0" role="img" aria-label="신경망 구조. 아래 층과 노드 선택으로 값을 확인할 수 있습니다."></canvas><div class="nerve-corner">'+(vol?'DRAG TO ORBIT':'INPUT → HIDDEN → OUTPUT')+'</div></div><div class="nerve-layers"></div><div class="nerve-inspector"><label>층 <select class="nerve-layer"></select></label><label>노드 <select class="nerve-node"></select></label><output aria-live="polite">노드를 선택하면 저장된 값을 확인합니다.</output></div><footer class="nerve-note">움직임은 신호 흐름의 연출입니다. 실시간 활성값이 아닙니다. 연결선은 구조를 간추려 표시합니다.</footer></section>';
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
    if(om) button('껍질 펼침',b=>{s.spread=s.spread===1?1.7:1;b.setAttribute('aria-pressed',s.spread>1);rebuild();},false);
    const spin=vol?button('자동회전',b=>{s.spin=!s.spin;b.setAttribute('aria-pressed',s.spin);},s.spin):null;
    button('−',()=>s.zoom=clamp(s.zoom/1.25,.6,8)).setAttribute('aria-label','축소');
    button('+',()=>s.zoom=clamp(s.zoom*1.25,.6,8)).setAttribute('aria-label','확대');
    button('화면 맞춤',()=>{s.zoom=1;s.panX=s.panY=0;s.yaw=om?.3:-.35;s.pitch=om?.28:.3;});
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
      populate();info.textContent=seq?(scene.attn?'선택 시점의 실제 표본 어텐션을 표시합니다.':'어텐션 표본 없음 · 구조만 표시합니다.'):om?(d.nnViz?'뉴런마다 가장 센 실제 연결 한 줄을 그립니다(밝을수록 |w| 큼). 점을 누르면 그 뉴런의 실제 연결이 전부 나옵니다. 도는 고리·빛줄기·불꽃·홍채는 장식이며 값이 없습니다.':'신경망이 아직 안 올라왔습니다 — 나무 숲 구조만 표시합니다.'):'모든 뉴런을 표시합니다. 선은 연결 구조의 요약이며 개별 가중치가 아닙니다.';
      dirty=true;wake();
    }
    function signals(){
      if(!s.motion)return;
      const edges=scene.edges.filter(e=>!e.detail&&!e.guide&&(!e.strand||e.path||e.straight)),step=Math.max(1,Math.ceil(edges.length/100));
      ctx.fillStyle=om?'rgba('+CORE_HI+',.9)':'rgba(255,255,255,.85)';ctx.beginPath();
      for(let i=0;i<edges.length;i+=step){
        const e=edges[i],a=points[e.a],b=points[e.b],t=(phase*.3+i*.618)%1,u=1-t;
        if(e.path){const P=e.path.map(id=>points[id]),f=t*(P.length-1),k=Math.min(P.length-2,Math.floor(f)),r=f-k;
          const x=P[k].x+(P[k+1].x-P[k].x)*r,y=P[k].y+(P[k+1].y-P[k].y)*r;ctx.moveTo(x+1.2,y);ctx.arc(x,y,1.2,0,TAU);continue;}
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
      const camera={yaw:s.yaw+(s.spin?(om?phase*.12:Math.sin(phase*.16)*.18):0),pitch:s.pitch};
      const narrow=!vol&&w<600;
      const ang=phase;
      const raw=scene.nodes.map(n=>{
        if(n.rot){const k=n.rot.ax,t=ang*n.rot.w,c=Math.cos(t),sn=Math.sin(t),dt=(k[0]*n.x+k[1]*n.y+k[2]*n.z)*(1-c);   // [V33.436] 장식 고리는 제 축으로 돈다(로드리게스)
          return project({x:n.x*c+(k[1]*n.z-k[2]*n.y)*sn+k[0]*dt,y:n.y*c+(k[2]*n.x-k[0]*n.z)*sn+k[1]*dt,z:n.z*c+(k[0]*n.y-k[1]*n.x)*sn+k[2]*dt},camera);}
        if(vol)return project(n,camera);
        if(narrow){const row=Math.floor(n.l/3),col=row%2?2-n.l%3:n.l%3;
          return {x:(col-1)*150+(n.x-(n.l-(scene.groups.length-1)/2)*100)*1.3,
            y:(row-(Math.ceil(scene.groups.length/3)-1)/2)*135+n.y*.45,z:0,k:1};}
        return {x:n.x,y:n.y,z:0,k:1};
      });
      let xmin=Infinity,xmax=-Infinity,ymin=Infinity,ymax=-Infinity;
      // [V33.436] om: 화면 맞춤은 ★데이터 점★ 으로만 — 바깥 장식(자이로 · 빛줄기)은 화면 밖으로 조금 나가도 된다
      for(let i=0;i<raw.length;i++){const p=raw[i],n=scene.nodes[i];if(om&&(n.hidden||n.deco))continue;
        xmin=Math.min(xmin,p.x);xmax=Math.max(xmax,p.x);ymin=Math.min(ymin,p.y);ymax=Math.max(ymax,p.y);}
      const fit=Math.min((w-(om?120:48))/Math.max(1,xmax-xmin),(h-65)/Math.max(1,ymax-ymin));   // om: 위성 이름표 자리
      const scale=Math.max(.01,fit)*s.zoom,cx=(xmin+xmax)/2,cy=(ymin+ymax)/2;
      points=raw.map(p=>({x:(p.x-cx)*scale+w/2+s.panX,y:(p.y-cy)*scale+h/2+s.panY,z:p.z,k:p.k}));
      const dfOf=p=>clamp(.18+.82*(1-(p.z+320)/640),.12,1);   // 깊이 → 투명도(앞 1 · 뒤 0.12)
      if(om){   // [V33.436] 격자 대신 핵의 광채(한 번의 방사 그라데이션) — 참고 그림의 금빛 공기
        const c0=project({x:0,y:0,z:0},camera),gx=(c0.x-cx)*scale+w/2+s.panX,gy=(c0.y-cy)*scale+h/2+s.panY,gr=Math.max(40,330*scale);
        const g=ctx.createRadialGradient(gx,gy,0,gx,gy,gr);g.addColorStop(0,'rgba('+CORE+',.22)');g.addColorStop(.25,'rgba('+CORE+',.07)');g.addColorStop(1,'rgba('+CORE+',0)');
        ctx.fillStyle=g;ctx.fillRect(0,0,w,h);ctx.globalCompositeOperation='lighter';
      }else{ctx.strokeStyle='rgba(255,255,255,.055)';ctx.lineWidth=1;
        ctx.beginPath();for(let x=24;x<w;x+=48){ctx.moveTo(x,20);ctx.lineTo(x,h-20);}for(let y=24;y<h;y+=48){ctx.moveTo(20,y);ctx.lineTo(w-20,y);}ctx.stroke();}
      const edges=scene.edges;
      if(om){   // [V33.436] 구조선(값 없음)은 ★결·깊이 단계별로 묶어 한 번에★ 긋는다 — 수천 번 긋던 것을 수십 번으로
        const TONE={ring:[.34,.65],gyro:[.42,.7],lat:[.3,.6],iris:[.6,.9],data:[.5,.95],hud:[.34,.8],streak:[.12,.5]},B={};
        for(let i=0;i<edges.length;i++){const e=edges[i];if(!e.guide)continue;const a=points[e.a],b=points[e.b];
          const k=(e.tone||'ring')+'|'+Math.round(Math.min(dfOf(a),dfOf(b))*4);(B[k]=B[k]||[]).push(a.x,a.y,b.x,b.y);}
        for(const k in B){const [tone,q]=k.split('|'),t=TONE[tone]||TONE.ring,L=B[k];
          ctx.strokeStyle='rgba('+(tone==='hud'||tone==='iris'?CORE_HI:CORE)+','+(t[0]*(selected>=0?.5:1)*Math.max(.12,q/4))+')';ctx.lineWidth=t[1];
          ctx.beginPath();for(let j=0;j<L.length;j+=4){ctx.moveTo(L[j],L[j+1]);ctx.lineTo(L[j+2],L[j+3]);}ctx.stroke();}
      }
      for(let i=0;i<edges.length;i++){
        const e=edges[i],a=points[e.a],b=points[e.b],focus=selected===e.a||selected===e.b;
        if(e.detail&&!focus)continue;               // [V33.430c] 개별 가중치 선은 누른 점에 닿은 것만
        if(om&&e.guide)continue;                     // 위에서 묶어 그었다
        const ec=om?(e.hud?HUD:CORE):'255,255,255';
        // [V33.433] 깊이 — 구의 뒤쪽(먼 쪽)은 흐리게. 앞뒤가 한 평면에 겹쳐 엉켜 보이던 것을 푼다(홀로그램의 깊이).
        const df=om?Math.min(dfOf(a),dfOf(b)):1;
        ctx.globalAlpha=df;
        if(e.guide){ctx.strokeStyle='rgba('+HUD+','+(e.hud?.55:e.mesh?.24:.08)+')';ctx.lineWidth=e.hud?1:.5;
          ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();continue;}
        ctx.strokeStyle=focus?'rgba(255,255,255,.95)':e.attention?'rgba(255,255,255,'+(.2+.7*e.v)+')':
          e.strand?'rgba('+ec+','+((om?.1+.38*e.v:.16+.5*e.v)*(selected>=0?.22:1))+')':e.bundle?'rgba(255,255,255,'+(.18+.5*e.v)+')':
          e.measured?'rgba('+ec+','+(.04+.5*e.v)+')':'rgba(255,255,255,.10)';
        ctx.lineWidth=e.attention?1+e.v*3:e.ribbon?14:e.bundle?1+e.v*6:e.strand?(focus?1.2:.45+.75*e.v):e.measured?.4+e.v*1.6:focus?1:.5;
        ctx.beginPath();ctx.moveTo(a.x,a.y);
        if(e.straight){ctx.lineTo(b.x,b.y);ctx.stroke();continue;}
        if(e.path){                                   // [V33.432] 경유점을 지나는 매끈한 곡선(가닥)
          const P=e.path.map(id=>points[id]);
          for(let q=1;q<P.length-1;q++){const mx=(P[q].x+P[q+1].x)/2,my=(P[q].y+P[q+1].y)/2;ctx.quadraticCurveTo(P[q].x,P[q].y,q===P.length-2?P[q+1].x:mx,q===P.length-2?P[q+1].y:my);}
          ctx.stroke();continue;
        }
        const bend=vol?0:Math.min(30,Math.abs(b.x-a.x)*.2);
        ctx.bezierCurveTo((a.x+b.x)/2,a.y-bend,(a.x+b.x)/2,b.y+bend,b.x,b.y);ctx.stroke();
      }
      ctx.globalAlpha=1;
      if(om){   // 불꽃(장식 · 값 없음): 반짝이는 작은 점
        ctx.fillStyle='rgb('+CORE_HI+')';
        for(let i=0;i<points.length;i++){const n=scene.nodes[i];if(!n.deco)continue;const p=points[i];
          ctx.globalAlpha=(.12+.5*Math.max(0,Math.sin(phase*1.7+i*2.3)))*dfOf(p);ctx.fillRect(p.x-.6,p.y-.6,1.2,1.2);}
        ctx.globalAlpha=1;}
      // [V33.436] 깊이 정렬은 ★그리는 점만★(경유점·불꽃 수천 개는 빼고) — 매 장면 정렬 비용이 1/10
      if(!scene.drawIds)scene.drawIds=scene.nodes.map((n,i)=>i).filter(i=>!scene.nodes[i].hidden&&!scene.nodes[i].deco);
      const order=scene.drawIds.slice().sort((a,b)=>points[b].z-points[a].z);
      for(const i of order){const p=points[i],n=scene.nodes[i],v=n.v==null?.15:clamp(Math.abs(n.v),0,1),sel=i===selected;
        if(n.hidden||n.deco)continue;                  // 경유점은 그리지 않는다(불꽃은 위에서)
        const r=sel?5:clamp((seq?2.2:om?(n.kind==='output'?4.2:1.9):narrow?.55:1.4)*Math.sqrt(s.zoom)*p.k,narrow?.45:1,om&&n.kind==='output'?7:4);
        const pulse=vol&&s.motion?.08*Math.sin(phase*2-n.l*.7+i*.09):0;
        const al=clamp(.35+v*.6+pulse,.2,1)*(om?dfOf(p):1);
        if(om&&(n.kind==='output'||v>.7)){ctx.fillStyle='rgba('+(n.rgb||CORE)+','+(al*.13)+')';ctx.beginPath();ctx.arc(p.x,p.y,r*(n.kind==='output'?2.2:2.8),0,TAU);ctx.fill();}   // 밝은 점의 후광(실측값이 큰 점만)
        ctx.fillStyle='rgba('+(om&&n.rgb?n.rgb:'255,255,255')+','+al+')';ctx.beginPath();ctx.arc(p.x,p.y,r,0,TAU);ctx.fill();
        if(sel||v>.8&&i%8===0){ctx.strokeStyle=sel?'#fff':'rgba(255,255,255,.15)';ctx.beginPath();ctx.arc(p.x,p.y,r+3,0,TAU);ctx.stroke();}
      }
      ctx.globalCompositeOperation='source-over';
      ctx.font='10px monospace';ctx.fillStyle='#bcbcbc';ctx.textAlign='center';
      // [V33.430c] 좁은 화면에서는 나무 그림의 이름표를 그리지 않는다(겹치고 잘린다) — 같은 이름이 아래 버튼에 있다
      // [V33.433] 구체 핵은 묶음 이름표를 그리지 않는다(구 안쪽에 겹친다) — 아래 버튼·설명에 있다. 위성엔 지평 이름.
      if(om){const drawn=[];for(let q=0;q<scene.nodes.length;q++){const n=scene.nodes[q],p=points[q];if(!n.tag||!p)continue;
        if(n.front){const f=dfOf(p);if(f<.72||drawn.some(o=>Math.abs(o.x-p.x)<n.tag.length*11&&Math.abs(o.y-p.y)<14))continue;drawn.push(p);ctx.globalAlpha=f*.8;ctx.textAlign='center';ctx.fillStyle='rgb('+CORE_HI+')';ctx.fillText(n.tag,p.x,p.y);ctx.fillStyle='#bcbcbc';ctx.globalAlpha=1;continue;}
        ctx.textAlign='left';ctx.fillText(n.tag,p.x+9,p.y+3);}ctx.textAlign='center';}
      if(!om)scene.groups.forEach(g=>{if(!g.ids.length)return;
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
    const resize=new ResizeObserver(()=>{const r=viewport.getBoundingClientRect();w=Math.max(1,r.width);h=Math.max(1,r.height);const ratio=Math.min(devicePixelRatio||1,vol?2:1.5);canvas.width=Math.round(w*ratio);canvas.height=Math.round(h*ratio);ctx.setTransform(ratio,0,0,ratio,0,0);dirty=true;wake();});
    const intersection=new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;if(!visible&&raf){cancelAnimationFrame(raf);raf=0;}wake();});
    const visibility=()=>{if(document.hidden&&raf){cancelAnimationFrame(raf);raf=0;}else wake();};
    const reduce=()=>{if(reduced.matches){s.motion=s.spin=false;motion.setAttribute('aria-pressed','false');spin?.setAttribute('aria-pressed','false');}dirty=true;wake();};
    const pointers=new Map();let moved=false;
    canvas.onpointerdown=e=>{canvas.setPointerCapture(e.pointerId);pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});moved=false;s.spin=false;spin?.setAttribute('aria-pressed','false');};
    canvas.onpointermove=e=>{const old=pointers.get(e.pointerId);if(!old)return;const dx=e.clientX-old.x,dy=e.clientY-old.y;const other=[...pointers.entries()].find(([id])=>id!==e.pointerId)?.[1];
      if(other){const before=Math.hypot(old.x-other.x,old.y-other.y),after=Math.hypot(e.clientX-other.x,e.clientY-other.y);if(before>4)s.zoom=clamp(s.zoom*after/before,.6,8);s.panX+=dx/2;s.panY+=dy/2;}
      else if(vol&&!e.shiftKey){s.yaw-=dx*.006;s.pitch=clamp(s.pitch+dy*.006,-1.2,1.2);}else{s.panX+=dx;s.panY+=dy;}
      if(Math.abs(dx)+Math.abs(dy)>2)moved=true;pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});dirty=true;wake();};
    canvas.onpointerup=e=>{pointers.delete(e.pointerId);if(moved)return;const r=canvas.getBoundingClientRect();let hit=-1,best=225;points.forEach((p,i)=>{if(scene.nodes[i].hidden||scene.nodes[i].deco)return;const dist=(p.x-e.clientX+r.left)**2+(p.y-e.clientY+r.top)**2;if(dist<best){best=dist;hit=i;}});if(hit>=0)inspect(hit);};
    canvas.onpointercancel=e=>pointers.delete(e.pointerId);
    canvas.onwheel=e=>{if(!e.ctrlKey)return;e.preventDefault();s.zoom=clamp(s.zoom*Math.exp(-e.deltaY*.002),.6,8);dirty=true;wake();};
    canvas.onkeydown=e=>{if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','-','Home'].includes(e.key)){e.preventDefault();if(e.key==='Home'){s.zoom=1;s.panX=s.panY=0;}else if(e.key==='+'||e.key==='-')s.zoom=clamp(s.zoom*(e.key==='+'?1.2:1/1.2),.6,8);else if(vol){s.yaw+=e.key==='ArrowLeft'?-.1:e.key==='ArrowRight'?.1:0;s.pitch=clamp(s.pitch+(e.key==='ArrowUp'?-.1:e.key==='ArrowDown'?.1:0),-1.2,1.2);}else{s.panX+=e.key==='ArrowLeft'?-20:e.key==='ArrowRight'?20:0;s.panY+=e.key==='ArrowUp'?-20:e.key==='ArrowDown'?20:0;}dirty=true;wake();}};
    function destroy(){dead=true;cancelAnimationFrame(raf);resize.disconnect();intersection.disconnect();document.removeEventListener('visibilitychange',visibility);reduced.removeEventListener('change',reduce);if(active?.destroy===destroy)active=null;}
    active={destroy};resize.observe(viewport);intersection.observe(viewport);document.addEventListener('visibilitychange',visibility);reduced.addEventListener('change',reduce);rebuild();
    return active;
  }
  root.NeuralObservatory={mount,dense,sequence,attention,project,omniScene};
})(typeof window!=='undefined'?window:globalThis);
