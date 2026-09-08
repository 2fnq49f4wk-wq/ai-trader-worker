// Codex V33.324: executable replacement renderer contracts, independent of SVG markup.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const context=vm.createContext({});
vm.runInContext(readFileSync(new URL('../public/neural-observatory.js',import.meta.url),'utf8'),context);
const N=context.NeuralObservatory;
const layers=[75,640,512,384,256,128,64,32,16,1].map((count,l)=>({tag:'L'+l,strength:Array.from({length:count},(_,i)=>i/count)}));
const dense=N.dense(layers);
assert.equal(dense.nodes.length,layers.reduce((s,l)=>s+l.strength.length,0));
const covered=new Set(dense.edges.flatMap(e=>[e.a,e.b]));
assert.equal(covered.size,dense.nodes.length,'all neurons participate in the structural graph');
for(const n of dense.nodes) assert.equal(n.v,layers[n.l].strength[n.i]);
const L=16,D=75,width=32;
const rows=v=>Array.from({length:L},(_,t)=>Array.from({length:width},(_,i)=>v+t+i/100));
const one=k=>Array.from({length:L},(_,i)=>i===k?1:0);
const d={trained:true,L,D,d:width,layers:2,attnByBlock:[
  [Array.from({length:L},()=>one(3)),Array.from({length:L},()=>one(9))],
  [Array.from({length:L},(_,i)=>one(i))]],
  nodes:{proj:rows(1),byBlock:[{attn:rows(2),ffn:rows(3)},{attn:rows(4),ffn:rows(5)}]},
  vizSeq:Array.from({length:L},()=>Array.from({length:D},(_,i)=>-i)),attnP:.75};
const s={block:0,head:-1,row:15,detail:true,spread:1};
const a=N.attention(d,s);assert.equal(a[3],.5);assert.equal(a[9],.5);
assert.equal(N.attention(d,{...s,head:0})[3],1);
assert.equal(N.attention(d,{...s,block:1,row:7})[7],1);
assert.equal(N.attention({...d,trained:false},s),null);
assert.equal(N.attention({...d,attnByBlock:[]},s),null);
const seq=N.sequence(d,s);
assert.equal(seq.nodes.length,L*(D+width*3)+1);
assert.equal(seq.nodes.filter(n=>n.l===4).length,1);
assert.equal(seq.nodes.find(n=>n.l===4).t,L-1);
assert.equal(seq.nodes.find(n=>n.l===0&&n.i===74).v,-74);
const block2=N.sequence(d,{...s,block:1});
assert.equal(block2.nodes.find(n=>n.l===2&&n.t===7&&n.i===3).v,11.03);
for(const n of N.sequence({...d,trained:false},s).nodes) assert.equal(n.v,null);
assert.equal(N.sequence({...d,trained:false},s).edges.filter(e=>e.attention).length,0);
const lite=N.sequence(d,{...s,detail:false});
assert.ok(lite.nodes.length<800,'overview has bounded cost');
assert.equal(lite.nodes.filter(n=>n.l===0&&n.t===15).length,D,'selected time retains all features');
for(const scene of [dense,seq,lite,block2]){
  for(const n of scene.nodes)for(const k of ['x','y','z'])assert.ok(Number.isFinite(n[k]));
  for(const e of scene.edges)assert.ok(scene.nodes[e.a]&&scene.nodes[e.b]);
}
const p={x:100,y:40,z:80};
assert.notEqual(N.project(p,{yaw:0,pitch:0}).x,N.project(p,{yaw:.7,pitch:.3}).x);
assert.ok(N.project({x:100,y:0,z:-200},{yaw:0,pitch:0}).k>N.project({x:100,y:0,z:200},{yaw:0,pitch:0}).k);
const spread=N.sequence(d,{...s,spread:1.8});
assert.equal(spread.nodes[0].x,seq.nodes[0].x*1.8);
console.log('PASS new neural engine: neuron coverage, values, block/head/time selection, missing data, 3D projection, detail budget');
