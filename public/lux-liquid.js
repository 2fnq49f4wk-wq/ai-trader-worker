/* [V33.869] ★리퀴드 글라스 = WebGL★ (사용자 11/26 "CSS 로 하니까 유리가 아니라 플라스틱 느낌. CSS 말고 다른 걸로")
   V33.866 의 SVG 굴절(backdrop-filter:url) + CSS 빛 테두리 대신, 유리 판 한 장을 셰이더로 '그림'으로 만든다.
   방법: 공유 WebGL 컨텍스트 하나(웹 워커 안 OffscreenCanvas — 메인 스레드 0) → 카드마다 크기에 맞춰 한 번 그린 뒤 ImageBitmap 으로 넘겨
   카드 안 맨 뒤(z-index:-1 · 그림자 여백만큼 바깥으로) 2D 캔버스에 붙인다(shadow DOM 안 — 카드 안 querySelector('canvas') 와 안 섞인다).
   셰이더: 둥근 사각형 SDF · 볼록 베벨 높이 → 법선 · 뒤 배경 굴절(배경 오로라를 CSS 와 '같은 수식'으로 계산 — 아래 LAYERS 로
   html::before 도 같은 값으로 만든다) + 가장자리 색분산 · 프레넬 스튜디오 조명 반사 · 위왼쪽 스페큘러 · 얇은 림 · 두께 그림자 · 바깥 그림자 · 본체 틴트.
   ★성능★: 그림은 카드와 같이 스크롤된다(프레임마다 다시 그리지 않는다). 다시 그리는 때 = 크기 변화 · 스크롤이 멈춘 뒤 40px 넘게 움직인 것 ·
   테마 전환 · 창 크기. 유휴 시간에 한 번에 몇 장씩(폰 2 · 데스크톱 4) · 보이는 카드만 · 큰 카드는 dpr 1 · 캔버스 픽셀 총량 상한.
   읽기(getBoundingClientRect)는 모아서 먼저, 쓰기는 뒤에 — 강제 배치 없음. 크기는 ResizeObserver 값.
   WebGL 이 없거나 잃으면 lg-gl 을 떼어 종전 CSS 유리로 돌아간다. localStorage luxGlass=off 로 끔. */
