/* Model networks on the GPU (WebGL 1) — OMNI and, via netScenes.ts, every other model.
 *
 * Why: the old 2D-canvas renderer stroked ~37k lines on the CPU for every frame. On an iPhone
 * that meant the main thread (the one that also scrolls and handles taps) was busy most of the
 * time — the page felt frozen and rotating lagged. Here every line lives in one vertex buffer
 * and the vertex shader does rotation, perspective, depth fade and the dawn colour. A frame is
 * a handful of uniform writes + one drawArrays: well under 1 ms of JavaScript.
 *
 * OMNI geometry comes from the site's own scene builder (NeuralObservatory.omniCore) so the values
 * drawn are exactly the real weights / tree splits — nothing here invents data.
 */
const VS = `
attribute vec3 aP; attribute float aRing; attribute float aAng; attribute float aS; attribute float aK; attribute vec2 aAB;
uniform vec4 uR1[16]; uniform vec4 uR2[16];
uniform float uT, uCy, uSy, uCp, uSp, uScale, uExpo, uSel, uDim, uGR, uCA, uA0, uA1, uAE;
uniform vec2 uO; uniform vec2 uView;
varying vec4 vC;
vec3 dawn(float r){
  vec3 c0=vec3(1.0,.81,.71), c1=vec3(1.0,.33,.48), c2=vec3(.86,.27,.67), c3=vec3(.61,.38,.96), c4=vec3(.44,.57,1.0), c5=vec3(.63,.81,1.0);
  r=clamp(r,0.0,1.0);
  if(r<.15) return mix(c0,c1,r/.15);
  if(r<.38) return mix(c1,c2,(r-.15)/.23);
  if(r<.62) return mix(c2,c3,(r-.38)/.24);
  if(r<.84) return mix(c3,c4,(r-.62)/.22);
  return mix(c4,c5,(r-.84)/.16);
}
void main(){
  vec3 p=aP;
  if(aRing>-.5){
    vec4 a=uR1[0], b=uR2[0];
    for(int i=0;i<16;i++){ if(float(i)==aRing){ a=uR1[i]; b=uR2[i]; } }
    float an=aAng+uT*b.w;
    p=a.xyz*cos(an)*a.w+b.xyz*sin(an)*a.w;
  }
  float xr=p.x*uCy+p.z*uSy, zr=-p.x*uSy+p.z*uCy, yr=p.y*uCp-zr*uSp, dp=p.y*uSp+zr*uCp, k=900.0/(900.0+dp);
  vec2 s=vec2(xr*k*uScale, yr*k*uScale)+uO;
  gl_Position=vec4(s.x/uView.x*2.0-1.0, 1.0-s.y/uView.y*2.0, 0.0, 1.0);
  float df=clamp(.2+.8*(1.0-(dp+380.0)/760.0), .12, 1.0);
  vec3 col=(uCA>.5 && aRing<-.5)?dawn(aAng):dawn(length(s-uO)/uGR);
  float a;
  if(aK<5.5){
    float g=aK<.5?.55:aK<1.5?.8:aK<2.5?1.0:aK<3.5?.35:aK<4.5?.45:.9;
    float q=pow(clamp(aS*g*df*uDim,0.0,1.0),.62);
    a=(uA0+uA1*pow(q,uAE))*uExpo;
  } else if(aK<8.5){
    a=(.11+.24*clamp(aS*df,0.0,1.0))*uDim;
  } else if(aK<9.5){
    a=aS*uDim; col=vec3(.59,.77,1.0);
  } else if(aK<10.5){
    a=dp<0.0?.36:.1; col=vec3(.59,.77,1.0);
  } else {
    a=.6; col=vec3(1.0,.81,.71);
  }
  if(uSel>-.5 && (abs(aAB.x-uSel)<.5 || abs(aAB.y-uSel)<.5)){ a=.85; col=vec3(1.0,.81,.71); }
  vC=vec4(col*a,a);
}`;
const FS = `precision mediump float; varying vec4 vC; void main(){ gl_FragColor=vC; }`;

const STRIDE = 9; // aP(3) aRing aAng aS aK aAB(2)

export type OmniView = {
  destroy(): void; setSpin(on: boolean): void; setMotion(on: boolean): void;
  reset(): void; zoomBy(f: number): void; ok: boolean; why?: string;
};

