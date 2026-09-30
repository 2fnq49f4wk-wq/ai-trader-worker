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
  /* ═══ [V33.437] OMNI 홀로그램 핵 — ★처음부터 새로★ ═══════════════════════════════════════════════
   * 사용자: "보낸 그림과 너무 다르다 — 노드랑 파라미터 전부 띄우고, 기본 디자인 폐기, 색 하나, 살짝 빛나게 반투명".
   * (영화 이름·로고는 쓰지 않는다 — 금빛 선이 겹겹이 엉긴 구체라는 ★형태★ 만 빌린다.)
   *   · 신경망 ★가중치 전부★(첫 네트: 입력→몸통1→몸통2→머리)를 한 줄씩 — 밝기 = |w|(행렬마다 최대 대비).
   *   · 나무 ★전부★ — 기운 고리 위의 조각 하나가 나무 하나, 조각의 눈금 하나가 분기 하나,
   *     분기마다 ★그 분기가 보는 입력★ 까지 한 줄. 조각·선 밝기 = 그 나무 잎 값 크기(나무끼리 최대 대비).
   *   · 뉴런 전부: 입력(바깥 껍질) · 몸통1 · 몸통2 · 머리 5(핵 둘레).
   *   · 장식(값 없음): 도는 자이로 고리 · 홍채 고리 · 빛줄기. 숫자를 말하지 않는다.
   *   색은 금빛 ★하나★ — 세기는 투명도로만 말한다. 빛이 겹치면 밝아진다(가산 합성) + 저해상도 번짐 한 겹.
   * 그리기: 선 약 1.8만 개를 ★밝기 단계별로 묶어★ 단계마다 한 번에 긋는다(획 호출 수십 번).
   *   좌표·투영은 형식 배열에 — 장면마다 객체를 만들지 않는다. */
  const GOLD='255,190,96';
  const OM_GROUPS=[['m_','5분봉'],['s_','세션'],['h_','60분봉'],['d_','일봉'],['a_','형식알파'],
    ['q_','횡단면'],['p_','피어'],['x_','맥락'],['w_','수급'],['hz_','지평'],['st_','매매법'],['결측:','결측표시']];
  const OM_HZ={'30m':'30분','60m':'60분','1d':'1일','5d':'5일','20d':'20일'};
  const OM_KIND=['입력','몸통 1','몸통 2','머리','나무','장식','분기'];
  function omGroup(nm){const s=String(nm);const g=OM_GROUPS.findIndex(([p])=>s.indexOf(p)===0);return g<0?7:g;}
  function omDecodeQ8(m){   // {r,c,s,d(base64 int8)} → Float32Array(r*c) = |w|/최대 (0~1) · 부호는 버린다(색 하나)
    const bin=typeof atob==='function'?atob(m.d):Buffer.from(m.d,'base64').toString('binary');
    const out=new Float32Array(m.r*m.c);
    for(let i=0;i<out.length;i++){let q=bin.charCodeAt(i);if(q>127)q-=256;out[i]=Math.abs(q)/127;}
    return out;
  }
  function omniCore(d,st,opt){
    d=d||{};const noLines=!!(opt&&opt.noLines);   // [V33.444] noLines: 메인 스레드(워커가 그릴 때)는 선을 안 만든다 — 점 번호는 그대로
    const net=st&&st.ok&&st.net&&Array.isArray(st.net.mats)?st.net:null;
    const nv=!net&&d.nnViz&&Array.isArray(d.nnViz.layers)?d.nnViz:null;
    const hz=d.horizons||(st&&st.horizons)||['30m','60m','1d','5d','20d'];
    const X=[],K=[],V=[],NM=[],RG=[],RA=[];      // 점: 좌표 · 종류 · 값(NaN=없음) · 이름 · 도는 고리 번호(-1) · 고리 위 각도
    const LA=[],LB=[],LS=[],LK=[];               // 선: 두 끝 · 세기(0~1) · 종류(0 w1 · 1 w2 · 2 머리 · 3 분기 · 4 장식 · 5 나무 몸)
    const rings=[];
    const pt=(x,y,z,k,v,nm,rg,ra)=>{X.push(x,y,z);K.push(k);V.push(v==null||!finite(v)?NaN:v);NM.push(nm||'');RG.push(rg==null?-1:rg);RA.push(ra||0);return K.length-1;};
    const ln=(a,b,s,k)=>{if(noLines)return;LA.push(a);LB.push(b);LS.push(s);LK.push(k);};
    const unit=(x,y,z)=>{const l=Math.hypot(x,y,z)||1;return [x/l,y/l,z/l];};
    const fib=(j,n)=>{const y=1-2*(j+.5)/n,r=Math.sqrt(Math.max(0,1-y*y)),t=j*2.39996323;return [Math.cos(t)*r,y,Math.sin(t)*r];};
    const ringOf=(nrm,R,w)=>{const n=unit(...nrm),t=Math.abs(n[1])<.9?[0,1,0]:[1,0,0];
      const e1=unit(n[1]*t[2]-n[2]*t[1],n[2]*t[0]-n[0]*t[2],n[0]*t[1]-n[1]*t[0]),e2=[n[1]*e1[2]-n[2]*e1[1],n[2]*e1[0]-n[0]*e1[2],n[0]*e1[1]-n[1]*e1[0]];
      rings.push({e1,e2,R,w});return rings.length-1;};
    let seed=11;const rnd=()=>{seed=(seed*16807)%2147483647;return (seed-1)/2147483646;};
    const groups=[];
    // ── 뉴런: 입력 · 몸통 · 머리 ──
    let names,sizes,mats=null;
    if(net){names=net.names.slice();sizes=net.sizes.slice();mats=net.mats.map(omDecodeQ8);}
    else if(nv){names=nv.layers[0].names||[];sizes=nv.layers.map(l=>l.size||(l.strength||[]).length);}
    else{names=(d.feats||[]).slice();sizes=[names.length,0,0,hz.length];}
    // 나무가 보는데 신경망엔 없는 칸(지평·매매법 원핫 등)도 입력 껍질에 올린다 — 분기선이 갈 곳
    const trees=st&&st.ok&&Array.isArray(st.trees)?st.trees:[];
    const tf=st&&Array.isArray(st.feats)?st.feats:(d.feats||[]);
    const extra=[];{const have=new Set(names);trees.forEach(t=>{for(let j=2;j<t.length;j++){const nm=tf[t[j]];if(nm!=null&&!have.has(nm)){have.add(nm);extra.push(nm);}}});}
    const inNames=names.concat(extra),nIn=inNames.length;
    const order=inNames.map((n,i)=>i).sort((a,b)=>omGroup(inNames[a])-omGroup(inNames[b])||a-b);
    const inPt=new Array(nIn),R_IN=300,R_H1=208,R_H2=138,R_HD=72;
    // 입력 세기 = 나가는 |w| 합(첫 행렬) — 측정값. 없으면 NaN(흐리게)
    const rowSum=(M,r,c)=>{const o=new Float64Array(r);for(let i=0;i<r;i++){let s=0;for(let k=0;k<c;k++)s+=M[i*c+k];o[i]=s;}return o;};
    const nrm01=a=>{let m=0;for(const v of a)if(v>m)m=v;return Array.from(a,v=>m>0?v/m:NaN);};
    const inV=mats?nrm01(rowSum(mats[0],net.mats[0].r,net.mats[0].c)):(nv?(nv.layers[0].strength||[]).map(v=>finite(v)?Math.abs(v):NaN):[]);
    order.forEach((i,j)=>{const u=fib(j,nIn);inPt[i]=pt(u[0]*R_IN,u[1]*R_IN,u[2]*R_IN,0,i<names.length?inV[i]:NaN,inNames[i]);});
    groups.push({label:'입력',kind:0,ids:order.map(i=>inPt[i])});
    const hidPts=[];
    const hidSizes=sizes.slice(1,-1);
    hidSizes.forEach((n,k)=>{const R=k?R_H2:R_H1,ids=[],off=k?1.3:.4;
      const v=mats&&mats[k+1]?nrm01(rowSum(mats[k+1],net.mats[k+1].r,net.mats[k+1].c)):(nv?(nv.layers[k+1].strength||[]).map(x=>finite(x)?Math.abs(x):NaN):[]);
      for(let i=0;i<n;i++){const u=fib(i,n),c=Math.cos(off),s=Math.sin(off);
        ids.push(pt((u[0]*c-u[2]*s)*R,u[1]*R,(u[0]*s+u[2]*c)*R,k+1,v[i],'몸통 '+(k+1)+' · #'+i));}
      hidPts.push(ids);groups.push({label:'몸통 '+(k+1),kind:k+1,ids});});
    const headE=nv?(nv.layers[nv.layers.length-1].strength||[]):((d.nnViz&&d.nnViz.layers)?(d.nnViz.layers[d.nnViz.layers.length-1].strength||[]):[]);
    const heads=d.heads||[];
    const hdPts=hz.map((h,k)=>{const t=TAU*k/hz.length,e=headE[k],hd=heads.find(x=>x&&x.hz===h)||{};
      const id=pt(Math.cos(t)*R_HD,0,Math.sin(t)*R_HD,3,finite(e)?clamp(e/.05,0,1):NaN,'머리 · '+(OM_HZ[h]||h));
      NM[id]+=' — 신경망 단독 홀드아웃 AUC '+(finite(e)?(.5+e).toFixed(3):'—')+' · 최종(섞음) AUC '+(finite(hd.auc)?hd.auc.toFixed(3):'—')+(hd.ok?' · 발언 문턱 통과':' · 보류');
      return id;});
    groups.push({label:'머리',kind:3,ids:hdPts});
    // ── 신경망 선: 가중치 전부(있으면) · 없으면 대표 연결(nnViz) ──
    const layerPts=[inPt.slice(0,names.length)].concat(hidPts,[hdPts]);
    if(mats){net.mats.forEach((m,l)=>{const A=layerPts[l],B=layerPts[l+1],M=mats[l];if(!A||!B)return;
        for(let i=0;i<m.r;i++)for(let k=0;k<m.c;k++){const s=M[i*m.c+k];if(A[i]!=null&&B[k]!=null)ln(A[i],B[k],s,Math.min(l,2));}});}
    else if(nv){(nv.edges||[]).forEach((es,l)=>{const A=layerPts[l],B=layerPts[l+1];if(!A||!B)return;
        es.forEach(([i,k,v])=>{if(A[i]!=null&&B[k]!=null&&finite(v))ln(A[i],B[k],clamp(v,0,1),Math.min(l,2));});});}
    // ── 나무 전부: 기운 고리 위 조각 · 분기 눈금 · 분기 → 입력 ──
    const nameToPt=new Map();inNames.forEach((n,i)=>nameToPt.set(n,inPt[i]));
    const RN=Math.max(1,Math.min(6,(st&&st.seeds)||d.seeds||4));
    const tNorm=nrm01(trees.map(t=>t[1]||0));
    const treeRings=[];for(let r=0;r<RN;r++){const a=r*2.39996323,y=.35+.5*((r*.618)%1);
      treeRings.push(ringOf([Math.cos(a)*(1-y*y),y,Math.sin(a)*(1-y*y)],R_IN*(1.18+r*.045),(r%2?-1:1)*(.035+.02*r)));}
    const per=Math.ceil(trees.length/RN)||1,treePts=[],tbody=[];   // tbody: 나무 몸(조각) = 눈금을 잇는 꺾은선 하나
    trees.forEach((t,j)=>{const r=Math.floor(j/per),q=j-r*per,m=Math.min(per,trees.length-r*per),rg=treeRings[r];
      const th=TAU*(q+.5)/m,span=TAU/m*.78,ns=t.length-2,tv=tNorm[j];
      const c=pt(0,0,0,4,tv,'나무 #'+(j+1)+' · 잎 '+t[0]+' · 분기 '+ns,rg,th);treePts.push(c);
      const ticks=[];
      for(let s=0;s<ns;s++){const a=th+(ns>1?(s/(ns-1)-.5):0)*span,tk=pt(0,0,0,6,NaN,'',rg,a);ticks.push(tk);
        const tgt=nameToPt.get(tf[t[s+2]]);if(tgt!=null)ln(tk,tgt,finite(tv)?tv:.3,3);}
      tbody.push({ids:ticks,v:finite(tv)?tv:.3});});
    if(trees.length)groups.push({label:'나무',kind:4,ids:treePts});
    // ── 장식(값 없음): 자이로 고리 · 홍채 고리 · 빛줄기 ──
    const decoRing=(nrm,R,w,m,keep)=>{const rg=ringOf(nrm,R,w),ids=[];for(let q=0;q<m;q++)ids.push(pt(0,0,0,5,NaN,'',rg,TAU*q/m));
      for(let q=0;q<m;q++)if(rnd()<keep)ln(ids[q],ids[(q+1)%m],.55,4);};
    for(let q=0;q<5;q++)decoRing([rnd()-.5,rnd()-.5,rnd()-.5],R_IN*(1.04+q*.03),(q%2?-1:1)*(.04+rnd()*.06),128,.35+rnd()*.3);
    [[16,.9],[26,.75],[36,.6],[84,.55],[96,.4]].forEach(([r,keep],q)=>decoRing([Math.sin(q*1.7)*.25,1,Math.cos(q*1.7)*.25],r,(q%2?-1:1)*(.3-.04*q),56,keep));
    for(let q=0;q<10;q++){const u=unit(rnd()-.5,rnd()-.5,rnd()-.5),w=unit(-u[0]+(rnd()-.5),-u[1]+(rnd()-.5),-u[2]+(rnd()-.5)),Ra=R_IN*(1.25+rnd()*.3),Rb=R_IN*(.8+rnd()*.5);
      ln(pt(u[0]*Ra,u[1]*Ra,u[2]*Ra,5,NaN,''),pt(w[0]*Rb,w[1]*Rb,w[2]*Rb,5,NaN,''),.35,4);}
    const n=K.length;
    // 흐르는 빛(연출)이 지나갈 선: 신경망 선 중 가장 센 120개 — [V33.444] 여기서 만든다(워커도 쓰게. 예전엔 메인만 만들어 워커에선 안 돌았다)
    const top=[];if(LA.length){const idx=[];for(let j=0;j<LK.length;j++)if(LK[j]<=2)idx.push(j);idx.sort((a,b)=>LS[b]-LS[a]);for(let j=0;j<Math.min(120,idx.length);j++)top.push(idx[j]);}
    return {n,top,P:new Float32Array(X),kind:Uint8Array.from(K),val:Float32Array.from(V),name:NM,
      ring:Int16Array.from(RG),ang:Float32Array.from(RA),rings,
      la:Int32Array.from(LA),lb:Int32Array.from(LB),ls:Float32Array.from(LS),lk:Uint8Array.from(LK),
      groups,hz,tbody,shells:[R_IN,R_H1,R_H2],bands:trees.length?treeRings:[],info:{params:mats?net.mats.reduce((a,m)=>a+m.r*m.c,0):0,splits:trees.reduce((a,t)=>a+t.length-2,0),trees:trees.length,
        nets:net?net.nets:0,full:!!mats,inputs:nIn,sizes:[nIn].concat(hidSizes,[hz.length])}};
  }
  const OM_LEVELS=14,OM_KGAIN=[.55,.8,1,.35,.45,.9],OM_LOD=4,OM_LOD_MAX=5000,OM_ALPHA_EXP=3.4;   // OM_ALPHA_EXP: 단계 → 투명도 곡선(대비형 · 크기 순서 그대로) — 약한 가중치는 투명에 가깝게, 센 것만 또렷하게   // OM_LOD: 움직이는 중(대체 경로) 이 단계 밑은 건너뛴다   // 종류별 밝기 배율(투명도) — w1 은 7천 줄이라 낮게
  function drawCore(ctx,sc,v,W,H,t){
    // 1) 도는 점(나무 조각·눈금·장식 고리)의 3D 위치 → 2) 투영(형식 배열에 · 객체 없음)
    const n=sc.n,P=sc.P;
    if(!sc.SX){sc.SX=new Float32Array(n);sc.SY=new Float32Array(n);sc.SZ=new Float32Array(n);sc.W3=new Float32Array(P);}
    const W3=sc.W3,SX=sc.SX,SY=sc.SY,SZ=sc.SZ;
    for(let i=0;i<n;i++){const r=sc.ring[i];if(r<0)continue;const R=sc.rings[r],a=sc.ang[i]+t*R.w,c=Math.cos(a)*R.R,s=Math.sin(a)*R.R;
      W3[i*3]=R.e1[0]*c+R.e2[0]*s;W3[i*3+1]=R.e1[1]*c+R.e2[1]*s;W3[i*3+2]=R.e1[2]*c+R.e2[2]*s;}
    const cy=Math.cos(v.yaw),sy=Math.sin(v.yaw),cp=Math.cos(v.pitch),sp=Math.sin(v.pitch);
    const scale=Math.min(W,H)/(2*400)*v.zoom,ox=W/2+v.panX,oy=H/2+v.panY;
    for(let i=0;i<n;i++){const x=W3[i*3],y=W3[i*3+1],z=W3[i*3+2];
      const xr=x*cy+z*sy,zr=-x*sy+z*cy,yr=y*cp-zr*sp,dp=y*sp+zr*cp,k=900/(900+dp);
      SX[i]=xr*k*scale+ox;SY[i]=yr*k*scale+oy;SZ[i]=dp;}
    const df=i=>{const q=.2+.8*(1-(SZ[i]+380)/760);return q<.12?.12:q>1?1:q;};
    // [V33.448] ★장면마다 배율을 다시 건다 · 캔버스 전체를 지운다★ — 아이폰 사파리 캡처: 그림이 왼쪽 위 2/3 에만 그려지고
    //   나머지(ㄱ자)엔 옛 장면이 남았다. 캔버스 크기를 바꾸면(주소창 · 보기 전환) 사파리가 배율(1.5)을 풀어 버려
    //   1배로 그려졌고, 지우기도 그 1배 영역(2/3)만 지웠다. 이제 크기가 어떻든 실제 캔버스 크기에서 배율을 계산해 매번 건다.
    const cvs=ctx.canvas;
    ctx.setTransform(1,0,0,1,0,0);ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';
    if(cvs&&cvs.width){ctx.clearRect(0,0,cvs.width,cvs.height);ctx.setTransform(cvs.width/W,0,0,cvs.height/H,0,0);}else ctx.clearRect(0,0,W,H);
    ctx.globalCompositeOperation='lighter';
    // 3) [V33.438] ★맑은 아크릴★ — 넓게 깔던 광채(뿌옇게 보인 원인)를 걷고, 유리 같은 껍질 셋:
    //    가장자리로 갈수록 진해지는 면(프레넬) · 또렷한 테두리 · 왼쪽 위 반사광 호 · 반짝임. 모두 장식(값 없음).
    let strokes=0;
    {const rim=[],sh=sc.shells||[];
      for(let q=0;q<sh.length;q++){const rr=sh[q]*scale;
        const g=ctx.createRadialGradient(ox,oy,rr*.62,ox,oy,rr);g.addColorStop(0,'rgba('+GOLD+',0)');g.addColorStop(.86,'rgba('+GOLD+','+(.018+.008*q)+')');g.addColorStop(1,'rgba('+GOLD+','+(.075-.012*q)+')');
        ctx.fillStyle=g;ctx.beginPath();ctx.arc(ox,oy,rr,0,TAU);ctx.fill();rim.push(rr);}
      ctx.lineWidth=1;ctx.strokeStyle='rgba('+GOLD+',.42)';ctx.beginPath();for(const rr of rim){ctx.moveTo(ox+rr,oy);ctx.arc(ox,oy,rr,0,TAU);}ctx.stroke();strokes++;
      ctx.strokeStyle='rgba('+GOLD+',.13)';ctx.beginPath();for(const rr of rim){ctx.moveTo(ox+rr*.975,oy);ctx.arc(ox,oy,rr*.975,0,TAU);}ctx.stroke();strokes++;
      ctx.lineWidth=2.6;ctx.lineCap='round';ctx.strokeStyle='rgba('+GOLD+',.8)';ctx.beginPath();   // 반사광(왼쪽 위)
      for(const rr of rim){const a0=-2.62,a1=-1.86;ctx.moveTo(ox+Math.cos(a0)*rr*.93,oy+Math.sin(a0)*rr*.93);ctx.arc(ox,oy,rr*.93,a0,a1);}ctx.stroke();strokes++;
      ctx.lineWidth=1.2;ctx.strokeStyle='rgba('+GOLD+',.22)';ctx.beginPath();   // 맞은편 약한 반사
      for(const rr of rim){const a0=.55,a1=1.15;ctx.moveTo(ox+Math.cos(a0)*rr*.95,oy+Math.sin(a0)*rr*.95);ctx.arc(ox,oy,rr*.95,a0,a1);}ctx.stroke();strokes++;
      ctx.lineCap='butt';ctx.fillStyle='rgba('+GOLD+',.85)';ctx.beginPath();
      for(const rr of rim){const x=ox+Math.cos(-2.35)*rr*.84,y=oy+Math.sin(-2.35)*rr*.84;ctx.moveTo(x+1.8,y);ctx.arc(x,y,1.8,0,TAU);}ctx.fill();
      // 핵 렌즈: 작고 맑은 빛(넓게 번지지 않는다)
      const cr=62*scale,cg=ctx.createRadialGradient(ox,oy,0,ox,oy,cr);cg.addColorStop(0,'rgba('+GOLD+',.5)');cg.addColorStop(.35,'rgba('+GOLD+',.12)');cg.addColorStop(1,'rgba('+GOLD+',0)');
      ctx.fillStyle=cg;ctx.beginPath();ctx.arc(ox,oy,cr,0,TAU);ctx.fill();}
    // 4) ★아크릴 띠★ — 나무 고리를 폭 있는 투명 띠로: 반투명 면 + 날카로운 두 모서리(앞 진하게 · 뒤 옅게) + 띠를 따라 흐르는 반사광
    const bands=sc.bands||[];
    if(bands.length){const M=120,hw=9,bx=[],by=[],bz=[];
      const pj=(x,y,z)=>{const xr=x*cy+z*sy,zr=-x*sy+z*cy,yr=y*cp-zr*sp,dp=y*sp+zr*cp,k=900/(900+dp);bx.push(xr*k*scale+ox);by.push(yr*k*scale+oy);bz.push(dp);};
      bands.forEach(ri=>{const R=sc.rings[ri],e1=R.e1,e2=R.e2,nn=[e1[1]*e2[2]-e1[2]*e2[1],e1[2]*e2[0]-e1[0]*e2[2],e1[0]*e2[1]-e1[1]*e2[0]];
        for(let j=0;j<M;j++){const a=TAU*j/M,c=Math.cos(a)*R.R,s2=Math.sin(a)*R.R,x=e1[0]*c+e2[0]*s2,y=e1[1]*c+e2[1]*s2,z=e1[2]*c+e2[2]*s2;
          pj(x+nn[0]*hw,y+nn[1]*hw,z+nn[2]*hw);pj(x-nn[0]*hw,y-nn[1]*hw,z-nn[2]*hw);}});
      ctx.fillStyle='rgba('+GOLD+',.05)';ctx.beginPath();
      for(let b=0;b<bands.length;b++)for(let j=0;j<M;j++){const i0=(b*M+j)*2,i1=(b*M+(j+1)%M)*2;
        ctx.moveTo(bx[i0],by[i0]);ctx.lineTo(bx[i1],by[i1]);ctx.lineTo(bx[i1+1],by[i1+1]);ctx.lineTo(bx[i0+1],by[i0+1]);ctx.closePath();}
      ctx.fill();
      for(const front of [false,true]){ctx.lineWidth=front?1.1:1;ctx.strokeStyle='rgba('+GOLD+','+(front?.62:.16)+')';ctx.beginPath();
        for(let b=0;b<bands.length;b++)for(let j=0;j<M;j++)for(let e=0;e<2;e++){const i0=(b*M+j)*2+e,i1=(b*M+(j+1)%M)*2+e;if((bz[i0]+bz[i1]<0)!==front)continue;
          ctx.moveTo(bx[i0],by[i0]);ctx.lineTo(bx[i1],by[i1]);}ctx.stroke();strokes++;}
      ctx.lineWidth=1.8;ctx.lineCap='round';ctx.strokeStyle='rgba('+GOLD+',.95)';ctx.beginPath();   // 흐르는 반사광(연출)
      for(let b=0;b<bands.length;b++)for(let g2=0;g2<2;g2++){const j0=Math.floor(((t*(.09+.03*b)+g2*.5+b*.21)%1)*M);
        for(let j=0;j<9;j++){const e=(j0+j)%M,f2=(j0+j+1)%M,i0=(b*M+e)*2,i1=(b*M+f2)*2;ctx.moveTo(bx[i0],by[i0]);ctx.lineTo(bx[i1],by[i1]);}}
      ctx.stroke();strokes++;ctx.lineCap='butt';}
    // 4) 선 — 밝기 단계별로 묶어 단계마다 한 번에(선택된 점에 닿은 선은 따로)
    const la=sc.la,lb=sc.lb,ls=sc.ls,lk=sc.lk,m=la.length,sel=v.selected,dim=sel>=0?.35:1;
    // [V33.439] 단계 나누기는 ★미리 잡아 둔 형식 배열★ 에(계수 정렬 두 번) — 장면마다 수만 번 배열을 늘려 쓰레기 수집이 돌던 것을 없앤다.
    //   v.lod(움직이는 중 · 대체 경로) 면 거의 안 보이는 단계는 건너뛴다 — 멈추면 전부 다시 그린다.
    if(!sc.lv||sc.lv.length!==m){sc.lv=new Uint8Array(m);sc.cnt=new Int32Array(OM_LEVELS);sc.off=new Int32Array(OM_LEVELS+1);sc.pos=new Int32Array(OM_LEVELS);sc.buf=new Float32Array(m*4);}
    const lv=sc.lv,cnt=sc.cnt,off=sc.off,pos=sc.pos,buf=sc.buf;let lodMin=v.lite?1:0;
    // [V33.440] ★노출 = 선 수에 반비례★ — 실제 모델(선 3.7만)은 시험 모델(1.8만)의 두 배라 가산 합성이 하얗게 타 버렸다(운영 캡처).
    const expo=Math.max(.3,Math.min(1,15000/Math.max(1,m)));
    cnt.fill(0);let nh=0,drawn=0;
    for(let j=0;j<m;j++){const a=la[j],b=lb[j];
      if(sel>=0&&(a===sel||b===sel)){lv[j]=254;nh++;continue;}
      let q=Math.floor(Math.pow(ls[j]*OM_KGAIN[lk[j]]*(df(a)+df(b))*.5*dim,.62)*OM_LEVELS);q=q<0?0:q>OM_LEVELS-1?OM_LEVELS-1:q;
      lv[j]=q;cnt[q]++;}
    // 움직이는 중(lod): 밝은 단계부터 ★최대 OM_LOD_MAX 줄★ 까지만 — 모델이 커져도 끄는 동안의 비용이 일정하다
    if(v.lod){let acc=0,q=OM_LEVELS-1;for(;q>0;q--){if(acc+cnt[q]>OM_LOD_MAX)break;acc+=cnt[q];}lodMin=Math.max(lodMin,q+1,OM_LOD);}
    for(let q=0;q<lodMin;q++)cnt[q]=0;
    off[0]=0;for(let q=0;q<OM_LEVELS;q++){off[q+1]=off[q]+cnt[q];pos[q]=off[q]*4;}
    for(let j=0;j<m;j++){const q=lv[j];if(q>=OM_LEVELS||q<lodMin)continue;const p=pos[q],a=la[j],b=lb[j];buf[p]=SX[a];buf[p+1]=SY[a];buf[p+2]=SX[b];buf[p+3]=SY[b];pos[q]=p+4;}
    // 폭 1px · 투명도로 가늘게 보이게 — 1px 미만 선은 래스터화가 2배 넘게 느리다(실측), 보이는 밝기는 같다
    // [V33.438] 대비를 올린다 — 흐린 단계는 더 옅게(안개가 걷힌다) · 센 단계는 더 또렷하게
    ctx.lineWidth=1;
    for(let q=0;q<OM_LEVELS;q++){if(!cnt[q])continue;drawn+=cnt[q];
      ctx.strokeStyle='rgba('+GOLD+','+((.003+.55*(q/(OM_LEVELS-1))**OM_ALPHA_EXP)*expo).toFixed(4)+')';ctx.beginPath();
      for(let j=off[q]*4,e=off[q+1]*4;j<e;j+=4){ctx.moveTo(buf[j],buf[j+1]);ctx.lineTo(buf[j+2],buf[j+3]);}ctx.stroke();strokes++;}
    // 나무 몸: 나무마다 꺾은선 하나(밝기 단계 4개로 묶어)
    for(let tl=v.lod?3:1;tl<=4;tl++){ctx.strokeStyle='rgba('+GOLD+','+(.065*tl*dim*Math.min(1,300/Math.max(1,sc.tbody.length))**.5).toFixed(3)+')';ctx.lineWidth=1;ctx.beginPath();
      for(const tb of sc.tbody){if(Math.min(4,Math.ceil(tb.v*4))!==tl)continue;const I=tb.ids;ctx.moveTo(SX[I[0]],SY[I[0]]);for(let q=1;q<I.length;q++)ctx.lineTo(SX[I[q]],SY[I[q]]);}
      ctx.stroke();strokes++;}
    if(nh){ctx.strokeStyle='rgba('+GOLD+',.85)';ctx.lineWidth=1;ctx.beginPath();drawn+=nh;
      for(let j=0;j<m;j++){if(lv[j]!==254)continue;ctx.moveTo(SX[la[j]],SY[la[j]]);ctx.lineTo(SX[lb[j]],SY[lb[j]]);}ctx.stroke();strokes++;}
    // 5) 신호(연출): 가장 센 선들 위를 흐르는 작은 빛
    if(v.motion&&sc.top){ctx.fillStyle='rgba('+GOLD+',.9)';ctx.beginPath();
      for(let j=0;j<sc.top.length;j++){const e=sc.top[j],u=(t*.35+j*.618)%1,x=SX[la[e]]+(SX[lb[e]]-SX[la[e]])*u,y=SY[la[e]]+(SY[lb[e]]-SY[la[e]])*u;
        ctx.moveTo(x+1.4,y);ctx.arc(x,y,1.4,0,TAU);}ctx.fill();}
    // 6) 점 — 분기 눈금·장식 점은 1px, 뉴런·나무·머리는 원(값이 클수록 진하게 · 값 없음은 흐리게)
    const kind=sc.kind,val=sc.val;
    ctx.fillStyle='rgba('+GOLD+',.45)';ctx.beginPath();      // 분기 눈금 — 한 경로에 모아 한 번에 채운다
    if(!v.lod)for(let i=0;i<n;i++){if(kind[i]!==6||df(i)<.3)continue;ctx.rect(SX[i]-.6,SY[i]-.6,1.2,1.2);}ctx.fill();
    for(let lvl=0;lvl<4;lvl++){ctx.fillStyle='rgba('+GOLD+','+(.25+.25*lvl)+')';ctx.beginPath();
      for(let i=0;i<n;i++){const k=kind[i];if(k>4)continue;const vv=val[i],b=(vv===vv?vv:.1)*df(i),q=Math.min(3,Math.floor(b*4));if(q!==lvl)continue;
        const r=k===3?4.2:k===4?1.6:k===0?1.9:1.7;ctx.moveTo(SX[i]+r,SY[i]);ctx.arc(SX[i],SY[i],r*Math.sqrt(v.zoom),0,TAU);}
      ctx.fill();}
    ctx.strokeStyle='rgba('+GOLD+',.4)';ctx.lineWidth=.9;ctx.beginPath();   // 아크릴 구슬 — 값이 큰 뉴런에 얇은 투명 테
    for(let i=0;i<n;i++){const k=kind[i];if(k>3)continue;const vv=val[i];if(!(vv>.6)||df(i)<.5)continue;const r=(k===3?9:4.2)*Math.sqrt(v.zoom);ctx.moveTo(SX[i]+r,SY[i]);ctx.arc(SX[i],SY[i],r,0,TAU);}
    ctx.stroke();strokes++;
    ctx.fillStyle='rgba('+GOLD+',.12)';ctx.beginPath();   // 머리 후광
    for(const i of sc.groups.find(x=>x.kind===3).ids){ctx.moveTo(SX[i]+11,SY[i]);ctx.arc(SX[i],SY[i],11,0,TAU);}ctx.fill();
    if(sel>=0){ctx.strokeStyle='rgba('+GOLD+',.95)';ctx.lineWidth=1.2;ctx.beginPath();ctx.arc(SX[sel],SY[sel],7,0,TAU);ctx.stroke();}
    // 7) 빛 번짐 한 겹 — 1/4 해상도로 줄였다 다시 키워 더한다(필터 없이 모든 브라우저에서)
    // 번짐은 큰 캔버스를 베끼지 않는다(그게 가장 비쌌다) — ★밝은 선 단계와 뉴런만★ 1/4 캔버스에 다시 긋고 키워 더한다
    if(v.glow&&v.small){const sm=v.small,sx=sm.getContext('2d'),k=sm.width/W;
      sx.setTransform(1,0,0,1,0,0);sx.clearRect(0,0,sm.width,sm.height);sx.setTransform(k,0,0,k,0,0);sx.globalCompositeOperation='lighter';
      sx.lineWidth=1.2;for(let q=Math.floor(OM_LEVELS*.7);q<OM_LEVELS;q++){if(!cnt[q])continue;
        sx.strokeStyle='rgba('+GOLD+','+(.5*(q/(OM_LEVELS-1))**2).toFixed(3)+')';sx.beginPath();for(let j=off[q]*4,e=off[q+1]*4;j<e;j+=4){sx.moveTo(buf[j],buf[j+1]);sx.lineTo(buf[j+2],buf[j+3]);}sx.stroke();}
      sx.fillStyle='rgba('+GOLD+',.5)';sx.beginPath();for(let i=0;i<n;i++){if(kind[i]>4)continue;const vv=val[i];if(!(vv>.5))continue;sx.moveTo(SX[i]+2.4,SY[i]);sx.arc(SX[i],SY[i],2.4,0,TAU);}sx.fill();
      ctx.globalAlpha=.32;ctx.drawImage(sm,0,0,W,H);ctx.globalAlpha=1;}
    ctx.globalCompositeOperation='source-over';
    // 8) 이름표: 머리(지평)만
    ctx.font='10px monospace';ctx.textAlign='left';ctx.fillStyle='rgba('+GOLD+',.85)';
    ctx.textAlign='center';   // 이름표는 핵에서 바깥쪽으로 밀어 겹치지 않게
    sc.groups.find(x=>x.kind===3).ids.forEach((i,k)=>{const dx=SX[i]-ox,dy=SY[i]-oy,l=Math.hypot(dx,dy)||1;ctx.fillText(OM_HZ[sc.hz[k]]||sc.hz[k],SX[i]+dx/l*18,SY[i]+dy/l*18+3);});
    return {strokes,lines:m,drawn};
  }
  /* [V33.439] ★그리기는 별도 스레드에서★ — 사용자: "OMNI 뇌 구조를 보면 사이트가 계속 멈춘다".
   *   원인: 선 1.8만 개를 초당 30번 ★메인 스레드★ 에서 그렸다. 한 장면이 수십~수백 ms 인 기기에선 그동안
   *   스크롤·클릭·다른 화면 갱신이 전부 멈춘다. → OffscreenCanvas 를 Worker 로 넘겨 거기서 장면을 짓고 그린다.
   *   메인 스레드는 입력(끌기·확대·선택)만 전한다. 그림이 무거워도 사이트는 안 멈춘다.
   *   Worker 를 못 쓰는 브라우저: 정지 화면으로 시작(자동회전·흐르는 빛 끔) · 끄는 동안엔 흐린 단계 생략(lod) ·
   *   손을 떼면 전부 한 번 그린다. */
  /* 별도 스레드는 ★이 파일 자체★ 로 띄운다(같은 출처). blob: 주소는 사이트 CSP(script-src 'self')가 막는다 —
     막히면 캔버스를 넘긴 뒤 스레드가 죽어 그림이 빈칸이 된다. 이 파일이 워커 안에서 읽히면 맨 끝에서 omWorkerMain 을 켠다. */
  const OM_SELF=(typeof document!=='undefined'&&document.currentScript&&document.currentScript.src)||'/neural-observatory.js';
  function omWorkerMain(){
    let cv=null,ctx=null,sc=null,d=null,W=1,H=1,run=true,t=0,last=0,dirty=true,draws=0,ms=0,gap=33,seen=0,pending=false,cost=0;
    const v={yaw:.4,pitch:.32,zoom:1,panX:0,panY:0,selected:-1,motion:true,spin:true,glow:true,small:null,lite:false,lod:false};
    const raf=typeof self.requestAnimationFrame==='function'?f=>self.requestAnimationFrame(f):f=>setTimeout(()=>f(performance.now()),16);
    const kick=()=>{if(!pending&&run&&sc){pending=true;raf(loop);}};
    function loop(now){pending=false;if(!run||!sc)return;
      // [V33.448] ★느린 기기는 장면 간격을 늘린다★ — 그리기에 걸린 시간의 2.5배를 쉬어 이 스레드가 한 코어를 다 쓰지 않게(아이폰: 발열·페이지 전체 끊김)
      if(now-last>=(dirty&&!(v.motion||v.spin)?Math.max(16,cost*1.5):Math.max(1000/30,cost*2.5))){const dt=Math.min(.1,(now-last)/1000);
        // [V33.448] 장면 간격(gap)은 ★쉬었다 온 간격(0.25초 넘음)은 빼고★ 잰다 — 스크롤 멈춤·화면 밖·절전 뒤의 긴 간격이 섞여
        //   멀쩡한 기기에서 번짐과 흐린 선을 꺼 버렸다("옛날 디자인처럼 보인다"). 그리기 시간(cost)은 래스터를 못 재서 간격이 주 신호다.
        const iv=now-last;if(last&&iv<250&&(v.motion||v.spin)){gap=gap*.8+iv*.2;if(++seen>8&&(gap>55||cost>40)&&!v.lite){v.lite=true;v.glow=false;postMessage({type:'lite'});}if(seen>8&&(gap>110||cost>80))v.slow=true;}
        v.lod=!!v.slow&&(v.motion||v.spin);   // 아주 느린 기기: 움직이는 동안만 흐린 단계 생략 · 멈추면 전부
        last=now;if(v.motion||v.spin)t+=dt;if(v.spin)v.yaw+=dt*.08;
        if(dirty||v.motion||v.spin){const t0=performance.now(),r=drawCore(ctx,sc,v,W,H,t),dm=performance.now()-t0;draws++;ms+=dm;cost=cost?cost*.8+dm*.2:dm;dirty=false;
          if(draws%10===1)postMessage({type:'stats',nodes:sc.n,edges:r.lines,drawn:r.drawn,strokes:r.strokes,draws,averageMs:(ms/draws).toFixed(2)});}}
      if(dirty||v.motion||v.spin)kick();}
    // 같은 크기면 캔버스를 다시 잡지 않는다 — 폭·높이를 대입하는 것만으로 캔버스가 비워지고 상태가 풀린다(사파리 결함의 방아쇠)
    function size(m){const cw=Math.round(m.w*m.ratio),ch=Math.round(m.h*m.ratio);W=m.w;H=m.h;
      if(cv.width!==cw)cv.width=cw;if(cv.height!==ch)cv.height=ch;ctx.setTransform(cw/W,0,0,ch/H,0,0);
      const sw=Math.max(1,Math.round(W/2)),sh=Math.max(1,Math.round(H/2));   // [V33.444] 보조 캔버스는 재사용(크기만) — 매번 새로 만들면 캔버스 메모리가 쌓인다
      if(v.small){if(v.small.width!==sw)v.small.width=sw;if(v.small.height!==sh)v.small.height=sh;}else v.small=new OffscreenCanvas(sw,sh);}
    self.onmessage=e=>{const m=e.data;
      if(m.type==='init'){cv=m.canvas;ctx=cv.getContext('2d');d=m.d;Object.assign(v,m.flags||{});size(m);sc=omniCore(d,m.st||null);postMessage({type:'ready'});}
      else if(m.type==='scene'){if(!d)return;sc=omniCore(d,m.st);v.selected=-1;}
      else if(m.type==='size'){if(!cv)return;size(m);}
      else if(m.type==='flags'){Object.assign(v,m.flags);}
      else if(m.type==='orbit'){v.yaw-=m.dx*.006;v.pitch=clamp(v.pitch+m.dy*.006,-1.3,1.3);v.spin=false;}
      else if(m.type==='pan'){v.panX+=m.dx;v.panY+=m.dy;}
      else if(m.type==='zoom'){v.zoom=clamp(v.zoom*m.f,.5,8);}
      else if(m.type==='reset'){v.zoom=1;v.panX=v.panY=0;v.yaw=.4;v.pitch=.32;}
      else if(m.type==='select'){v.selected=m.id;}
      else if(m.type==='pick'){let hit=-1,best=200;if(sc&&sc.SX)for(let i=0;i<sc.n;i++){if(sc.kind[i]>4)continue;const dd=(sc.SX[i]-m.x)**2+(sc.SY[i]-m.y)**2;if(dd<best){best=dd;hit=i;}}
        postMessage({type:'picked',id:hit});return;}
      else if(m.type==='run'){run=m.on;}
      else if(m.type==='count'){let c=0;if(sc)for(let j=0;j<sc.la.length;j++)if(sc.la[j]===m.id||sc.lb[j]===m.id)c++;postMessage({type:'count',id:m.id,n:c});return;}
      else if(m.type==='dispose'){   // [V33.444] 캔버스 메모리를 즉시 돌려주고 스스로 닫는다(아이폰 사파리는 캔버스 메모리 한도를 넘으면 탭을 죽인다)
        run=false;sc=null;try{if(cv){cv.width=0;cv.height=0;}if(v.small){v.small.width=0;v.small.height=0;}}catch(e){}try{self.close();}catch(e){}return;}
      dirty=true;kick();};
  }
  function mountCore(host,config){
    const d=config.data||{},reduced=matchMedia('(prefers-reduced-motion: reduce)');
    host.innerHTML='<section class="nerve-room"><header class="nerve-heading"><div><span class="nerve-kicker">HOLOGRAPHIC NEURAL CORE</span><h3>모든 뉴런 · 모든 가중치 · 모든 나무 분기</h3></div><span class="nerve-status">3D / ALL PARAMETERS</span></header><div class="nerve-controls"></div><div class="nerve-viewport omni-core-vp"><canvas tabindex="0" role="img" aria-label="OMNI 신경망과 나무 숲의 모든 파라미터를 금빛 선으로 그린 3D 구조"></canvas><div class="nerve-corner">DRAG TO ORBIT</div></div><div class="nerve-layers"></div><div class="nerve-inspector"><label>층 <select class="nerve-layer"></select></label><label>노드 <select class="nerve-node"></select></label><output aria-live="polite"></output></div><footer class="nerve-note">선 밝기 = 실제 값의 크기(신경망 |가중치| · 나무 잎 값). 유리 껍질·아크릴 띠·반사광·흐르는 빛·홍채·빛줄기는 장식이며 값이 없습니다.</footer></section>';
    const room=host.firstElementChild,vp=room.querySelector('.nerve-viewport');let canvas=room.querySelector('canvas');
    const controls=room.querySelector('.nerve-controls'),info=room.querySelector('output'),layerSel=room.querySelector('.nerve-layer'),nodeSel=room.querySelector('.nerve-node');
    // 별도 스레드를 쓸 수 있나 — 안 되면 대체 경로(메인 스레드 · 정지 화면 시작)
    let wk=null;
    if(!config.noWorker&&typeof Worker==='function'&&typeof OffscreenCanvas==='function'&&canvas.transferControlToOffscreen){
      try{wk=new Worker(config.workerUrl||OM_SELF);}catch(e){wk=null;}
    }
    let still=!wk;   // 대체 경로는 정지 화면으로 시작 — 계속 그리면 그게 곧 멈춤이다
    const v={yaw:.4,pitch:.32,zoom:1,panX:0,panY:0,selected:-1,motion:!reduced.matches&&!still,spin:!reduced.matches&&!still,glow:true,small:null,lite:false,lod:false};
    canvas.dataset.mode=wk?'worker':'main';
    let scrolling=false,scrT=0,mcost=0,sc=null,ctx=null,raf=0,last=0,t=0,w=1,h=1,dead=false,visible=true,draws=0,ms=0,dirty=true,gap=33,seen=0,idleT=0,gc=0;
    const send=(m,tr)=>{if(wk)wk.postMessage(m,tr||[]);};
    const btn=(txt,fn,pr)=>{const b=document.createElement('button');b.type='button';b.textContent=txt;if(pr!=null)b.setAttribute('aria-pressed',pr);b.onclick=()=>{fn(b);flags();dirty=true;wake();};controls.append(b);return b;};
    const flags=()=>send({type:'flags',flags:{motion:v.motion,spin:v.spin,glow:v.glow}});
    const mot=btn('신호 움직임',b=>{v.motion=!v.motion;b.setAttribute('aria-pressed',v.motion);},v.motion);
    const spin=btn('자동회전',b=>{v.spin=!v.spin;b.setAttribute('aria-pressed',v.spin);},v.spin);
    const glowBtn=btn('빛 번짐',b=>{v.glow=!v.glow;b.setAttribute('aria-pressed',v.glow);},v.glow);
    btn('−',()=>{v.zoom=clamp(v.zoom/1.25,.5,8);send({type:'zoom',f:1/1.25});}).setAttribute('aria-label','축소');
    btn('+',()=>{v.zoom=clamp(v.zoom*1.25,.5,8);send({type:'zoom',f:1.25});}).setAttribute('aria-label','확대');
    btn('화면 맞춤',()=>{v.zoom=1;v.panX=v.panY=0;v.yaw=.4;v.pitch=.32;send({type:'reset'});});
    const fmt=x=>Number(x).toLocaleString('ko-KR');
    function build(st){
      sc=omniCore(d,st,{noLines:!!wk});v.selected=-1;   // 워커가 그리면 메인은 선 3.7만 개를 만들 이유가 없다(이름·묶음·값만)
      const lr=room.querySelector('.nerve-layers');lr.replaceChildren();layerSel.replaceChildren();
      sc.groups.forEach((g,q)=>{layerSel.add(new Option(g.label+' · '+g.ids.length,String(q)));
        const b=document.createElement('button');b.type='button';b.textContent=g.label+' / '+fmt(g.ids.length);b.onclick=()=>inspect(g.ids[0]);lr.append(b);});
      const I=sc.info,sum=document.createElement('button');sum.type='button';sum.disabled=true;
      sum.textContent=I.full?('가중치 '+fmt(I.params)+'개 전부 · 나무 '+fmt(I.trees)+'그루 · 분기 '+fmt(I.splits)+'개 전부'):'대표 연결만(구조 전부를 아직 못 받았다)';lr.append(sum);
      populate();info.textContent=(I.full?'신경망 '+I.sizes.join('→')+' · 가중치 '+fmt(I.params)+'개와 나무 분기 '+fmt(I.splits)+'개를 전부 한 줄씩 그립니다. 점을 누르면 그 점의 선만 밝게 남습니다.':'구조 전부를 받는 중이거나 없습니다 — 대표 연결(뉴런마다 상위 3개)만 그립니다.')
        +(still?' (이 브라우저는 별도 스레드 그리기를 못 해 정지 화면으로 시작합니다 — 끌어서 돌려 보세요)':'');
      dirty=true;wake();
    }
    function populate(){nodeSel.replaceChildren();const g=sc.groups[+layerSel.value||0];if(!g)return;g.ids.forEach(id=>nodeSel.add(new Option(sc.name[id].split(' — ')[0],String(id))));}
    function inspect(id){v.selected=id;send({type:'select',id});const g=sc.groups.findIndex(x=>x.ids.includes(id));if(g>=0){layerSel.value=String(g);populate();nodeSel.value=String(id);}
      const vv=sc.val[id],base=sc.name[id],tail=(vv===vv?' · 세기 '+(vv*100).toFixed(0)+'%(최대 대비)':' · 값 없음');
      if(wk){info.textContent=base+tail;send({type:'count',id});}   // 선은 워커에만 있다 — 개수는 워커가 센다
      else{let cnt=0;for(let j=0;j<sc.la.length;j++)if(sc.la[j]===id||sc.lb[j]===id)cnt++;info.textContent=base+' · 닿은 선 '+fmt(cnt)+'개'+tail;}
      dirty=true;wake();}
    layerSel.onchange=()=>{populate();inspect(+nodeSel.value);};nodeSel.onchange=()=>inspect(+nodeSel.value);
    // ── 대체 경로(메인 스레드) 그리기 ──
    function frame(){const t0=performance.now();const r=drawCore(ctx,sc,v,w,h,t),dm=performance.now()-t0;draws++;ms+=dm;mcost=mcost?mcost*.8+dm*.2:dm;
      canvas.dataset.nodes=sc.n;canvas.dataset.edges=r.lines;canvas.dataset.drawn=r.drawn;canvas.dataset.strokes=r.strokes;canvas.dataset.draws=draws;canvas.dataset.averageMs=(ms/draws).toFixed(2);dirty=false;}
    function tick(now){raf=0;if(dead||wk||!sc)return;if(!host.isConnected){destroy();return;}if(!visible||document.hidden)return;
      if(now-last>=1000/30){const dt=Math.min(.1,(now-last)/1000);
        const iv=now-last;if(last&&iv<250&&(v.motion||v.spin)){gap=gap*.8+iv*.2;if(++seen>8&&(gap>55||mcost>40)&&!v.lite){v.lite=true;v.glow=false;glowBtn.setAttribute('aria-pressed','false');canvas.dataset.lite='1';}if(seen>8&&(gap>110||mcost>80))v.slow=true;}
        if(v.slow&&!ptr.size)v.lod=v.motion||v.spin;
        last=now;if(v.motion||v.spin)t+=dt;if(v.spin)v.yaw+=dt*.08;if(dirty||v.motion||v.spin)frame();}
      if(dirty||v.motion||v.spin)raf=requestAnimationFrame(tick);}
    function wake(){if(wk||dead||raf||!visible||document.hidden||scrolling)return;raf=requestAnimationFrame(tick);}
    // ── 별도 스레드 경로 ──
    if(wk){
      wk.onmessage=e=>{const m=e.data;if(dead)return;
        if(m.type==='ready'){alive=true;clearTimeout(wdog);canvas.dataset.ready='1';}
        else if(m.type==='stats'){for(const k of ['nodes','edges','drawn','strokes','draws','averageMs'])canvas.dataset[k]=m[k];}
        else if(m.type==='picked'){if(m.id>=0)inspect(m.id);else{v.selected=-1;send({type:'select',id:-1});}}
        else if(m.type==='count'){if(m.id===v.selected&&sc){const vv=sc.val[m.id];info.textContent=sc.name[m.id]+' · 닿은 선 '+fmt(m.n)+'개'+(vv===vv?' · 세기 '+(vv*100).toFixed(0)+'%(최대 대비)':' · 값 없음');}}
        else if(m.type==='lite'){v.lite=true;v.glow=false;glowBtn.setAttribute('aria-pressed','false');canvas.dataset.lite='1';}};
      wk.onerror=()=>toMain('error');
    }else ctx=canvas.getContext('2d');
    // 스레드가 죽거나(스크립트 못 읽음 · 보안정책) 8초 안에 ★살아 있다(ready)★ 는 답이 없으면 → 캔버스를 새로 만들어 메인 스레드 정지 화면으로.
    // [V33.440] 예전엔 '첫 장면' 을 기다렸다 — 그림이 화면 밖이면 워커는 일부러 안 그리는데(절전) 그걸 실패로 보고
    //   멀쩡한 워커를 끄고 메인 스레드로 떨어졌다(운영 실측 workerFail=timeout). 그게 '멈춤 · 디자인과 다름' 의 원인이었다.
    let alive=false,wdog=0,lastSt=config.structure||null;
    function toMain(why){if(!wk||dead)return;try{wk.terminate();}catch(e){}wk=null;clearTimeout(wdog);
      const nc=canvas.cloneNode(false);canvas.replaceWith(nc);canvas=nc;bind();canvas.dataset.mode='main';canvas.dataset.workerFail=why;
      ctx=canvas.getContext('2d');still=true;v.motion=v.spin=false;mot.setAttribute('aria-pressed','false');spin.setAttribute('aria-pressed','false');
      build(lastSt);sizeMain();dirty=true;wake();}
    function sizeMain(){const ratio=Math.min(devicePixelRatio||1,w<600?1.5:2);
      canvas.width=Math.round(w*ratio);canvas.height=Math.round(h*ratio);ctx.setTransform(ratio,0,0,ratio,0,0);
      if(!v.small)v.small=document.createElement('canvas');const sw=Math.max(1,Math.round(w/2)),sh=Math.max(1,Math.round(h/2));/* 반 해상도 — 번짐이 좁고 맑다 · 재사용 */
      if(v.small.width!==sw)v.small.width=sw;if(v.small.height!==sh)v.small.height=sh;}
    // [V33.444] 크기 변화는 ★모아서 한 번★ · 2px 미만은 무시 — 휴대폰은 주소창이 들락날락할 때마다 크기가 바뀌고,
    //   그때마다 캔버스를 다시 잡으면(수 MB) 아이폰 사파리의 캔버스 메모리 한도를 넘겨 탭이 죽는다.
    let rzT=0,rw=0,rh=0,sized=false;
    const applySize=()=>{const r=vp.getBoundingClientRect(),nw=Math.max(1,Math.round(r.width)),nh=Math.max(1,Math.round(r.height));
      if(sized&&Math.abs(nw-rw)<2&&Math.abs(nh-rh)<2)return;sized=true;rw=nw;rh=nh;w=nw;h=nh;
      if(wk){send({type:'size',w,h,ratio:Math.min(devicePixelRatio||1,w<600?1.5:2)});return;}
      sizeMain();dirty=true;wake();};
    const ro=new ResizeObserver(()=>{if(!sized){applySize();return;}clearTimeout(rzT);rzT=setTimeout(applySize,150);});
    // [V33.448] ★페이지를 굴리는 동안은 그리지 않는다★ — 사용자: "화면 움직이면 이상하게 보인다 · 멈춘다". 스크롤 중엔 마지막 장면을
    //   그대로 두고(GPU·코어를 스크롤에 양보) 손을 떼고 0.22초 뒤 다시 돈다.
    const runOn=()=>visible&&!document.hidden&&!scrolling;
    const onScroll=e=>{const tg=e&&e.target;if(tg&&tg!==document&&!(tg.contains&&tg.contains(vp)))return;   // 그림을 품은 스크롤(페이지)만 — 카드 줄 가로 넘김 등은 무시
      if(!scrolling){scrolling=true;send({type:'run',on:false});if(raf){cancelAnimationFrame(raf);raf=0;}}
      clearTimeout(scrT);scrT=setTimeout(()=>{scrolling=false;send({type:'run',on:runOn()});wake();},220);};
    const io=new IntersectionObserver(e=>{visible=e[0].isIntersecting;send({type:'run',on:runOn()});if(!visible&&raf){cancelAnimationFrame(raf);raf=0;}wake();});
    const vis=()=>{send({type:'run',on:runOn()});if(document.hidden&&raf){cancelAnimationFrame(raf);raf=0;}else wake();};
    const ptr=new Map();let moved=false;
    const settle=()=>{clearTimeout(idleT);idleT=setTimeout(()=>{if(v.lod){v.lod=false;dirty=true;wake();}},180);};   // 대체 경로: 손을 떼면 전부 다시
    function bind(){
    canvas.onpointerdown=e=>{canvas.setPointerCapture(e.pointerId);ptr.set(e.pointerId,{x:e.clientX,y:e.clientY});moved=false;v.spin=false;spin.setAttribute('aria-pressed','false');flags();};
    canvas.onpointermove=e=>{const o=ptr.get(e.pointerId);if(!o)return;const dx=e.clientX-o.x,dy=e.clientY-o.y,other=[...ptr.entries()].find(([k])=>k!==e.pointerId)?.[1];
      if(other){const b0=Math.hypot(o.x-other.x,o.y-other.y),b1=Math.hypot(e.clientX-other.x,e.clientY-other.y);if(b0>4){v.zoom=clamp(v.zoom*b1/b0,.5,8);send({type:'zoom',f:b1/b0});}}
      else if(e.shiftKey){v.panX+=dx;v.panY+=dy;send({type:'pan',dx,dy});}else{v.yaw-=dx*.006;v.pitch=clamp(v.pitch+dy*.006,-1.3,1.3);send({type:'orbit',dx,dy});}
      if(Math.abs(dx)+Math.abs(dy)>2){moved=true;if(!wk){v.lod=true;settle();}}ptr.set(e.pointerId,{x:e.clientX,y:e.clientY});dirty=true;wake();};
    canvas.onpointerup=e=>{ptr.delete(e.pointerId);if(moved||!sc)return;const r=canvas.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top;
      if(wk){send({type:'pick',x,y});return;}
      if(!sc.SX)return;let hit=-1,best=200;
      for(let i=0;i<sc.n;i++){if(sc.kind[i]>4)continue;const dd=(sc.SX[i]-x)**2+(sc.SY[i]-y)**2;if(dd<best){best=dd;hit=i;}}
      if(hit>=0)inspect(hit);else{v.selected=-1;dirty=true;wake();}};
    canvas.onpointercancel=e=>ptr.delete(e.pointerId);
    canvas.onwheel=e=>{if(!e.ctrlKey)return;e.preventDefault();const f=Math.exp(-e.deltaY*.002);v.zoom=clamp(v.zoom*f,.5,8);send({type:'zoom',f});if(!wk){v.lod=true;settle();}dirty=true;wake();};
    canvas.onkeydown=e=>{const k=e.key;if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','-','Home','Escape'].includes(k))return;e.preventDefault();
      if(k==='Home'){v.zoom=1;v.panX=v.panY=0;send({type:'reset'});}else if(k==='Escape'){v.selected=-1;send({type:'select',id:-1});}
      else if(k==='+'||k==='-'){const f=k==='+'?1.2:1/1.2;v.zoom=clamp(v.zoom*f,.5,8);send({type:'zoom',f});}
      else{const dx=k==='ArrowLeft'?16.7:k==='ArrowRight'?-16.7:0,dy=k==='ArrowUp'?-16.7:k==='ArrowDown'?16.7:0;v.yaw-=dx*.006;v.pitch=clamp(v.pitch+dy*.006,-1.3,1.3);send({type:'orbit',dx,dy});}dirty=true;wake();};
    }
    bind();
    const red=()=>{if(reduced.matches){v.motion=v.spin=false;mot.setAttribute('aria-pressed','false');spin.setAttribute('aria-pressed','false');flags();}dirty=true;wake();};
    function destroy(){if(dead)return;dead=true;cancelAnimationFrame(raf);clearTimeout(idleT);clearInterval(gc);clearTimeout(wdog);clearTimeout(rzT);clearTimeout(scrT);ro.disconnect();io.disconnect();document.removeEventListener('visibilitychange',vis);document.removeEventListener('scroll',onScroll,true);reduced.removeEventListener('change',red);
      // [V33.444] ★캔버스 메모리를 바로 돌려준다★ — 버린 캔버스를 쓰레기 수집에 맡기면 다시 그릴 때마다 쌓인다(아이폰 사파리는 한도를 넘으면 탭을 죽인다)
      if(wk){const w0=wk;wk=null;try{w0.postMessage({type:'dispose'});}catch(e){}setTimeout(()=>{try{w0.terminate();}catch(e){}},300);}
      else{try{canvas.width=0;canvas.height=0;}catch(e){}}
      try{if(v.small){v.small.width=0;v.small.height=0;v.small=null;}}catch(e){}
      sc=null;host.__omniLive=false;if(active?.destroy===destroy)active=null;}
    active={destroy};host.__omniLive=true;
    /* [V33.448] ★구조를 받은 뒤에 그리기 시작한다★ — 운영 실측(아이폰): 구조 응답이 5초 걸리는 동안 '대표 연결만' 그린 성긴 그림이
       떠 있다가 바뀌었다(사용자: "옛날 디자인으로 보인다"). 이제:
         · 받은 구조를 브라우저에 보관(같은 학습 판 열쇠) → 다음부터는 열자마자 전부 그린다. 뒤에서 새로 받아 다르면 갈아 끼운다.
         · 보관본이 없으면 '구조 불러오는 중' 만 띄우고 기다린다(10초 넘거나 실패하면 그때 대표 연결로). */
    const ck=config.cacheKey?'omniSt:'+config.cacheKey:null;
    let cachedTxt=null,started=false,stT=0,st0=config.structure||null;
    if(!st0&&ck){try{cachedTxt=localStorage.getItem(ck);if(cachedTxt){const j=JSON.parse(cachedTxt);if(j&&j.ok)st0=j;else cachedTxt=null;}}catch(e){cachedTxt=null;}}
    function start(st){if(started||dead)return;started=true;clearTimeout(stT);lastSt=st;build(st);
      if(wk){const r=vp.getBoundingClientRect();w=Math.max(1,r.width);h=Math.max(1,r.height);const off=canvas.transferControlToOffscreen();
        send({type:'init',canvas:off,d,st:st||null,w,h,ratio:Math.min(devicePixelRatio||1,w<600?1.5:2),flags:{motion:v.motion,spin:v.spin,glow:v.glow}},[off]);
        wdog=setTimeout(()=>{if(!alive)toMain('timeout');},8000);}}
    function keep(txt){if(!ck)return;try{for(let i=localStorage.length-1;i>=0;i--){const k=localStorage.key(i);if(k&&k.indexOf('omniSt:')===0&&k!==ck)localStorage.removeItem(k);}localStorage.setItem(ck,txt);}catch(e){}}
    if(st0)start(st0);
    else{info.textContent='구조 전부(가중치 · 나무 분기)를 불러오는 중…';stT=setTimeout(()=>start(null),10000);}
    ro.observe(vp);io.observe(vp);document.addEventListener('visibilitychange',vis);document.addEventListener('scroll',onScroll,{capture:true,passive:true});reduced.addEventListener('change',red);
    // 화면이 없는 채로 남으면 스레드를 거둔다(다른 탭으로 옮겨 host 가 지워진 경우)
    gc=setInterval(()=>{if(!host.isConnected)destroy();},2000);
    if(!config.structure&&typeof fetch==='function')fetch(config.structureUrl||'/api/omni-structure').then(r=>r.ok?r.text():null).then(txt=>{
        if(dead)return;let st=null;try{st=txt?JSON.parse(txt):null;}catch(e){}
        if(!st||!st.ok){start(null);return;}
        keep(txt);if(!started){start(st);return;}
        if(txt===cachedTxt)return;   // 보관본과 같으면 다시 짓지 않는다
        lastSt=st;build(st);send({type:'scene',st});}).catch(()=>{start(null);});
    else if(!st0)start(null);
    return active;
  }
  let active=null;
  function mount(host,config){
    if(active) active.destroy();
    if(!host) return;
    if(config&&config.kind==='omni') return mountCore(host,config);   // [V33.437] OMNI 는 전용 엔진(아래 옛 엔진은 SEQ·밀집층 전용)
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
  root.NeuralObservatory={mount,dense,sequence,attention,project,omniCore,drawCore,omWorkerMain};
  // [V33.439] 이 파일이 ★Worker 안에서★ 읽히면(OMNI 별도 스레드) 그리기 루프를 켠다 — 창에서는 아무 일도 없다
  if(typeof WorkerGlobalScope!=='undefined'&&typeof self!=='undefined'&&self instanceof WorkerGlobalScope)omWorkerMain();
})(typeof window!=='undefined'?window:globalThis);