(function () {
  "use strict";
  var D = document, H = D.documentElement, W = window;
  var RT = false; try { RT = matchMedia("(prefers-reduced-transparency: reduce)").matches; } catch (e) {}
  H.classList.add("lg-on");
  try { if (localStorage.getItem("luxGlass") === "off") return; } catch (e) {}
  if (RT || !("ResizeObserver" in W) || !("IntersectionObserver" in W)) return;

  /* 배경 오로라 — 위에서부터(맨 앞 = 맨 위). [cx%, cy%, rx vmax, ry vmax, r, g, b, a] · 투명은 70% 지점(CSS 와 같은 식) */
  var LAYERS = {
    dark: { base: ["#0b1326", "#0a1122", "#070d1b"], l: [
      [30, 34, 16, 13, 70, 130, 255, .34], [74, 52, 11, 10, 40, 200, 190, .24], [52, 86, 14, 12, 130, 100, 255, .30],
      [88, 12, 9, 8, 120, 170, 255, .24], [6, 0, 60, 50, 60, 90, 170, .34], [100, 10, 50, 44, 70, 100, 180, .26], [60, 110, 60, 50, 40, 60, 120, .26]] },
    light: { base: ["#f4f8ff", "#e8f0fc", "#eef4ff"], l: [
      [12, 8, 70, 22, 59, 130, 246, .22], [96, 30, 60, 18, 31, 107, 255, .16], [30, 78, 80, 24, 96, 165, 250, .20],
      [100, 105, 60, 20, 59, 130, 246, .18], [70, 40, 18, 14, 120, 90, 255, .10]] }
  };
  function bgCss(T) {
    var s = T.l.map(function (L) { return "radial-gradient(" + L[2] + "vmax " + L[3] + "vmax at " + L[0] + "% " + L[1] + "%,rgba(" + L[4] + "," + L[5] + "," + L[6] + "," + L[7] + "),transparent 70%)"; });
    s.push("linear-gradient(180deg," + T.base[0] + "," + T.base[1] + " 55%," + T.base[2] + ")");
    return s.join(",") + "!important";
  }


  /* ── WebGL 은 워커 안에서(OffscreenCanvas) — 셰이더 컴파일·그리기·GPU 대기가 메인 스레드를 막지 않는다. 메인은 받은 ImageBitmap 을 붙이기만. ── */
  if (typeof OffscreenCanvas === "undefined" || typeof Worker === "undefined" || typeof ImageBitmapRenderingContext === "undefined" || !W.Blob || !W.URL) return;
  var VS = "attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}";
  var FSB =
    "uniform vec2 uC,uS,uP,uV;uniform float uM,uR,uDk,uFl,uDpr,uN,uSh;uniform vec4 uL[7],uK[7];uniform vec3 uB0,uB1,uB2;\n" +
    "float sd(vec2 p,vec2 b,float r){vec2 q=abs(p)-b+r;return length(max(q,0.))+min(max(q.x,q.y),0.)-r;}\n" +
    "vec3 bg(vec2 v){float t=clamp(v.y/uV.y,0.,1.);vec3 c=t<.55?mix(uB0,uB1,t/.55):mix(uB1,uB2,(t-.55)/.45);float vm=max(uV.x,uV.y)*.01;\n" +
    " for(int i=6;i>=0;i--){if(float(i)>=uN)continue;vec4 L=uL[i];vec2 d=(v-L.xy*uV*.01)/(L.zw*vm);float a=uK[i].a*(1.-clamp(length(d)/.7,0.,1.));c=mix(c,uK[i].rgb,a);}return c;}\n" +
    // [V33.871] 본체에 빛과 깊이(사용자 "가운데가 비어 보이고 플라스틱 뚜껑") — 평평한 남색 칠 → 굴절된 배경이 비치고 · 빛 쪽(위왼쪽)에서 안으로 번지는 부피광 ·
    // 가장자리에서 안으로 스며드는 빛 · 아래로 갈수록 아주 조금 깊어짐. 테두리는 빛 닿는 쪽만 얇게(나머지는 거의 안 보임) · 안쪽 어두운 선 제거.
    "vec3 shade(vec3 c,vec2 f,float dd,float bz){float l=dot(c,vec3(.299,.587,.114));c=clamp(mix(vec3(l),c,1.35),0.,1.);\n" +
    " vec3 tn=uDk>.5?vec3(.03,.045,.095):vec3(1.);c=mix(c,tn,uDk>.5?.20:.42);\n" +
    " vec2 q=(f-uM)/uS;float k=clamp(1.-dot(q,vec2(.62,.48)),0.,1.);c+=k*k*(uDk>.5?vec3(.055,.07,.095):vec3(.03,.035,.045));\n" +
    " c+=exp(-dd/(bz*2.4))*(uDk>.5?vec3(.045,.06,.09):vec3(.035,.04,.05));\n" +
    " c*=1.-smoothstep(.5,1.,q.y)*(uDk>.5?.07:.03);return c;}\n" +
    "void main(){vec2 f=vec2(gl_FragCoord.x,uC.y*uDpr-gl_FragCoord.y)/uDpr;vec2 hs=uS*.5;vec2 pc=f-uM-hs;float r=min(uR,min(hs.x,hs.y));\n" +
    " float d=sd(pc,hs,r);float aa=1./uDpr;float A=clamp(.5-d/aa,0.,1.);\n" +
    // 바깥 그림자: 넓고 부드러운 것 + 바닥 접촉 + 아주 옅은 윤곽
    " float sh=(1.-smoothstep(-16.,uM*.9,sd(pc-vec2(0.,9.),hs-3.,r)))*mix(.13,.40,uDk)+(1.-smoothstep(-1.,3.,sd(pc-vec2(0.,1.5),hs,r)))*mix(.05,.16,uDk);sh*=uSh;\n" +
    " sh+=(1.-smoothstep(0.,1.2,d))*(uDk>.5?.22:.08);\n if(A<=0.){gl_FragColor=vec4(0.,0.,0.,sh);return;}\n" +
    " float bz=clamp(min(uS.x,uS.y)*.14,8.,24.);float dn=(fract(sin(dot(gl_FragCoord.xy,vec2(12.9898,78.233)))*43758.5453)-.5)/255.;\n" +
    // 안쪽(대부분의 픽셀)은 법선이 없다 → 렌즈처럼 살짝 줄인 배경 + 본체 빛만
    " if(-d>bz*1.75&&uFl<.5){vec2 v0=uP+hs+(f-uM-hs)*.9;vec3 c0=shade(bg(v0),f,-d,bz)+dn;gl_FragColor=vec4(clamp(c0,0.,1.),1.);return;}\n" +
    " vec2 e=vec2(.5,0.);vec2 g=vec2(sd(pc+e.xy,hs,r)-sd(pc-e.xy,hs,r),sd(pc+e.yx,hs,r)-sd(pc-e.yx,hs,r));g=g/max(length(g),1e-4);\n" +
    " float t=clamp(-d/bz,0.,1.);float u=1.-t;\n" +
    // 볼록 베벨 기울기 → 법선(전보다 완만 — 두꺼운 테 대신 매끈한 곡면)
    " float sl=min(pow(u,3.)/pow(max(1.-pow(u,4.),1e-3),.75),5.);vec3 N=normalize(vec3(g*sl*.6,1.));\n" +
    " vec2 v=uP+f-uM;vec2 cc=uP+hs;v=cc+(v-cc)*.9;vec2 o=-N.xy*bz*2.8;vec3 c;\n" +
    " if(uFl<.5)c=vec3(bg(v+o*.88).r,bg(v+o).g,bg(v+o*1.14).b);\n" +
    " else c=uDk>.5?vec3(.08,.10,.17):vec3(.96,.97,1.);\n" +
    " c=shade(c,f,-d,bz);\n" +
    // 프레넬 — 스튜디오 조명(약하게: 곡면이 빛을 '받는' 정도)
    " vec3 R=reflect(vec3(0.,0.,-1.),N);float fr=pow(1.-N.z,1.6);\n" +
    " float env=.10+.75*smoothstep(-.15,.75,-R.y)+.45*exp(-pow((R.x+.6)*3.2,2.))+.2*exp(-pow((R.x-.7)*4.,2.))*smoothstep(-.2,.4,R.y);\n" +
    " c=mix(c,vec3(env)*(uDk>.5?vec3(.86,.92,1.):vec3(1.)),clamp(fr*(uDk>.5?.22:.30),0.,.9));\n" +
    " vec3 Ld=normalize(vec3(-.45,-.8,.45));float sp=pow(max(dot(N,normalize(Ld+vec3(0.,0.,1.))),0.),70.);c+=sp*(uDk>.5?.30:.25);\n" +
    // 두께: 아래·오른쪽 곡면은 살짝 어둡고 아래쪽 안으로 번진 빛
    " float bd=smoothstep(bz*1.7,0.,-d);c*=1.-bd*max(dot(g,vec2(.45,.9)),0.)*(uDk>.5?.12:.06);\n" +
    " c+=bd*max(dot(g,vec2(.25,.97)),0.)*smoothstep(0.,bz*.6,-d)*(uDk>.5?vec3(.05,.08,.13):vec3(.03,.05,.08));\n" +
    // 테두리 빛은 빛 닿는 쪽(위왼쪽)과 반대편 반사(아래오른쪽)에만 — 고르게 두른 테가 '뚜껑' 처럼 보였다
    " float rim=(1.-smoothstep(.0,1.3,-d));float rl=.06+.9*pow(max(dot(g,vec2(-.6,-.8)),0.),2.)+.35*pow(max(dot(g,vec2(.6,.8)),0.),3.);c+=rim*rl*(uDk>.5?.24:.40);\n" +
    " if(uDk<.5){c=mix(c,vec3(.12,.18,.32),(1.-smoothstep(0.,1.1,-d))*.18*(1.-rl*.6));}\n" +
    " c+=dn;\n float a=uFl>.5?(uDk>.5?.58:.62)+fr*.3+sp:1.;a=clamp(a,0.,1.)*A;\n" +
    " gl_FragColor=vec4(clamp(c,0.,1.)*a,a+sh*(1.-a));}";

  function WK() {
    var gl = null, glc = null, U = {};
    function sh(t, s) { var o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o)); return o; }
    onmessage = function (m) {
      var q = m.data;
      try {
        if (q.init) {
          glc = new OffscreenCanvas(4, 4);
          gl = glc.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false, powerPreference: "low-power" });
          if (!gl) throw new Error("no webgl");
          glc.addEventListener("webglcontextlost", function (e) { e.preventDefault(); postMessage({ fail: "lost" }); });
          var hp = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
          var pr = gl.createProgram(); gl.attachShader(pr, sh(gl.VERTEX_SHADER, q.vs)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, "precision " + (hp && hp.precision > 0 ? "highp" : "mediump") + " float;\n" + q.fs)); gl.linkProgram(pr);
          if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr));
          gl.useProgram(pr);
          var bf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, bf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
          var al = gl.getAttribLocation(pr, "a"); gl.enableVertexAttribArray(al); gl.vertexAttribPointer(al, 2, gl.FLOAT, false, 0, 0);
          "uC uS uP uV uM uR uDk uFl uDpr uN uSh uL uK uB0 uB1 uB2".split(" ").forEach(function (n) { U[n] = gl.getUniformLocation(pr, n); });
          postMessage({ ready: 1 }); return;
        }
        if (q.theme) { var t = q.theme; gl.uniform4fv(U.uL, t.L); gl.uniform4fv(U.uK, t.K); gl.uniform1f(U.uN, t.n); gl.uniform3fv(U.uB0, t.b0); gl.uniform3fv(U.uB1, t.b1); gl.uniform3fv(U.uB2, t.b2); gl.uniform1f(U.uDk, t.dk); return; }
        var t0 = performance.now();
        if (glc.width !== q.pw || glc.height !== q.ph) { glc.width = q.pw; glc.height = q.ph; }
        gl.viewport(0, 0, q.pw, q.ph);
        gl.uniform2f(U.uC, q.cw, q.ch); gl.uniform2f(U.uS, q.w, q.h); gl.uniform2f(U.uP, q.x, q.y); gl.uniform2f(U.uV, q.vw, q.vh);
        gl.uniform1f(U.uM, q.m); gl.uniform1f(U.uR, q.r); gl.uniform1f(U.uFl, q.fl); gl.uniform1f(U.uSh, q.sh); gl.uniform1f(U.uDpr, q.pw / q.cw);
        gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        var bmp = glc.transferToImageBitmap();
        postMessage({ id: q.id, bmp: bmp, ms: performance.now() - t0 }, [bmp]);
      } catch (e) { postMessage({ fail: String(e && e.message || e), id: q.id }); }
    };
  }
  function hex(h) { return [parseInt(h.substr(1, 2), 16) / 255, parseInt(h.substr(3, 2), 16) / 255, parseInt(h.substr(5, 2), 16) / 255]; }
  var curTheme = "";
  function setTheme(dark) {
    var k = dark ? "dark" : "light"; if (curTheme === k) return; curTheme = k;
    var T = LAYERS[k], L = new Float32Array(28), K = new Float32Array(28);
    T.l.forEach(function (x, i) { L.set([x[0], x[1], x[2], x[3]], i * 4); K.set([x[4] / 255, x[5] / 255, x[6] / 255, x[7]], i * 4); });
    wk.postMessage({ theme: { L: L, K: K, n: T.l.length, b0: hex(T.base[0]), b1: hex(T.base[1]), b2: hex(T.base[2]), dk: dark ? 1 : 0 } });
  }
  var wk, lost = false, started = false;
  try {
    var bu = URL.createObjectURL(new Blob(["(" + WK.toString() + ")()"], { type: "text/javascript" }));
    wk = new Worker(bu);
  } catch (e) { return; }
  wk.onerror = function () { off(); };
  wk.onmessage = function (m) {
    var q = m.data;
    if (q.ready) { start(); return; }
    if (q.fail) { try { console.warn("[lux-liquid] WebGL 유리 끔 → CSS 유리:", q.fail); } catch (e) {} off(); return; }
    got(q);
  };
  wk.postMessage({ init: 1, vs: VS, fs: FSB });

  /* ── 대상 · 상태 ── */
  var SEL = "nav.sidebar,.m-tabbar,.fv-idx,#easyDash .ix,.fv-panel,.fv-breadth,#easyDash .bri,#easyDash .c,.dash-block,#pbObs .k-panel,.detail-vcard";
  var FLOAT = ".m-tabbar";   // 뒤로 글이 지나가는 떠 있는 판: 굴절 대신 CSS 흐림 + 반투명 유리 그림
  var M = 24;                // 그림자 여백(px)
  var PH = false; try { PH = matchMedia("(max-width: 760px)").matches || matchMedia("(pointer: coarse)").matches; } catch (e) {}
  var PER = PH ? 2 : 4, PXCAP = PH ? 9e6 : 16e6, pxUsed = 0;
  var items = [], pool = {}, kindOk = {};
  function dark() { return H.getAttribute("data-theme") !== "light"; }
  function dprFor(w, h) { var d = Math.min(W.devicePixelRatio || 1, 2); return (w * h > 240000 || pxUsed > PXCAP * .7) ? 1 : d; }

  function mkHost(it) {
    var host = D.createElement("lg-glass"), cv = D.createElement("canvas");
    host.setAttribute("aria-hidden", "true");
    host.style.cssText = "position:absolute;display:block;pointer-events:none;z-index:-1;margin:0;padding:0;border:0;top:" + (-M - it.bt) + "px;left:" + (-M - it.bl) + "px;width:calc(100% + " + (2 * M) + "px + " + (it.bl + it.br) + "px);height:calc(100% + " + (2 * M) + "px + " + (it.bt + it.bb) + "px)";
    cv.style.cssText = "display:block;width:100%;height:100%";
    var root = host; try { root = host.attachShadow({ mode: "closed" }); } catch (e) {}
    root.appendChild(cv);
    if (root === host) { it.host = host; it.cv = cv; it.ctx = null; return; }   // shadow DOM 없으면 움직이는 빛 생략(스타일이 밖으로 새지 않게)
    /* [V33.870] ★움직이는 빛★ — 판 그림(셰이더)은 정지 화면 · 그 위에 '빛이 닿는 자리'만 움직이는 얇은 층(기울기·마우스를 따라 테두리를 돈다).
       테두리 띠(1.5px · 고리 마스크)와 베벨 띠(넓고 흐림) 안에서 작은 빛 덩이 2개(주광 · 반대편 반사)가 transform 으로만 움직인다 · 본체엔 아주 옅은 광택이 반대로 흐른다.
       프레임마다 '쓰기'만(읽기 0) · 화면에 보이는 판만 · 입력이 멈추면 루프도 멈춤. */
    {
      var sp = D.createElement("div"); sp.className = "sp";
      sp.innerHTML = '<div class="rg"><i class="b1"></i><i class="b2"></i></div><div class="gw"><i class="b1"></i><i class="b2"></i></div><div class="sh"><i class="bl"></i></div>';
      var st = D.createElement("style"); st.textContent = SPCSS;
      root.appendChild(st); root.appendChild(sp);
      var q = sp.querySelectorAll("i");
      it.sp = { el: sp, b: [q[0], q[1], q[2], q[3]], bl: q[4] };
    }
    it.host = host; it.cv = cv; it.ctx = null;
  }
  var SPCSS = ".sp{position:absolute;inset:" + M + "px;border-radius:var(--r);pointer-events:none}" +
    ".rg,.gw,.sh{position:absolute;inset:0;border-radius:inherit;overflow:hidden}" +
    ".rg{padding:1.6px;-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask:linear-gradient(#000 0 0) content-box exclude,linear-gradient(#000 0 0)}" +
    ".gw{padding:var(--bz);-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask:linear-gradient(#000 0 0) content-box exclude,linear-gradient(#000 0 0);opacity:.9}" +
    "i{position:absolute;left:0;top:0;display:block;border-radius:50%;pointer-events:none}" +
    ".rg .b1{width:var(--s1);height:var(--s1);margin:calc(var(--s1)/-2) 0 0 calc(var(--s1)/-2);background:radial-gradient(closest-side,rgba(255,255,255,1),rgba(255,255,255,.7) 30%,rgba(255,255,255,0))}" +
    ".rg .b2{width:calc(var(--s1)*.7);height:calc(var(--s1)*.7);margin:calc(var(--s1)*-.35) 0 0 calc(var(--s1)*-.35);background:radial-gradient(closest-side,rgba(215,232,255,.42),rgba(215,232,255,0))}" +
    ".gw .b1{width:var(--s2);height:var(--s2);margin:calc(var(--s2)/-2) 0 0 calc(var(--s2)/-2);background:radial-gradient(closest-side,rgba(255,255,255,.42),rgba(255,255,255,.12) 45%,rgba(255,255,255,0))}" +
    ".gw .b2{width:calc(var(--s2)*.7);height:calc(var(--s2)*.7);margin:calc(var(--s2)*-.35) 0 0 calc(var(--s2)*-.35);background:radial-gradient(closest-side,rgba(190,220,255,.26),rgba(190,220,255,0))}" +
    ".sh .bl{width:140%;height:120%;margin:-60% 0 0 -70%;background:radial-gradient(closest-side,rgba(255,255,255,.10),rgba(255,255,255,0))}" +
    ":host-context(html[data-theme=light]) .gw{opacity:.8}";
  function adopt(el) {
    if (el.__lgI !== undefined) return;
    el.__lgI = null;
    var par = el.parentElement && el.parentElement.closest(SEL); if (par) return;   // 바깥 대상 안의 대상은 그 판 위에 그대로(겹친 유리는 안 그린다)
    var kind = el.tagName + "#" + (el.id || "") + "." + String(el.className || "").replace(/\blg-\S+/g, "").trim();
    var sig = kind; for (var ci = 0, ch = el.children; ci < ch.length && ci < 12; ci++) sig += "|" + ch[ci].tagName + "." + ch[ci].className;
    var k = kindOk[sig];
    if (!k) {
      var cs = getComputedStyle(el), ok = 1;
      if (/auto|scroll/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 4 && !el.matches("nav.sidebar")) ok = 0;   // 안에서 스크롤되는 상자는 그림이 같이 밀린다
      var rel = cs.position === "static";
      // 안쪽에 절대배치가 있으면 relative 로 바꿀 때 위치 기준이 바뀐다 → 안 씌움. 자손이 많은 큰 상자는 훑지 않고 건너뛴다(스타일 계산 폭주 방지)
      // [V33.870] 종전 '자손 120개 넘으면 건너뜀' → 전문가 큰 패널(TOP MOVERS 등)이 통째로 빠졌다. 이제는 relative 로 바꿨을 때 ★실제로 기준이 바뀌는★
      // 절대배치 자손(가장 가까운 위치 기준이 이 상자 바깥)이 있을 때만 건너뛴다. 모양(sig)마다 한 번만 · 자손 4,000 개 상한.
      if (ok && rel) { var q = el.getElementsByTagName("*"); if (q.length > 4000) ok = 0;
        for (var i = 0; i < q.length && ok; i++) { if (getComputedStyle(q[i]).position !== "absolute") continue;
          var a = q[i].parentElement, inner = false; while (a && a !== el) { if (getComputedStyle(a).position !== "static") { inner = true; break; } a = a.parentElement; }
          if (!inner) ok = 0; } }
      k = kindOk[sig] = { ok: ok, rel: rel, r: parseFloat(cs.borderTopLeftRadius) || 12, bt: parseFloat(cs.borderTopWidth) || 0, bl: parseFloat(cs.borderLeftWidth) || 0, br: parseFloat(cs.borderRightWidth) || 0, bb: parseFloat(cs.borderBottomWidth) || 0, sh: 1 };
      var pp = el.parentElement && getComputedStyle(el.parentElement); if (pp && (pp.overflowX !== "visible" || pp.overflowY !== "visible")) k.sh = .15;   // 부모가 잘라 내면 그림자 끝이 곧은 선으로 보인다 → 그림자 거의 끔
    }
    if (!k.ok) return;
    if (k.rel) el.style.position = "relative";
    var it = { el: el, w: 0, h: 0, r: k.r, bt: k.bt, bl: k.bl, br: k.br, bb: k.bb, sh: k.sh, fl: el.matches(FLOAT), vis: false, dirty: true, drawn: null, px: 0 };
    el.__lgI = it; items.push(it);
    ro.observe(el); io.observe(el);
  }

  /* 같은 크기·모양 판이 다시 생기면(초보 대시보드는 시세마다 카드를 새로 그린다) 그려 둔 그림을 옮겨 쓴다 */
  function pkey(it) { return Math.round(it.w) + "x" + Math.round(it.h) + "r" + it.r + (it.fl ? "f" : "") + (dark() ? "dark" : "light"); }
  function release(it) {
    ro.unobserve(it.el); io.unobserve(it.el); it.el.__lgI = undefined;
    if (it.host && it.drawn) { var key = it.drawn.key; (pool[key] = pool[key] || []).push(it); poolN++; if (poolN > 24) trimPool(); }
    else freeIt(it);
  }
  var poolN = 0;
  function trimPool() { for (var k in pool) { while (pool[k].length && poolN > 12) { freeIt(pool[k].shift()); poolN--; } if (!pool[k].length) delete pool[k]; } }
  function freeIt(it) { if (it.cv) { pxUsed -= it.px; it.px = 0; it.cv.width = it.cv.height = 0; } if (it.host && it.host.parentNode) it.host.parentNode.removeChild(it.host); }

  var ro = new ResizeObserver(function (es) {
    for (var i = 0; i < es.length; i++) {
      var e = es[i], it = e.target.__lgI; if (!it) continue;
      var b = e.borderBoxSize && e.borderBoxSize[0], w = b ? b.inlineSize : e.contentRect.width, h = b ? b.blockSize : e.contentRect.height;
      if (Math.abs(w - it.w) < 1 && Math.abs(h - it.h) < 1) continue;
      it.w = w; it.h = h; it.dirty = true;
      if (!it.drawn) { var l = pool[pkey(it)]; if (l && l.length) { var o = l.pop(); poolN--; it.host = o.host; it.cv = o.cv; it.ctx = o.ctx; it.sp = o.sp; it.px = o.px; it.drawn = o.drawn; it.check = true; it.dirty = false; it.el.appendChild(it.host); it.el.classList.add("lg-g"); if (it.fl) it.el.classList.add("lg-fl"); } }
    }
    kick(140);
  });
  var io = new IntersectionObserver(function (es) {
    for (var i = 0; i < es.length; i++) { var it = es[i].target.__lgI; if (it) it.vis = es[i].isIntersecting; }
    kick(60);
  }, { rootMargin: "300px 0px" });

  /* ── 그리기(유휴 시간 · 한 번에 PER 장) ── */

  /* ── 그리기 — 유휴 시간에 읽기(사각형) 모아서 한 번 → 워커로 보냄(동시에 PER 장까지) → 받은 그림을 붙임 ── */
  var tm = 0, idl = 0, fly = 0, seq = 0, wait = {}, stats = [];
  function kick(ms) { if (lost || !started) return; clearTimeout(tm); tm = setTimeout(function () { if (!idl) idl = (W.requestIdleCallback || function (f) { return setTimeout(f, 1); })(pass, { timeout: 700 }); }, ms); }
  function pass() {
    idl = 0; if (lost) return;
    if (scOn) return;   // 스크롤 중엔 아무것도 안 그린다(멈춘 뒤 한꺼번에)
    var todo = [];
    for (var i = 0; i < items.length && todo.length + fly < PER; i++) { var it = items[i]; if (it.vis && !it.fly && it.w > 40 && it.h > 30 && (it.dirty || it.check)) todo.push(it); }
    if (!todo.length) return;
    var vw = H.clientWidth, vh = W.innerHeight, rs = todo.map(function (it) { return it.el.getBoundingClientRect(); });
    var dk = dark(); setTheme(dk);
    for (var j = 0; j < todo.length; j++) {
      var it2 = todo[j], rc = rs[j], dr = it2.drawn;
      it2.check = false;
      if (!it2.dirty && dr && dr.dk === dk && Math.abs(dr.x - rc.left) < 40 && Math.abs(dr.y - rc.top) < 40 && dr.vw === vw && dr.vh === vh) continue;
      send(it2, rc.left, rc.top, vw, vh, dk);
    }
  }
  function send(it, x, y, vw, vh, dk) {
    var w = it.w, h = it.h, cw = w + 2 * M, ch = h + 2 * M, dpr = dprFor(w, h);
    var pw = Math.max(1, Math.round(cw * dpr)), ph = Math.max(1, Math.round(ch * dpr)), id = ++seq;
    it.dirty = false; it.fly = id; fly++;
    it.next = { x: x, y: y, vw: vw, vh: vh, dk: dk, pw: pw, ph: ph, w: w, h: h };
    wait[id] = it;
    wk.postMessage({ id: id, pw: pw, ph: ph, cw: cw, ch: ch, w: w, h: h, x: x, y: y, vw: vw, vh: vh, m: M, r: it.r, fl: it.fl ? 1 : 0, sh: it.sh });
  }
  function got(q) {
    var it = wait[q.id]; delete wait[q.id]; fly = Math.max(0, fly - 1);
    if (!it || it.fly !== q.id || !it.el.isConnected) { if (q.bmp) q.bmp.close(); if (it) it.fly = 0; kick(0); return; }
    it.fly = 0;
    var n = it.next;
    if (!it.host) mkHost(it);
    if (!it.ctx) it.ctx = it.cv.getContext("bitmaprenderer");
    it.cv.width = n.pw; it.cv.height = n.ph; it.ctx.transferFromImageBitmap(q.bmp);
    pxUsed += n.pw * n.ph - it.px; it.px = n.pw * n.ph;
    if (it.host.parentNode !== it.el) it.el.appendChild(it.host);
    it.drawn = { x: n.x, y: n.y, vw: n.vw, vh: n.vh, dk: n.dk, key: Math.round(n.w) + "x" + Math.round(n.h) + "r" + it.r + (it.fl ? "f" : "") + (n.dk ? "dark" : "light") };
    if (!it.el.classList.contains("lg-g")) { it.el.classList.add("lg-g"); if (it.fl) it.el.classList.add("lg-fl"); }
    specSize(it);
    if (pxUsed > PXCAP) shed();
    if (stats.length < 200) stats.push([Math.round(n.w), Math.round(n.h), +q.ms.toFixed(1)]);
    kick(0);
  }
  /* 메모리 상한: 안 보이는 판의 그림부터 비운다(다시 보이면 다시 그림) */
  function shed() { for (var i = 0; i < items.length && pxUsed > PXCAP * .8; i++) { var it = items[i]; if (!it.vis && it.px) { pxUsed -= it.px; it.px = 0; it.cv.width = it.cv.height = 0; it.dirty = true; } } }

  function off() {
    lost = true; H.classList.remove("lg-gl");
    items.forEach(function (it) { it.el.classList.remove("lg-g", "lg-fl"); freeIt(it); });
    items = []; ro.disconnect(); io.disconnect(); try { wk.terminate(); } catch (e) {}
  }

  /* ── [V33.870] 움직이는 빛 — 빛 방향 θ(0 = 위, 시계 방향) · 세기 k. 입력: 데스크톱 마우스 위치 · 폰 기울기(deviceorientation · iOS 는 첫 터치 때 한 번 허락 요청) ── */
  var RM = false; try { RM = matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) {}
  var LT = { a: -0.6435, k: .9, ta: -0.6435, tk: .9 }, lraf = 0;
  function bzOf(it) { return Math.max(8, Math.min(24, Math.min(it.w, it.h) * .14)); }
  function placeSpec(it) {
    var S = it.sp; if (!S || !it.w) return;
    var hw = it.w / 2, hh = it.h / 2, dx = Math.sin(LT.a), dy = -Math.cos(LT.a);
    var t = Math.min(hw / Math.max(Math.abs(dx), 1e-4), hh / Math.max(Math.abs(dy), 1e-4));
    var px = hw + dx * t, py = hh + dy * t, ox = hw - dx * t, oy = hh - dy * t;
    S.b[0].style.transform = S.b[2].style.transform = "translate(" + px.toFixed(1) + "px," + py.toFixed(1) + "px)";
    S.b[1].style.transform = S.b[3].style.transform = "translate(" + ox.toFixed(1) + "px," + oy.toFixed(1) + "px)";
    S.bl.style.transform = "translate(" + (hw + dx * hw * .45).toFixed(1) + "px," + (hh + dy * hh * .45).toFixed(1) + "px)";
    S.el.style.opacity = LT.k.toFixed(3);
  }
  function specSize(it) { if (!it.sp) return; it.sp.el.style.setProperty("--r", it.r + "px"); it.sp.el.style.setProperty("--bz", bzOf(it).toFixed(1) + "px"); it.sp.el.style.setProperty("--s1", Math.round(Math.min(900, Math.max(160, Math.max(it.w, it.h) * .85))) + "px"); it.sp.el.style.setProperty("--s2", Math.round(Math.min(700, Math.max(140, Math.min(it.w, it.h) * 1.5))) + "px"); placeSpec(it); }
  function lightLoop() {
    lraf = 0;
    var d = LT.ta - LT.a; d = Math.atan2(Math.sin(d), Math.cos(d));   // 가까운 쪽으로 돈다
    LT.a += d * .2; LT.k += (LT.tk - LT.k) * .2;
    for (var i = 0; i < items.length; i++) { var it = items[i]; if (it.vis && it.sp && it.drawn) placeSpec(it); }
    if (Math.abs(d) > .003 || Math.abs(LT.tk - LT.k) > .004) lraf = requestAnimationFrame(lightLoop);
  }
  function aim(vx, vy, k) { if (RM) return; LT.ta = Math.atan2(vx, -vy); LT.tk = k; if (!lraf) lraf = requestAnimationFrame(lightLoop); }
  if (!RM) {
    if (!PH) addEventListener("pointermove", function (e) {
      if (e.pointerType !== "mouse") return;
      var vx = e.clientX - W.innerWidth / 2, vy = e.clientY - W.innerHeight / 2, ds = Math.sqrt(vx * vx + vy * vy);
      if (ds < 30) return; aim(vx, vy, .8 + .3 * Math.min(1, ds / (W.innerWidth * .5)));
    }, { passive: true });
    var b0 = null;
    var onOri = function (e) {
      if (e.beta == null || e.gamma == null) return;
      if (b0 == null) b0 = e.beta; b0 += (e.beta - b0) * .004;   // 손에 쥔 각도를 천천히 '평평한 자세' 로 삼는다
      var gx = Math.max(-1, Math.min(1, e.gamma / 32)), by = Math.max(-1, Math.min(1, (e.beta - b0) / 32));
      aim(-.6 + gx * 1.4, -.8 + by * 1.4, Math.max(.75, Math.min(1.15, .78 + .35 * Math.sqrt(gx * gx + by * by))));
    };
    if (PH && W.DeviceOrientationEvent) {
      var RP = DeviceOrientationEvent.requestPermission;
      if (typeof RP === "function") {   // iOS: 사용자 동작 안에서 한 번만 묻는다(거절하면 다시 묻지 않음)
        var tv = null; try { tv = localStorage.getItem("luxTilt"); } catch (e) {}
        if (tv !== "asked") D.addEventListener("touchend", function ask() {   // 처음이면 묻고, 전에 허락했으면 조용히 다시 켠다(iOS 는 페이지마다 요청 필요 · 허락된 곳은 창이 안 뜬다)
          D.removeEventListener("touchend", ask, true);
          try { localStorage.setItem("luxTilt", "asked"); } catch (e) {}
          RP.call(DeviceOrientationEvent).then(function (r) { if (r === "granted") { try { localStorage.setItem("luxTilt", "granted"); } catch (e) {} addEventListener("deviceorientation", onOri, { passive: true }); } })["catch"](function () {});
        }, true);
      } else addEventListener("deviceorientation", onOri, { passive: true });
    }
  }

  /* ── 대상 찾기(유휴) · 다시 그릴 때 ── */
  var pend = 0;
  var MT = { scan: 0, pass: 0, got: 0, ro: 0, max: 0 };
  function tk(k, t0) { var d = performance.now() - t0; MT[k] += d; if (d > MT.max) MT.max = d; }
  function scan() {
    var t0 = performance.now(); pend = 0;
    for (var i = items.length - 1; i >= 0; i--) {
      var it = items[i];
      if (!it.el.isConnected) { items.splice(i, 1); release(it); continue; }
      if (it.host && it.host.parentNode !== it.el) it.el.appendChild(it.host);   // 카드 innerHTML 을 새로 쓰면 그림 상자가 빠진다 → 그대로 다시 붙임(다시 그리지 않음)
    }
    var l = D.querySelectorAll(SEL); for (var j = 0; j < l.length; j++) adopt(l[j]);
    tk("scan", t0);
  }
  function later() { if (!pend) pend = (W.requestIdleCallback || setTimeout)(scan, { timeout: 600 }); }
  function allDirty(chk) { items.forEach(function (it) { if (chk) it.check = true; else it.dirty = true; }); kick(chk ? 0 : 30); }
  var scT = 0, scOn = false;
  addEventListener("scroll", function () { scOn = true; clearTimeout(scT); scT = setTimeout(function () { scOn = false; allDirty(true); }, 320); }, { passive: true, capture: true });
  var rzT = 0; addEventListener("resize", function () { clearTimeout(rzT); rzT = setTimeout(function () { allDirty(false); }, 200); }, { passive: true });
  function init() {
    scan();
    new MutationObserver(function (ms) {
      for (var i = 0; i < ms.length; i++) { var m = ms[i]; if (m.removedNodes.length) { later(); return; } var a = m.addedNodes; for (var j = 0; j < a.length; j++) { var n = a[j]; if (n.nodeType === 1 && n.tagName !== "LG-GLASS") { later(); return; } } }
    }).observe(D.body, { childList: true, subtree: true });
    new MutationObserver(function () { allDirty(false); }).observe(H, { attributes: true, attributeFilter: ["data-theme"] });
  }

  function start() {
    if (started || lost) return; started = true;
    var st = D.createElement("style"); st.id = "lgBg";
    st.textContent = "html.lg-gl:not([data-theme=\"light\"])::before{background:" + bgCss(LAYERS.dark) + ";opacity:1!important}" +
      "html.lg-gl[data-theme=\"light\"]::before{background:" + bgCss(LAYERS.light) + ";opacity:1!important}";
    D.head.appendChild(st);
    H.classList.add("lg-gl");
    if (D.readyState === "loading") D.addEventListener("DOMContentLoaded", init); else init();
  }
  W.luxGlass = { light: LT, webgl: function () { return started && !lost; }, items: function () { return items.length; }, drawn: function () { return items.filter(function (i) { return i.drawn; }).length; }, px: function () { return pxUsed; }, off: off, stats: stats, mt: MT };
})();