export function createOmniGL(host: HTMLElement, sc: any, opts: { interactive: boolean; spin: boolean; motion: boolean; onPick?: (id: number, sc: any) => void; onSlow?: (why: string) => void }): OmniView {
  const wrap = document.createElement("div");
  wrap.style.cssText = "position:absolute;inset:0;overflow:hidden";
  const cv = document.createElement("canvas");
  cv.style.cssText = "position:absolute;inset:0;width:100%;height:100%";
  const deco = document.createElement("canvas");   // static glass shells + core lens (redrawn only on resize/zoom)
  deco.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none";
  const labels = document.createElement("div");
  labels.style.cssText = "position:absolute;inset:0;pointer-events:none;font:10px ui-monospace,Menlo,monospace;color:rgba(255,206,182,.9)";
  wrap.append(deco, cv, labels); host.append(wrap);

  /* 그래픽 가속이 없는 기기(소프트웨어 WebGL)는 계속 돌리면 그게 곧 멈춤이다 — 먼저 '가속 있음' 만 받아 보고,
     없으면 한 장만 그리고(손댈 때만 다시) 자동 움직임은 끈다. */
  const base = { alpha: true, antialias: true, premultipliedAlpha: true, powerPreference: "low-power" as WebGLPowerPreference };
  let soft = false;
  let gl = cv.getContext("webgl", Object.assign({ failIfMajorPerformanceCaveat: true }, base)) as WebGLRenderingContext | null;
  if (!gl) { gl = cv.getContext("webgl", base) as WebGLRenderingContext | null; soft = !!gl; }
  if (!gl) { wrap.remove(); return { ok: false, why: "nogl", destroy() {}, setSpin() {}, setMotion() {}, reset() {}, zoomBy() {} }; }

  const sh = (t: number, src: string) => { const s = gl.createShader(t)!; gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || "shader"); return s; };
  const pr = gl.createProgram()!;
  try { gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(pr); }
  catch (e) { wrap.remove(); return { ok: false, why: String(e), destroy() {}, setSpin() {}, setMotion() {}, reset() {}, zoomBy() {} }; }
  if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) { wrap.remove(); return { ok: false, why: "link", destroy() {}, setSpin() {}, setMotion() {}, reset() {}, zoomBy() {} }; }
  gl.useProgram(pr);

  // ── geometry (once) ──
  const P: Float32Array = sc.P, ring: Int16Array = sc.ring, ang: Float32Array = sc.ang;
  const la: Int32Array = sc.la, lb: Int32Array = sc.lb, ls: Float32Array = sc.ls, lk: Uint8Array = sc.lk, hi: Uint8Array | undefined = sc.hi;
  const tbody: any[] = sc.tbody || [], bands: number[] = sc.bands || [];
  let nSeg = la.length;
  if (hi) for (let j = 0; j < hi.length; j++) if (hi[j]) nSeg++;
  for (const tb of tbody) nSeg += Math.max(0, tb.ids.length - 1);
  const M = 120, HW = 9; nSeg += bands.length * M * 2;
  const buf = new Float32Array(nSeg * 2 * STRIDE);
  let o = 0;
  const vtx = (i: number, s: number, k: number, a: number, b: number) => {
    buf[o] = P[i * 3]; buf[o + 1] = P[i * 3 + 1]; buf[o + 2] = P[i * 3 + 2]; buf[o + 3] = ring[i]; buf[o + 4] = ang[i];
    buf[o + 5] = s; buf[o + 6] = k; buf[o + 7] = a; buf[o + 8] = b; o += STRIDE;
  };
  const raw = (x: number, y: number, z: number, s: number, k: number) => {
    buf[o] = x; buf[o + 1] = y; buf[o + 2] = z; buf[o + 3] = -1; buf[o + 4] = 0; buf[o + 5] = s; buf[o + 6] = k; buf[o + 7] = -9; buf[o + 8] = -9; o += STRIDE;
  };
  for (let j = 0; j < la.length; j++) { vtx(la[j], ls[j], lk[j], la[j], lb[j]); vtx(lb[j], ls[j], lk[j], la[j], lb[j]); }
  if (hi) for (let j = 0; j < hi.length; j++) if (hi[j]) { vtx(la[j], ls[j], 8, la[j], lb[j]); vtx(lb[j], ls[j], 8, la[j], lb[j]); }
  const tA = .065 * Math.min(1, 300 / Math.max(1, tbody.length)) ** .5;
  for (const tb of tbody) { const I = tb.ids, s = tA * Math.max(1, Math.min(4, Math.ceil(tb.v * 4)));
    for (let q = 1; q < I.length; q++) { vtx(I[q - 1], s, 9, -9, -9); vtx(I[q], s, 9, -9, -9); } }
  for (const ri of bands) { const R = sc.rings[ri], e1 = R.e1, e2 = R.e2, nn = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const pt = (j: number, sg: number) => { const a = Math.PI * 2 * j / M, c = Math.cos(a) * R.R, s = Math.sin(a) * R.R;
      return [e1[0] * c + e2[0] * s + nn[0] * HW * sg, e1[1] * c + e2[1] * s + nn[1] * HW * sg, e1[2] * c + e2[2] * s + nn[2] * HW * sg]; };
    for (const sg of [1, -1]) for (let j = 0; j < M; j++) { const a = pt(j, sg), b = pt(j + 1, sg); raw(a[0], a[1], a[2], 1, 10); raw(b[0], b[1], b[2], 1, 10); } }
  const nV = o / STRIDE;
  const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, buf, gl.STATIC_DRAW);
  // signal streaks: 120 short lines along the strongest weights, moved on the CPU (tiny)
  const top: number[] = sc.top || [];
  const sbuf = new Float32Array(top.length * 2 * STRIDE);
  const sb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, sb); gl.bufferData(gl.ARRAY_BUFFER, sbuf, gl.DYNAMIC_DRAW);

  const A = (n: string) => gl.getAttribLocation(pr, n), U = (n: string) => gl.getUniformLocation(pr, n);
  const at = { P: A("aP"), R: A("aRing"), G: A("aAng"), S: A("aS"), K: A("aK"), AB: A("aAB") };
  const bindAttrs = (b: WebGLBuffer | null) => {
    gl.bindBuffer(gl.ARRAY_BUFFER, b); const F = 4 * STRIDE;
    gl.enableVertexAttribArray(at.P); gl.vertexAttribPointer(at.P, 3, gl.FLOAT, false, F, 0);
    gl.enableVertexAttribArray(at.R); gl.vertexAttribPointer(at.R, 1, gl.FLOAT, false, F, 12);
    gl.enableVertexAttribArray(at.G); gl.vertexAttribPointer(at.G, 1, gl.FLOAT, false, F, 16);
    gl.enableVertexAttribArray(at.S); gl.vertexAttribPointer(at.S, 1, gl.FLOAT, false, F, 20);
    gl.enableVertexAttribArray(at.K); gl.vertexAttribPointer(at.K, 1, gl.FLOAT, false, F, 24);
    gl.enableVertexAttribArray(at.AB); gl.vertexAttribPointer(at.AB, 2, gl.FLOAT, false, F, 28);
  };
  const u = { CA: U("uCA"), A0: U("uA0"), A1: U("uA1"), AE: U("uAE"), R1: U("uR1"), R2: U("uR2"), T: U("uT"), Cy: U("uCy"), Sy: U("uSy"), Cp: U("uCp"), Sp: U("uSp"), Sc: U("uScale"), Ex: U("uExpo"), Sel: U("uSel"), Dim: U("uDim"), GR: U("uGR"), O: U("uO"), View: U("uView") };
  const r1 = new Float32Array(64), r2 = new Float32Array(64);
  (sc.rings || []).slice(0, 16).forEach((R: any, i: number) => { r1.set([R.e1[0], R.e1[1], R.e1[2], R.R], i * 4); r2.set([R.e2[0], R.e2[1], R.e2[2], R.w], i * 4); });
  gl.uniform4fv(u.R1, r1); gl.uniform4fv(u.R2, r2);
  gl.uniform1f(u.Ex, Math.max(.3, Math.min(1, 15000 / Math.max(1, la.length))));
  const al: number[] = sc.alpha || [.003, .6, 3.4];
  gl.uniform1f(u.CA, sc.colorByAttr ? 1 : 0); gl.uniform1f(u.A0, al[0]); gl.uniform1f(u.A1, al[1]); gl.uniform1f(u.AE, al[2]);
  gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); gl.disable(gl.DEPTH_TEST); gl.clearColor(0, 0, 0, 0);

  // ── view state ──
  const Y0 = typeof sc.yaw === "number" ? sc.yaw : .4;
  const Z0 = typeof sc.zoom === "number" ? sc.zoom : 1;
  const v = { yaw: Y0, pitch: .32, zoom: Z0, panX: 0, panY: 0, sel: -1, spin: opts.spin && !soft, motion: opts.motion && !soft, t: 0 };
  if (soft && opts.onSlow) setTimeout(() => opts.onSlow && opts.onSlow("soft"), 0);
  let ema = 0, seen = 0;   // 자동 움직임 중 장면 간격(ms) — 느리면 스스로 멈춘다
  let W = 1, H = 1, dpr = 1, raf = 0, last = 0, dead = false, visible = true, decoKey = "";
  const hz: string[] = sc.hz || [];
  const HZT: Record<string, string> = { "30m": "30분", "60m": "60분", "1d": "1일", "5d": "5일", "20d": "20일" };
  const named: { id: number; text: string; from?: number }[] = sc.labels || (sc.groups.find((g: any) => g.kind === 3) || { ids: [] }).ids.map((id: number, k: number) => ({ id, text: "✳ " + (HZT[hz[k]] || hz[k] || "") }));
  const heads = named.map((l) => l.id);
  const lab = named.map((l) => { const s = document.createElement("span"); s.textContent = l.text; s.style.cssText = "position:absolute;left:0;top:0;white-space:nowrap;will-change:transform;text-shadow:0 0 6px #0b0712"; labels.append(s); return s; });

  const scale = () => Math.min(W, H) / 800 * v.zoom;
  const proj = (x: number, y: number, z: number) => {
    const cy = Math.cos(v.yaw), sy = Math.sin(v.yaw), cp = Math.cos(v.pitch), sp = Math.sin(v.pitch);
    const xr = x * cy + z * sy, zr = -x * sy + z * cy, yr = y * cp - zr * sp, dp = y * sp + zr * cp, k = 900 / (900 + dp), s = scale();
    return [xr * k * s + W / 2 + v.panX, yr * k * s + H / 2 + v.panY, dp];
  };
  function drawDeco() {
    const key = W + "x" + H + ":" + v.zoom.toFixed(3) + ":" + v.panX + ":" + v.panY;
    if (key === decoKey) return; decoKey = key;
    deco.width = Math.round(W * dpr); deco.height = Math.round(H * dpr);
    const c = deco.getContext("2d"); if (!c) return;
    c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, W, H); c.globalCompositeOperation = "lighter";
    const ox = W / 2 + v.panX, oy = H / 2 + v.panY, s = scale(), SH = sc.shells || [], COL = ["196,160,255", "255,104,146", "255,104,146"];
    SH.forEach((R0: number, q: number) => { const rr = R0 * s, col = COL[q] || COL[2];
      const g = c.createRadialGradient(ox, oy, rr * .62, ox, oy, rr); g.addColorStop(0, `rgba(${col},0)`); g.addColorStop(.86, `rgba(${col},${.016 + .008 * q})`); g.addColorStop(1, `rgba(${col},${.07 - .012 * q})`);
      c.fillStyle = g; c.beginPath(); c.arc(ox, oy, rr, 0, Math.PI * 2); c.fill();
      c.lineWidth = 1; c.strokeStyle = "rgba(196,160,255,.3)"; c.beginPath(); c.arc(ox, oy, rr, 0, Math.PI * 2); c.stroke();
      c.lineWidth = 2.2; c.lineCap = "round"; c.strokeStyle = "rgba(255,206,182,.5)"; c.beginPath(); c.arc(ox, oy, rr * .93, -2.62, -1.86); c.stroke(); });
    if (sc.core === false) return;
    const cr = 62 * s, cg = c.createRadialGradient(ox, oy, 0, ox, oy, cr); cg.addColorStop(0, "rgba(255,206,182,.22)"); cg.addColorStop(.35, "rgba(255,104,146,.08)"); cg.addColorStop(1, "rgba(255,104,146,0)");
    c.fillStyle = cg; c.beginPath(); c.arc(ox, oy, cr, 0, Math.PI * 2); c.fill();
  }
  function size() {
    const r = host.getBoundingClientRect(); const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    dpr = Math.min(window.devicePixelRatio || 1, opts.interactive ? 2 : 1.5);
    if (w === W && h === H && cv.width === Math.round(w * dpr)) return;
    W = w; H = h; cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); decoKey = ""; kick();
  }
  function frame(now: number) {
    raf = 0; if (scrolling) { owed = true; return; } if (dead || !visible || document.hidden) return; owed = false;
    if (!opts.interactive && last && now - last < 31 && (v.spin || v.motion) && !ptr.size) { kick(); return; }   // inline view: 30 fps is plenty (battery)
    const iv = last ? now - last : 0;
    if (iv > 0 && iv < 1000 && (v.spin || v.motion) && !ptr.size) { ema = ema ? ema * .85 + iv * .15 : iv;
      if (++seen > 12 && ema > (opts.interactive ? 90 : 75)) { v.spin = false; v.motion = false; if (opts.onSlow) opts.onSlow("slow"); } }
    const dt = last ? Math.min(.1, iv / 1000) : 0; last = now;
    if (v.spin) v.yaw += dt * .08;
    if (v.motion) v.t += dt;
    drawDeco();
    gl.viewport(0, 0, cv.width, cv.height); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform1f(u.T, v.t); gl.uniform1f(u.Cy, Math.cos(v.yaw)); gl.uniform1f(u.Sy, Math.sin(v.yaw)); gl.uniform1f(u.Cp, Math.cos(v.pitch)); gl.uniform1f(u.Sp, Math.sin(v.pitch));
    const s = scale(); gl.uniform1f(u.Sc, s); gl.uniform2f(u.O, W / 2 + v.panX, H / 2 + v.panY); gl.uniform2f(u.View, W, H);
    gl.uniform1f(u.GR, (sc.shells ? sc.shells[0] : 300) * 1.42 * s); gl.uniform1f(u.Sel, v.sel); gl.uniform1f(u.Dim, v.sel >= 0 ? .35 : 1);
    bindAttrs(vb); gl.drawArrays(gl.LINES, 0, nV);
    if (v.motion && top.length) {   // streaks: 3D lerp along the strongest weights (their endpoints are fixed neurons)
      let p = 0;
      for (let j = 0; j < top.length; j++) { const e = top[j], a = la[e], b = lb[e], uu = (v.t * .35 + j * .618) % 1, u2 = Math.min(1, uu + .1);
        for (const w of [uu, u2]) { sbuf[p] = P[a * 3] + (P[b * 3] - P[a * 3]) * w; sbuf[p + 1] = P[a * 3 + 1] + (P[b * 3 + 1] - P[a * 3 + 1]) * w; sbuf[p + 2] = P[a * 3 + 2] + (P[b * 3 + 2] - P[a * 3 + 2]) * w;
          sbuf[p + 3] = -1; sbuf[p + 4] = 0; sbuf[p + 5] = 1; sbuf[p + 6] = 11; sbuf[p + 7] = -9; sbuf[p + 8] = -9; p += STRIDE; } }
      gl.bindBuffer(gl.ARRAY_BUFFER, sb); gl.bufferSubData(gl.ARRAY_BUFFER, 0, sbuf); bindAttrs(sb); gl.drawArrays(gl.LINES, 0, top.length * 2);
    }
    heads.forEach((i, k) => { const q = proj(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]), f = named[k].from, o = f != null ? proj(P[f * 3], P[f * 3 + 1], P[f * 3 + 2]) : [W / 2 + v.panX, H / 2 + v.panY], dx = q[0] - o[0], dy = q[1] - o[1], l = Math.hypot(dx, dy) || 1;
      lab[k].style.transform = `translate(${(q[0] + dx / l * 14 - 14).toFixed(1)}px,${(q[1] + dy / l * 14 - 7).toFixed(1)}px)`; });
    if (v.spin || v.motion) kick();
  }
  function kick() { if (scrolling) { owed = true; return; } if (!raf && !dead && visible && !document.hidden) raf = requestAnimationFrame(frame); }

  // ── interaction (desktop always; touch only in full-screen mode) ──
  const ptr = new Map<number, { x: number; y: number }>(); let moved = false;
  const coarse = window.matchMedia && matchMedia("(pointer:coarse)").matches;
  if (opts.interactive || !coarse) {
    cv.style.cursor = "grab";
    cv.addEventListener("pointerdown", (e) => { try { cv.setPointerCapture(e.pointerId); } catch (er) { /* */ } ptr.set(e.pointerId, { x: e.clientX, y: e.clientY }); moved = false; });
    cv.addEventListener("pointermove", (e) => { const p0 = ptr.get(e.pointerId); if (!p0) return;
      const dx = e.clientX - p0.x, dy = e.clientY - p0.y, other = [...ptr.entries()].find(([k]) => k !== e.pointerId)?.[1];
      if (other) { const b0 = Math.hypot(p0.x - other.x, p0.y - other.y), b1 = Math.hypot(e.clientX - other.x, e.clientY - other.y); if (b0 > 4) v.zoom = Math.max(.5, Math.min(6, v.zoom * b1 / b0)); }
      else { v.yaw -= dx * .006; v.pitch = Math.max(-1.3, Math.min(1.3, v.pitch + dy * .006)); }
      if (Math.abs(dx) + Math.abs(dy) > 2) { moved = true; v.spin = false; }
      ptr.set(e.pointerId, { x: e.clientX, y: e.clientY }); kick(); });
    const up = (e: PointerEvent) => { ptr.delete(e.pointerId); if (moved || e.type === "pointercancel") return; pick(e.clientX, e.clientY); };
    cv.addEventListener("pointerup", up); cv.addEventListener("pointercancel", up);
    cv.addEventListener("wheel", (e) => { if (!(e.ctrlKey || e.metaKey || opts.interactive)) return; e.preventDefault(); v.zoom = Math.max(.5, Math.min(6, v.zoom * Math.exp(-e.deltaY * .002))); kick(); }, { passive: false });
  }
  function pick(cx: number, cy: number) {
    const r = cv.getBoundingClientRect(), x = cx - r.left, y = cy - r.top; let best = 196, hit = -1;
    const kind: Uint8Array = sc.kind;
    for (let i = 0; i < sc.n; i++) { if (kind[i] > 4) continue; const q = proj(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]); const d = (q[0] - x) ** 2 + (q[1] - y) ** 2; if (d < best) { best = d; hit = i; } }
    v.sel = hit; kick(); if (opts.onPick) opts.onPick(hit, sc);
  }

  /* 페이지가 스크롤되는 동안 화면 속 그림은 멈춘다 — 그 사이 GPU·메인 스레드를 스크롤에 다 준다. 멈추면 200ms 뒤 이어서. */
  let scrolling = false, scrollT = 0, owed = false;   // owed: 스크롤 중에 미뤄진 그리기가 있다
  const onScroll = () => { if (opts.interactive) return; scrolling = true; clearTimeout(scrollT); scrollT = window.setTimeout(() => { scrolling = false; if (owed || v.spin || v.motion) { last = 0; kick(); } }, 200); };
  document.addEventListener("scroll", onScroll, { capture: true, passive: true });
  const ro = new ResizeObserver(size); ro.observe(host);
  const io = new IntersectionObserver((en) => { visible = en[0].isIntersecting; if (visible) { last = 0; kick(); } }); io.observe(host);
  const vis = () => { if (!document.hidden) { last = 0; kick(); } };
  document.addEventListener("visibilitychange", vis);
  const lost = (e: Event) => { e.preventDefault(); dead = true; };
  cv.addEventListener("webglcontextlost", lost);
  size(); kick();

  return {
    ok: true,
    destroy() { dead = true; cancelAnimationFrame(raf); clearTimeout(scrollT); document.removeEventListener("scroll", onScroll, { capture: true }); ro.disconnect(); io.disconnect(); document.removeEventListener("visibilitychange", vis);
      try { gl.deleteBuffer(vb); gl.deleteBuffer(sb); gl.deleteProgram(pr); const ext = gl.getExtension("WEBGL_lose_context"); if (ext) ext.loseContext(); } catch (e) { /* */ }
      cv.width = cv.height = 0; deco.width = deco.height = 0; wrap.remove(); },
    setSpin(on) { v.spin = on; last = 0; kick(); },
    setMotion(on) { v.motion = on; last = 0; kick(); },
    reset() { v.yaw = Y0; v.pitch = .32; v.zoom = Z0; v.panX = v.panY = 0; v.sel = -1; kick(); },
    zoomBy(f) { v.zoom = Math.max(.5, Math.min(6, v.zoom * f)); kick(); },
  };
}
