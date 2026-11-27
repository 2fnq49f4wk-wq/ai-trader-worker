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
  /* [V33.874] ★MY › 내 정보 › 화면 · 유리★ 설정(사용자 11/27) — mine.js 가 luxGlassUI.html() 을 넣고, 조작은 여기서 받는다.
     유리를 꺼도(아래 return) 다시 켤 수 있게 이 부분은 맨 앞에 둔다. 값은 이 기기에만(localStorage) — 서버 일 0. */
  var GL_F = [["refraction", "굴절 · 가장자리에서 뒤가 휘는 정도", 0, 3, .05], ["chroma", "무지개 · 가장자리 색 번짐", 0, 1, .02], ["blur", "흐림(frost) · 뒤가 비치는 선명도", 0, 12, .25], ["spec", "빛 · 테두리 반사와 광채", 0, 2, .05]];
  function glOn() { try { return localStorage.getItem("luxGlass") !== "off"; } catch (e) { return true; } }
  function glMove() { try { return localStorage.getItem("luxGlassMove") !== "off"; } catch (e) { return true; } }
  function seg(k, on) { return '<span class="seg" role="radiogroup"><button type="button" role="radio" data-gl="' + k + '" data-v="1" aria-checked="' + on + '" class="' + (on ? "on" : "") + '">켜짐</button><button type="button" role="radio" data-gl="' + k + '" data-v="0" aria-checked="' + !on + '" class="' + (on ? "" : "on") + '">꺼짐</button></span>'; }
  W.luxGlassUI = {
    html: function () {
      var G = W.luxGlass, on = glOn(), live = !!(G && G.webgl && G.webgl());
      var h = '<div class="lgr"><span class="lb">리퀴드 글라스 효과</span>' + seg("on", on) + '</div>';
      if (on && !live) h += '<div class="lgn">' + (!G || (G.failed && G.failed()) ? "이 기기·브라우저는 WebGL 유리를 그릴 수 없어 기본 유리로 보입니다." : "유리를 준비하는 중입니다 — 잠시 뒤 다시 열면 세부 조절이 보입니다.") + '</div>';
      if (on && live) {
        var P0 = G.params, dk = H.getAttribute("data-theme") !== "light";
        h += '<div class="lgr"><span class="lb">빛이 기울기·마우스를 따라 움직임</span>' + seg("move", glMove()) + '</div>';
        h += GL_F.map(function (f) { var v = P0[f[0]]; if (f[0] === "tint" && v < 0) v = dk ? .02 : .12;
          return '<label class="lgr sl"><span class="lb">' + f[1] + ' <b data-glv="' + f[0] + '">' + (+v).toFixed(2) + '</b></span><input type="range" min="' + f[2] + '" max="' + f[3] + '" step="' + f[4] + '" value="' + v + '" data-glk="' + f[0] + '"></label>'; }).join("");
        h += '<div class="lgr"><span class="lb">처음 값으로</span><button type="button" class="b" data-gl="reset">되돌리기</button></div>';
      }
      return h;
    }
  };
  D.addEventListener("input", function (e) { var k = e.target && e.target.getAttribute && e.target.getAttribute("data-glk"); if (!k) return; var b = D.querySelector('[data-glv="' + k + '"]'); if (b) b.textContent = (+e.target.value).toFixed(2); });
  D.addEventListener("change", function (e) { var k = e.target && e.target.getAttribute && e.target.getAttribute("data-glk"); if (!k || !W.luxGlass || !W.luxGlass.set) return; var o = {}; o[k] = +e.target.value; W.luxGlass.set(o); });
  D.addEventListener("click", function (e) {
    var t = e.target && e.target.closest && e.target.closest("[data-gl]"); if (!t) return;
    var k = t.getAttribute("data-gl"), v = t.getAttribute("data-v") === "1";
    try {
      if (k === "on") { if (v === glOn()) return; localStorage.setItem("luxGlass", v ? "on" : "off"); location.reload(); return; }
      if (k === "move") { localStorage.setItem("luxGlassMove", v ? "on" : "off"); if (W.luxGlass && W.luxGlass.move) W.luxGlass.move(v); }
      if (k === "reset") { localStorage.removeItem("luxGlassP7"); localStorage.removeItem("luxGlassMove"); location.reload(); return; }
    } catch (x) {}
    var box = t.closest(".lgset"); if (box) box.innerHTML = W.luxGlassUI.html();
  });
  try { if (localStorage.getItem("luxGlass") === "off") return; } catch (e) {}
  if (RT || !("ResizeObserver" in W) || !("IntersectionObserver" in W)) return;

  /* 배경 오로라 — 위에서부터(맨 앞 = 맨 위). [cx%, cy%, rx vmax, ry vmax, r, g, b, a] · 투명은 70% 지점(CSS 와 같은 식) */
  var LAYERS = {
    dark: { base: ["#0b1326", "#0a1122", "#070d1b"], l: [
      [30, 34, 16, 13, 70, 130, 255, .48], [74, 52, 11, 10, 40, 200, 190, .38], [52, 86, 14, 12, 130, 100, 255, .42],
      [88, 12, 9, 8, 120, 170, 255, .36], [6, 0, 60, 50, 60, 90, 170, .34], [100, 10, 50, 44, 70, 100, 180, .26], [60, 110, 60, 50, 40, 60, 120, .26]] },
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
  /* ══ [V33.873] 렌더 파이프라인 재구성(사용자 11/27 "블러처럼 평면적 — 애플처럼 굴절·광원·투명·두께 하이라이트") ══
     진단: ① 유리 뒤가 큰 그라데이션 몇 덩이뿐 → 굴절해도 휘어 보일 무늬가 없어 '흐린 막'으로 보였다 ② 굴절 샘플이 수식 재계산이라 거칠기/흐림 단계가 없었다
     ③ 빛 방향이 셰이더에 위왼쪽 고정(움직이는 건 CSS 테두리뿐).
     지금: ⓐ 배경 '장면'(오로라 + 빛 띠 2 + 보케 원 9)을 워커 WebGL 이 ★화면 뒤 고정 캔버스(#lgBg)★ 와 ★오프스크린 텍스처(FBO)★ 에 똑같이 그린다
     ⓑ 유리 판 = FBO 를 표면 법선·베벨 곡률로 휜 UV 로 샘플(가운데는 렌즈처럼 살짝 확대 · 베벨은 강하게 휨 · 가장자리만 R/G/B 오프셋 · 미세 흐림 5탭)
     ⓒ 광원 방향 uLt(마우스·기울기 · 멈추면 다시 그림)로 스페큘러·프레넬·테두리 빛·두께 그늘 ⓓ 값은 전부 P(파라미터) — luxGlass.set({...}) · ?glass=debug 패널. */
  var P = { refraction: 1.5, chroma: .45, blur: 0, spec: 1, tint: 0, bevel: .15, magnify: 1, curve: 1, rich: 0 };   // [V33.879] 사용자 "완전 투명 · 테두리만" — 흐림 0 · 틴트 0 · 확대 없음 · 본체는 그리지 않음   // V33.876 렌즈 값 · rich 0 = 배경 물결 없음(사용자 "배경 이상")   // magnify = 가운데 렌즈 확대(the-best-liquid-glass zoom)   // tint -1 = 테마 기본(다크 .03 · 라이트 .18) · [V33.876] 스넬 굴절 기준으로 다시 맞춤
  var VS = "attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}";
  var SCN =
    "uniform vec2 uV;uniform float uN,uDk,uRich;uniform vec4 uL[7],uK[7],uBo[9],uBc[9],uRb[2],uRc[2];uniform vec3 uB0,uB1,uB2;\n" +
    "vec3 scene(vec2 v){float t=clamp(v.y/uV.y,0.,1.);vec3 c=t<.55?mix(uB0,uB1,t/.55):mix(uB1,uB2,(t-.55)/.45);float vm=max(uV.x,uV.y)*.01;\n" +
    " for(int i=6;i>=0;i--){if(float(i)>=uN)continue;vec4 L=uL[i];vec2 d=(v-L.xy*uV*.01)/(L.zw*vm);float a=uK[i].a*(1.-clamp(length(d)/.7,0.,1.));c=mix(c,uK[i].rgb,a);}\n" +
    " if(uRich>.5){vec2 q=v/uV-.5;q.x*=uV.x/uV.y;\n" +
    // [V33.876] 배경화면 = 뚜렷한 물결 띠 4개(가장자리 약 5px) — 유리 뒤에 '휘어 보일 무늬' 가 있어야 렌즈가 보인다(스킬 recipes: 단색 위 유리는 굴절할 게 없다)
    "  vec2 w=v/uV.y;for(int i=0;i<4;i++){float fi=float(i);float yc=.16+.23*fi+.07*sin(w.x*(2.1+fi*.65)+fi*1.7)+.035*sin(w.x*5.3+fi*2.3);\n" +
    "   float hw=.032+.014*mod(fi,2.);float dd=abs(w.y-yc);float a=1.-smoothstep(hw-.006,hw,dd);a*=.62+.38*(1.-dd/hw);\n" +
    "   vec3 col=fi<.5?vec3(.25,.45,1.):fi<1.5?vec3(.18,.78,.80):fi<2.5?vec3(.52,.40,1.):vec3(.30,.62,1.);\n" +
    "   c=mix(c,uDk>.5?col*.62:mix(col,vec3(1.),.45),a*(uDk>.5?.62:.55));}\n" +
    "  }\n" +   // [V33.874] 보케 원 제거(사용자 "배경에 이상한 원") — 빛 띠만 남김
    " return c;}\n";
  var FS_BG = SCN + "uniform vec2 uRes;void main(){vec2 v=vec2(gl_FragCoord.x,uRes.y-gl_FragCoord.y)/uRes*uV;gl_FragColor=vec4(scene(v),1.);}";
  /* [V33.876] 유리 판 셰이더 재작성 — MIT 오픈소스 'the-best-liquid-glass'(lzq20121022-tech) 스킬의 광학 원리를 우리 구조에 맞게 다시 씀:
     ① 스넬 굴절: 볼록 스쿼클 높이 h(가운데 평평 = 맑음 · 가장자리 가파름 = 강하게 휨) → 법선 N → refract(I,N,1/ior) → 착지점 = 두께×h 만큼 진행
        · 채널별 ior 를 조금씩 달리해(색 분산) 가장자리에만 무지개 · 가운데는 사실상 원본 그대로(회색 막 없음)
     ② 회색 막의 원인 제거: 흰색/회색을 섞던 틴트·부피광·프레넬 환경 반사 대신 — 하이라이트는 ★아래 내용의 색을 OKLab 에서 밝게·진하게★(글레어)
     ③ 경계 = 선이 아니라 빛과 그늘: 광원 쪽 글레어(흰) + 경계 안쪽 아주 얇은 접촉 그늘(검) + 광원 쪽만 1px 미만의 옅은 빛 → 선 없이 판이 구분됨
     ④ 바깥 부드러운 그림자로 판이 떠 있음. 다크 화면에서 투명(veil 0)이 기본 — 글자 대비는 원래 어두운 배경이 맡는다. */
  var FS_GL = SCN +
    "uniform sampler2D uBg;uniform vec2 uC,uS,uP;uniform float uM,uR,uFl,uDpr,uSh,uRefr,uBev,uChr,uBlur,uTint,uSpec,uMag,uCurv;uniform vec2 uLt;\n" +
    "float sd(vec2 p,vec2 b,float r){vec2 q=abs(p)-b+r;return length(max(q,0.))+min(max(q.x,q.y),0.)-r;}\n" +
    "vec3 tx(vec2 v){vec2 u=vec2(v.x/uV.x,1.-v.y/uV.y);if(u.x<0.||u.y<0.||u.x>1.||u.y>1.)return scene(v);return texture2D(uBg,u).rgb;}\n" +
    "vec3 bgs(vec2 v,float b){if(b<.3)return tx(v);return tx(v)*.36+(tx(v+vec2(b,b*.4))+tx(v-vec2(b,b*.4))+tx(v+vec2(-b*.4,b))+tx(v-vec2(-b*.4,b)))*.16;}\n" +
    "vec3 lab(vec3 c){c=pow(max(c,0.),vec3(2.2));float l=pow(.4122*c.r+.5363*c.g+.0514*c.b,1./3.),m=pow(.2119*c.r+.6807*c.g+.1074*c.b,1./3.),s=pow(.0883*c.r+.2817*c.g+.6300*c.b,1./3.);\n" +
    " return vec3(.2105*l+.7936*m-.0041*s,1.978*l-2.4286*m+.4506*s,.0259*l+.7828*m-.8087*s);}\n" +
    "vec3 rgb(vec3 o){float l=o.x+.3963*o.y+.2158*o.z,m=o.x-.1056*o.y-.0639*o.z,s=o.x-.0895*o.y-1.2915*o.z;l=l*l*l;m=m*m*m;s=s*s*s;\n" +
    " vec3 c=vec3(4.0767*l-3.3077*m+.2310*s,-1.2684*l+2.6098*m-.3413*s,-.0042*l-.7034*m+1.7076*s);return pow(max(c,0.),vec3(1./2.2));}\n" +
    // [V33.876 판으로 되돌림 · 사용자 11/27 "V33.877 은 다시 블러처럼 — 876 에서 수정"] xenitV1/liquid-glass-skill(MIT) 규칙 + 렌즈 확대
    //  · 림 띠 14~28px · 이동 곡선 (1-t)² · 바깥선에서 가장 세게 · 둥근 안쪽 SDF · 가운데 렌즈 확대(magnify) · 림 빛 위왼쪽 최대 · 반대편 옅은 그늘
    //  · 조절 4가지: 굴절 uRefr · 무지개 uChr · 흐림 uBlur px · 빛 uSpec
    "vec3 frost(vec2 v,float b){if(b<.4)return tx(v);vec3 c=tx(v)*.2;float k=b*.55;\n" +
    " c+=(tx(v+vec2(k,0.))+tx(v-vec2(k,0.))+tx(v+vec2(0.,k))+tx(v-vec2(0.,k)))*.1;\n" +
    " c+=(tx(v+vec2(b,b)*.7)+tx(v-vec2(b,b)*.7)+tx(v+vec2(b,-b)*.7)+tx(v-vec2(b,-b)*.7))*.1;return c;}\n" +
    "void main(){vec2 f=vec2(gl_FragCoord.x,uC.y*uDpr-gl_FragCoord.y)/uDpr;vec2 hs=uS*.5;vec2 pc=f-uM-hs;float r=min(uR,min(hs.x,hs.y));\n" +
    " float d=sd(pc,hs,r);float aa=1./uDpr;float A=clamp(.5-d/aa,0.,1.);\n" +
    " float sh=(1.-smoothstep(-16.,uM*.9,sd(pc-vec2(0.,8.),hs-3.,r)))*mix(.10,.32,uDk)+(1.-smoothstep(-1.,4.,sd(pc-vec2(0.,1.5),hs,r)))*mix(.04,.12,uDk);sh*=uSh;\n" +
    " if(A<=0.){gl_FragColor=vec4(0.,0.,0.,sh);return;}\n" +
    " float bz=min(clamp(r*.7,9.,16.),min(uS.x,uS.y)/3.);float rI=max(r,bz*2.);float dI=sd(pc,hs,rI);float dIn=max(-dI,0.);\n" +
    " float dn=(fract(sin(dot(gl_FragCoord.xy,vec2(12.9898,78.233)))*43758.5453)-.5)/255.;\n" +
    " vec2 cc=uP+hs;vec2 v=cc+(uP+f-uM-cc)/uMag;vec3 tn=uDk>.5?vec3(.02,.035,.08):vec3(1.);\n" +
    " vec2 e=vec2(.5,0.);vec2 n2=-vec2(sd(pc+e.xy,hs,rI)-sd(pc-e.xy,hs,rI),sd(pc+e.yx,hs,rI)-sd(pc-e.yx,hs,rI));n2=n2/max(length(n2),1e-4);\n" +
    " float t=clamp(dIn/bz,0.,1.);float pr=(1.-t)*(1.-t);\n" +
    " vec3 c;\n" +
    " if(uFl>.5)c=uDk>.5?vec3(.08,.10,.17):vec3(.96,.97,1.);\n" +
    " else if(pr<=0.&&dIn>bz*1.4){gl_FragColor=vec4(0.);return;}\n else if(pr<=0.)c=frost(v,uBlur);\n" +
    " else{vec2 s=n2*(1.1*bz*uRefr*pr);float k=uChr*.45;c=vec3(frost(v+s*(1.+k),uBlur).r,frost(v+s,uBlur).g,frost(v+s*(1.-k),uBlur).b);}\n" +
    " float l=dot(c,vec3(.2126,.7152,.0722));c=mix(vec3(l),c,1.15);c=mix(c,tn,uTint);\n" +
    " float fl=dot(-n2,uLt);float lit=pow(max(fl,0.),1.5),opp=pow(max(-fl,0.),2.);\n" +
    " float ring=exp(-dIn/.7);float wR=.95*lit+.35*opp;\n" +
    " c=mix(c,vec3(1.),clamp(ring*wR*.5*uSpec,0.,.85));\n" +
    // [V33.878] 가장자리 안쪽 광채 띠 삭제 — 회색 액자처럼 보였다(사용자 "가장자리 이상") · 대신 빛 쪽 곡면에만 아주 좁은 반사(폭 ≈ 베벨 ¼)
    " c+=exp(-dIn/(bz*.25))*lit*.10*uSpec;\n" +
    " c*=1.-exp(-dIn/(bz*.35))*opp*(uDk>.5?.20:.08);\n" +
    " c+=dn;\n float a=uFl>.5?(uDk>.5?.6:.64)+ring*wR*.3*uSpec:1.;a=clamp(a,0.,1.)*A;if(uFl<.5)a*=1.-smoothstep(bz*.9,bz*1.4,dIn);\n" +
    " gl_FragColor=vec4(clamp(c,0.,1.)*a,a+sh*(1.-a));}";

  function WK() {
    var gl = null, glc = null, U = {}, prG = null, prB = null, fbo = null, ftex = null, fw = 0, fh = 0, bgGl = null, bgc = null, bgPr = null, UB = {}, TH = null, VW = 0, VH = 0, PR = null;
    var SC = "uV uN uDk uRich uL uK uBo uBc uRb uRc uB0 uB1 uB2".split(" ");
    function sh(g, t, s) { var o = g.createShader(t); g.shaderSource(o, s); g.compileShader(o); if (!g.getShaderParameter(o, g.COMPILE_STATUS)) throw new Error(g.getShaderInfoLog(o)); return o; }
    function prog(g, vs, fs) {
      var hp = g.getShaderPrecisionFormat(g.FRAGMENT_SHADER, g.HIGH_FLOAT);
      var p = g.createProgram(); g.attachShader(p, sh(g, g.VERTEX_SHADER, vs)); g.attachShader(p, sh(g, g.FRAGMENT_SHADER, "precision " + (hp && hp.precision > 0 ? "highp" : "mediump") + " float;\n" + fs)); g.linkProgram(p);
      if (!g.getProgramParameter(p, g.LINK_STATUS)) throw new Error(g.getProgramInfoLog(p));
      return p;
    }
    function quad(g, p) { var bf = g.createBuffer(); g.bindBuffer(g.ARRAY_BUFFER, bf); g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), g.STATIC_DRAW); var al = g.getAttribLocation(p, "a"); g.enableVertexAttribArray(al); g.vertexAttribPointer(al, 2, g.FLOAT, false, 0, 0); }
    function locs(g, p, names, o) { names.forEach(function (n) { o[n] = g.getUniformLocation(p, n); }); return o; }
    function setScene(g, L) {   // 장면 uniform(테마 · 뷰포트)
      var t = TH; g.uniform2f(L.uV, VW, VH); g.uniform1f(L.uN, t.n); g.uniform1f(L.uDk, t.dk); g.uniform1f(L.uRich, t.rich);
      g.uniform4fv(L.uL, t.L); g.uniform4fv(L.uK, t.K); g.uniform4fv(L.uBo, t.Bo); g.uniform4fv(L.uBc, t.Bc); g.uniform4fv(L.uRb, t.Rb); g.uniform4fv(L.uRc, t.Rc);
      g.uniform3fv(L.uB0, t.b0); g.uniform3fv(L.uB1, t.b1); g.uniform3fv(L.uB2, t.b2);
    }
    function paintScene() {   // 배경 장면 → ① FBO(유리가 굴절해 샘플) ② 화면 뒤 고정 캔버스(사람이 보는 배경) — 같은 셰이더 · 같은 값
      if (!TH || !VW) return;
      var w = Math.max(64, Math.round(VW * .5)), h = Math.max(64, Math.round(VH * .5));
      if (!fbo || fw !== w || fh !== h) {
        if (!fbo) { fbo = gl.createFramebuffer(); ftex = gl.createTexture(); }
        gl.bindTexture(gl.TEXTURE_2D, ftex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, ftex, 0);
        fw = w; fh = h;
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.viewport(0, 0, w, h); gl.useProgram(prB); setScene(gl, U.B); gl.uniform2f(U.B.uRes, w, h);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.useProgram(prG); setScene(gl, U.G); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, ftex); gl.uniform1i(U.G.uBg, 0);
      if (bgGl) {
        var bw = Math.max(64, Math.round(VW * .6)), bh = Math.max(64, Math.round(VH * .6));
        if (bgc.width !== bw || bgc.height !== bh) { bgc.width = bw; bgc.height = bh; }
        bgGl.viewport(0, 0, bw, bh); setScene(bgGl, UB); bgGl.uniform2f(UB.uRes, bw, bh); bgGl.drawArrays(bgGl.TRIANGLE_STRIP, 0, 4);
      }
    }
    function setParams(q) { var g = gl; PR = q; g.useProgram(prG); var G = U.G;
      g.uniform1f(G.uRefr, q.refraction); g.uniform1f(G.uBev, q.bevel); g.uniform1f(G.uChr, q.chroma); g.uniform1f(G.uBlur, q.blur); g.uniform1f(G.uTint, q.tint);
      g.uniform1f(G.uSpec, q.spec); g.uniform1f(G.uMag, q.magnify); g.uniform1f(G.uCurv, q.curve); g.uniform2f(G.uLt, q.lx, q.ly); }
    onmessage = function (m) {
      var q = m.data;
      try {
        if (q.init) {
          glc = new OffscreenCanvas(4, 4);
          gl = glc.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false, powerPreference: "low-power" });
          if (!gl) throw new Error("no webgl");
          glc.addEventListener("webglcontextlost", function (e) { e.preventDefault(); postMessage({ fail: "lost" }); });
          prB = prog(gl, q.vs, q.fsBg); prG = prog(gl, q.vs, q.fsGl);
          gl.useProgram(prB); quad(gl, prB); gl.useProgram(prG); quad(gl, prG);
          U.B = locs(gl, prB, SC.concat(["uRes"]), {}); U.G = locs(gl, prG, SC.concat("uBg uC uS uP uM uR uFl uDpr uSh uRefr uBev uChr uBlur uTint uSpec uMag uCurv uLt".split(" ")), {});
          if (q.bgc) {   // 화면 뒤 배경 캔버스(메인에서 넘겨받은 OffscreenCanvas) — 실패해도 유리는 계속(그땐 CSS 배경)
            try { bgc = q.bgc; bgGl = bgc.getContext("webgl", { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: "low-power" });
              if (bgGl) { bgPr = prog(bgGl, q.vs, q.fsBg); bgGl.useProgram(bgPr); quad(bgGl, bgPr); locs(bgGl, bgPr, SC.concat(["uRes"]), UB); } } catch (e) { bgGl = null; }
          }
          postMessage({ ready: 1, bg: !!bgGl }); return;
        }
        if (q.theme) { TH = q.theme; paintScene(); return; }
        if (q.view) { VW = q.view[0]; VH = q.view[1]; paintScene(); return; }
        if (q.params) { setParams(q.params); return; }
        var t0 = performance.now();
        if (glc.width !== q.pw || glc.height !== q.ph) { glc.width = q.pw; glc.height = q.ph; }
        gl.viewport(0, 0, q.pw, q.ph); gl.useProgram(prG); var G = U.G;
        gl.uniform2f(G.uC, q.cw, q.ch); gl.uniform2f(G.uS, q.w, q.h); gl.uniform2f(G.uP, q.x, q.y);
        gl.uniform1f(G.uM, q.m); gl.uniform1f(G.uR, q.r); gl.uniform1f(G.uFl, q.fl); gl.uniform1f(G.uSh, q.sh); gl.uniform1f(G.uDpr, q.pw / q.cw);
        gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        var bmp = glc.transferToImageBitmap();
        postMessage({ id: q.id, bmp: bmp, ms: performance.now() - t0 }, [bmp]);
      } catch (e) { postMessage({ fail: String(e && e.message || e), id: q.id }); }
    };
  }
  function hex(h) { return [parseInt(h.substr(1, 2), 16) / 255, parseInt(h.substr(3, 2), 16) / 255, parseInt(h.substr(5, 2), 16) / 255]; }
  /* 배경 장면의 빛 띠(법선 x,y · 위치 · 폭 — 화면 세로 기준 좌표)와 보케 원(cx%, cy%, 반지름 vmax, 세기 · 색) */
  var RICH = {
    dark: { rb: [[.6, .8, -.12, .16], [-.7, .71, .26, .11]], rc: [[90, 140, 255, .085], [60, 210, 200, .06]],
      bo: [[14, 70, 5.5, .13], [36, 24, 3.2, .16], [58, 62, 7, .09], [80, 22, 4.2, .14], [92, 78, 6, .10], [24, 92, 3, .12], [68, 92, 2.6, .14], [46, 8, 2.2, .12], [6, 30, 2.8, .10]],
      bc: [[80, 130, 255], [120, 170, 255], [70, 110, 230], [60, 200, 190], [130, 100, 255], [90, 150, 255], [70, 210, 200], [160, 190, 255], [110, 120, 255]] },
    light: { rb: [[.6, .8, -.12, .16], [-.7, .71, .26, .11]], rc: [[80, 130, 255, .07], [50, 180, 200, .05]],
      bo: [[14, 70, 5.5, .10], [36, 24, 3.2, .12], [58, 62, 7, .07], [80, 22, 4.2, .10], [92, 78, 6, .08], [24, 92, 3, .09], [68, 92, 2.6, .10], [46, 8, 2.2, .09], [6, 30, 2.8, .08]],
      bc: [[120, 160, 255], [150, 190, 255], [110, 150, 250], [100, 210, 210], [160, 140, 255], [130, 175, 255], [110, 215, 210], [180, 205, 255], [150, 160, 255]] }
  };
  var curTheme = "", hasBgCanvas = false;
  function setTheme(dark) {
    var k = dark ? "dark" : "light"; if (curTheme === k) return; curTheme = k;
    var T = LAYERS[k], X = RICH[k], L = new Float32Array(28), K = new Float32Array(28), Bo = new Float32Array(36), Bc = new Float32Array(36), Rb = new Float32Array(8), Rc = new Float32Array(8);
    T.l.forEach(function (x, i) { L.set([x[0], x[1], x[2], x[3]], i * 4); K.set([x[4] / 255, x[5] / 255, x[6] / 255, x[7]], i * 4); });
    X.bo.forEach(function (b, i) { Bo.set(b, i * 4); Bc.set([X.bc[i][0] / 255, X.bc[i][1] / 255, X.bc[i][2] / 255, 1], i * 4); });
    X.rb.forEach(function (b, i) { Rb.set(b, i * 4); Rc.set([X.rc[i][0] / 255, X.rc[i][1] / 255, X.rc[i][2] / 255, X.rc[i][3]], i * 4); });
    // 배경 캔버스가 없으면(OffscreenCanvas 넘기기 미지원) 장면을 CSS 와 같게(오로라만) — 굴절된 배경과 실제 배경이 어긋나지 않게
    wk.postMessage({ theme: { L: L, K: K, n: T.l.length, Bo: Bo, Bc: Bc, Rb: Rb, Rc: Rc, rich: (hasBgCanvas && P.rich) ? 1 : 0, b0: hex(T.base[0]), b1: hex(T.base[1]), b2: hex(T.base[2]), dk: dark ? 1 : 0 } });
  }
  function sendParams() {
    var dk = dark(), t = P.tint >= 0 ? P.tint : (dk ? .02 : .12);
    wk.postMessage({ params: { refraction: P.refraction, bevel: P.bevel, chroma: P.chroma, blur: P.blur, tint: t, spec: P.spec, magnify: P.magnify, curve: P.curve, lx: Math.sin(LT.a), ly: -Math.cos(LT.a) } });
    LT.drawnA = LT.a;
  }
  var wk, lost = false, started = false, bgCv = null;
  try {
    var bu = URL.createObjectURL(new Blob(["(" + WK.toString() + ")()"], { type: "text/javascript" }));
    wk = new Worker(bu);
  } catch (e) { return; }
  wk.onerror = function () { off(); };
  wk.onmessage = function (m) {
    var q = m.data;
    if (q.ready) { hasBgCanvas = !!q.bg; start(); return; }
    if (q.fail) { try { console.warn("[lux-liquid] WebGL 유리 끔 → CSS 유리:", q.fail); } catch (e) {} off(); return; }
    got(q);
  };
  (function () {   // 화면 뒤 배경 캔버스 — 메인은 OffscreenCanvas 로 넘기기만(그리는 건 워커)
    var msg = { init: 1, vs: VS, fsBg: FS_BG, fsGl: FS_GL }, tr = [];
    try {
      bgCv = D.createElement("canvas"); bgCv.id = "lgBg"; bgCv.setAttribute("aria-hidden", "true");
      bgCv.style.cssText = "position:fixed;inset:0;width:100vw;height:100vh;z-index:0;pointer-events:none;display:block";
      if (bgCv.transferControlToOffscreen) { var oc = bgCv.transferControlToOffscreen(); msg.bgc = oc; tr.push(oc); } else bgCv = null;
    } catch (e) { bgCv = null; }
    wk.postMessage(msg, tr);
  })();

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
      sp.innerHTML = '<div class="rg"></div><div class="sh"></div>';
      var st = D.createElement("style"); st.textContent = SPCSS;
      root.appendChild(st); root.appendChild(sp);
      it.sp = { el: sp, rg: sp.firstChild, sh: sp.lastChild };
    }
    it.host = host; it.cv = cv; it.ctx = null;
  }
  /* [V33.872] 빛 층을 다시: 종전 '빛 덩이 + 베벨 띠'는 띠 안쪽이 칼같이 잘려 카드마다 밝은 사각 띠·경계선이 보였다(조잡).
     → 테두리 1.25px 고리 하나에 원뿔 그라데이션(빛 쪽이 가장 밝고 둘레를 따라 매끈하게 옅어지며 반대편에 약한 반사) — 빛 방향(--lga)만 바뀐다.
     본체 광택은 아주 넓고 옅은 타원(가장자리 없음). 두 층 모두 자식 없는 요소라 변수 바뀌어도 그 요소만 다시 칠한다. */
  var SPCSS = ".sp{position:absolute;inset:" + M + "px;border-radius:var(--r);pointer-events:none}" +
    ".rg,.sh{position:absolute;inset:0;border-radius:inherit}" +
    ".rg{padding:1px;background:conic-gradient(from var(--lga,-37deg),rgba(255,255,255,.55),rgba(255,255,255,.18) 22deg,rgba(255,255,255,0) 55deg,rgba(255,255,255,0) 160deg,rgba(225,238,255,.16) 180deg,rgba(255,255,255,0) 200deg,rgba(255,255,255,0) 305deg,rgba(255,255,255,.18) 338deg,rgba(255,255,255,.55));" +
    "-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask:linear-gradient(#000 0 0) content-box exclude,linear-gradient(#000 0 0)}" +
    ".sh{background:radial-gradient(90% 80% at var(--sx,30%) var(--sy,20%),rgba(255,255,255,.065),rgba(255,255,255,.02) 45%,rgba(255,255,255,0) 75%)}";
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
    var dk = dark(); setTheme(dk); if (!LT.sent) { LT.sent = 1; sendParams(); }
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
    lost = true; H.classList.remove("lg-gl", "lg-bgc"); if (bgCv && bgCv.parentNode) bgCv.parentNode.removeChild(bgCv);
    items.forEach(function (it) { it.el.classList.remove("lg-g", "lg-fl"); freeIt(it); });
    items = []; ro.disconnect(); io.disconnect(); try { wk.terminate(); } catch (e) {}
  }

  /* ── [V33.870] 움직이는 빛 — 빛 방향 θ(0 = 위, 시계 방향) · 세기 k. 입력: 데스크톱 마우스 위치 · 폰 기울기(deviceorientation · iOS 는 첫 터치 때 한 번 허락 요청) ── */
  var RM = false; try { RM = matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) {}
  var LT = { a: -0.6435, k: .9, ta: -0.6435, tk: .9 }, lraf = 0;
  function bzOf(it) { return Math.max(8, Math.min(24, Math.min(it.w, it.h) * .14)); }
  function placeSpec(it) {
    var S = it.sp; if (!S || !it.w) return;
    S.rg.style.setProperty("--lga", LT.a.toFixed(3) + "rad");
    S.sh.style.setProperty("--sx", (50 + Math.sin(LT.a) * 30).toFixed(1) + "%"); S.sh.style.setProperty("--sy", (50 - Math.cos(LT.a) * 34).toFixed(1) + "%");
    S.el.style.opacity = LT.k.toFixed(3);
  }

  function specSize(it) { if (!it.sp) return; it.sp.el.style.setProperty("--r", it.r + "px"); placeSpec(it); }
  /* 빛이 멈추면(그리고 판을 그린 빛과 15° 넘게 다르면) 셰이더 광원(uLt)을 바꿔 보이는 판만 다시 그린다 — 1.2초에 한 번까지 */
  var stT = 0, stLast = 0;
  function settleLight() {
    if (!started || lost || LT.drawnA == null) return;
    var d = LT.a - LT.drawnA; d = Math.abs(Math.atan2(Math.sin(d), Math.cos(d))); if (d < .26) return;
    clearTimeout(stT); stT = setTimeout(function () { if (Date.now() - stLast < 1200) { stT = 0; settleLight(); return; } stLast = Date.now(); sendParams(); items.forEach(function (it) { if (it.vis) it.dirty = true; }); kick(0); }, Math.max(250, 1200 - (Date.now() - stLast)));
  }
  function lightLoop() {
    lraf = 0;
    var d = LT.ta - LT.a; d = Math.atan2(Math.sin(d), Math.cos(d));   // 가까운 쪽으로 돈다
    LT.a += d * .2; LT.k += (LT.tk - LT.k) * .2;
    for (var i = 0; i < items.length; i++) { var it = items[i]; if (it.vis && it.sp && it.drawn) placeSpec(it); }
    if (Math.abs(d) > .003 || Math.abs(LT.tk - LT.k) > .004) lraf = requestAnimationFrame(lightLoop);
    else settleLight();
  }
  function aim(vx, vy, k) { if (RM || LT.fixed) return; LT.ta = Math.atan2(vx, -vy); LT.tk = k; if (!lraf) lraf = requestAnimationFrame(lightLoop); }
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
  function sendView() { wk.postMessage({ view: [H.clientWidth, W.innerHeight] }); }
  var rzT = 0; addEventListener("resize", function () { clearTimeout(rzT); rzT = setTimeout(function () { sendView(); allDirty(false); }, 200); }, { passive: true });
  function init() {
    scan();
    new MutationObserver(function (ms) {
      for (var i = 0; i < ms.length; i++) { var m = ms[i]; if (m.removedNodes.length) { later(); return; } var a = m.addedNodes; for (var j = 0; j < a.length; j++) { var n = a[j]; if (n.nodeType === 1 && n.tagName !== "LG-GLASS") { later(); return; } } }
    }).observe(D.body, { childList: true, subtree: true });
    new MutationObserver(function () { setTheme(dark()); sendParams(); allDirty(false); }).observe(H, { attributes: true, attributeFilter: ["data-theme"] });
  }

  function start() {
    if (started || lost) return; started = true;
    var st = D.createElement("style"); st.id = "lgBg";
    st.textContent = "html.lg-gl:not([data-theme=\"light\"])::before{background:" + bgCss(LAYERS.dark) + ";opacity:1!important}" +
      "html.lg-gl[data-theme=\"light\"]::before{background:" + bgCss(LAYERS.light) + ";opacity:1!important}";
    if (hasBgCanvas && bgCv) st.textContent += "html.lg-bgc::before{opacity:0!important}";
    D.head.appendChild(st);
    H.classList.add("lg-gl");
    sendView(); setTheme(dark()); sendParams();
    if (hasBgCanvas && bgCv) { var ins = function () { D.body.insertBefore(bgCv, D.body.firstChild); H.classList.add("lg-bgc"); }; if (D.body) ins(); else D.addEventListener("DOMContentLoaded", ins); }
    if (D.readyState === "loading") D.addEventListener("DOMContentLoaded", init); else init();
  }
  /* ── 튜닝 파라미터 API · 디버그 패널(?glass=debug 또는 localStorage luxGlassDebug=1) ── */
  function setP(o, keep) {
    o = o || {}; var sc = false;
    Object.keys(o).forEach(function (k) { if (k === "light") { LT.fixed = true; LT.a = LT.ta = +o.light * Math.PI / 180; return; } if (k in P) { if (k === "rich") sc = true; P[k] = +o[k]; } });
    if (sc) { curTheme = ""; setTheme(dark()); }
    sendParams(); allDirty(false); if (LT.fixed) items.forEach(function (it) { if (it.sp) placeSpec(it); });
    if (!keep) try { localStorage.setItem("luxGlassP7", JSON.stringify(P)); } catch (e) {}
  }
  try { var sv = JSON.parse(localStorage.getItem("luxGlassP7") || "null"); if (sv) Object.keys(sv).forEach(function (k) { if (k in P) P[k] = +sv[k]; }); } catch (e) {}
  function debugPanel() {
    var dv = D.createElement("div"); dv.id = "lgDebug";
    dv.style.cssText = "position:fixed;right:12px;bottom:12px;z-index:99999;width:250px;padding:10px 12px;border-radius:14px;background:rgba(10,14,26,.88);color:#dfe7ff;font:12px/1.4 system-ui;box-shadow:0 10px 30px rgba(0,0,0,.5)";
    var F = [["refraction", "굴절", 0, 2.5, .05], ["chroma", "무지개", 0, 1, .02], ["blur", "흐림 px", 0, 12, .25], ["spec", "빛", 0, 2, .05], ["tint", "틴트(-1=기본)", -1, .5, .01], ["light", "광원 각도(고정)", -180, 180, 1]];
    dv.innerHTML = '<b>Liquid Glass</b> <a href="#" id="lgDbR" style="float:right;color:#8fb2ff">초기화</a>' + F.map(function (f) { var v = f[0] === "light" ? Math.round(LT.a * 180 / Math.PI) : P[f[0]]; return '<label style="display:block;margin-top:6px">' + f[1] + ' <span id="lgDv-' + f[0] + '">' + v + '</span><input type="range" min="' + f[2] + '" max="' + f[3] + '" step="' + f[4] + '" value="' + v + '" data-k="' + f[0] + '" style="width:100%"></label>'; }).join("");
    dv.addEventListener("input", function (e) { var k = e.target.getAttribute("data-k"); if (!k) return; D.getElementById("lgDv-" + k).textContent = e.target.value; var o = {}; o[k] = e.target.value; setP(o); });
    dv.querySelector("#lgDbR").addEventListener("click", function (e) { e.preventDefault(); try { localStorage.removeItem("luxGlassP7"); } catch (x) {} location.reload(); });
    D.body.appendChild(dv);
  }
  var dbg = false; try { dbg = /[?&]glass=debug/.test(location.search) || localStorage.getItem("luxGlassDebug") === "1"; } catch (e) {}
  if (dbg) { if (D.body) debugPanel(); else D.addEventListener("DOMContentLoaded", debugPanel); }
  function setMove(v) { LT.fixed = !v; if (!v) { LT.a = LT.ta = -0.6435; LT.k = LT.tk = .9; items.forEach(function (it) { if (it.sp) placeSpec(it); }); sendParams(); allDirty(false); } }
  if (!glMove()) LT.fixed = true;
  W.luxGlass = { failed: function () { return lost; }, move: setMove, params: P, set: setP, light: LT, webgl: function () { return started && !lost; }, items: function () { return items.length; }, drawn: function () { return items.filter(function (i) { return i.drawn; }).length; }, px: function () { return pxUsed; }, off: off, stats: stats, mt: MT };
})();
