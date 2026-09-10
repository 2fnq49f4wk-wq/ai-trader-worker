// Codex V33.346: execute actual preparation/routing code, not merely its comments.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import vm from 'node:vm';
const src=readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
const cut=(a,b)=>src.slice(src.indexOf(a),src.indexOf(b,src.indexOf(a)));
const ctx=vm.createContext({Date,Number,Math,JSON,isFinite, getKST:()=>({day:5,totalMin:490}),
 _num:(v,d)=>Number.isFinite(Number(v))?Number(v):d,DEFAULT_CFG:{extTrade:{freshMs:420000,minPrice:3,maxMovePct:12}}});
vm.runInContext(cut('function applyKrOverMarket(o, d) {','// [PRE/POST 표시]')+
 cut('function extTradePriceEx(q, session, cfg) {','// [V8.6] 엔진이 거래해도 되는 시간'),ctx);
const stamp=new Date(Date.now()-60000).toISOString();
const info={tradingSessionType:'PRE_MARKET',overMarketStatus:'OPEN',overPrice:'105',localTradedAt:stamp};
const make=(i=info)=>ctx.applyKrOverMarket({prevClose:100},{ms:'PREOPEN',nxtOverMarketPriceInfo:i});
assert.equal(make().extTs,Date.parse(stamp));assert.equal(ctx.extTradePrice(make(),'pre'),105);
assert.equal(ctx.extTradePrice(make({...info,localTradedAt:new Date(Date.now()-3600000).toISOString()}),'pre'),null);
assert.equal(ctx.extTradePrice(make({...info,localTradedAt:undefined}),'pre'),null);
assert.equal(ctx.extTradePrice(make({...info,overMarketStatus:'CLOSE'}),'pre'),null);
assert.equal(ctx.extTradePrice(make({...info,localTradedAt:new Date(Date.now()+3600000).toISOString()}),'pre'),null);
assert.equal(make({...info,tradingSessionType:'AFTER_MARKET'}).pre,undefined);
const best=ctx.applyKrOverMarket({prevClose:100},{ms:'PREOPEN',overMarketPriceInfo:{...info,overPrice:'90',localTradedAt:new Date(Date.now()-3600000).toISOString()},nxtOverMarketPriceInfo:info});
assert.equal(best.pre,105,'prefer freshest matching venue');
ctx.getKST=()=>({day:5,totalMin:530});assert.equal(make().extTs,0,'NXT pre closes 08:50');
ctx.getKST=()=>({day:5,totalMin:939});assert.equal(make({...info,tradingSessionType:'AFTER_MARKET'}).extTs,0,'NXT 15:39 collects orders only');
ctx.getKST=()=>({day:5,totalMin:940});assert.equal(make({...info,tradingSessionType:'AFTER_MARKET'}).extTs,Date.parse(stamp),'NXT after opens 15:40');
ctx.getKST=()=>({day:0,totalMin:490});assert.equal(make().mstate,'CLOSED');
// Test v7 parser with BOTH session prices: yesterday's post time cannot overwrite today's pre time.
const v7=vm.createContext({out:{}});
vm.runInContext(cut('  function parseV7(j) {','  /* [V33.331] ★시간외 필드를'),v7);
v7.parseV7({quoteResponse:{result:[{symbol:'T',regularMarketPrice:100,preMarketPrice:105,preMarketTime:2000,postMarketPrice:99,postMarketTime:1000,marketState:'PRE'}]}});
assert.equal(v7.out.T.extTs,2000000);
// Exercise Worker auto-recovery with a mock DB/fetch; never contacts a network.
const now=Date.now(), keys=['mind_model','dnn_trust','gbdt_trust','xgb_trust','lgb_trust','cat_trust'];
let models, dispatched, saved;
const recovery=vm.createContext({Date,JSON,Object,Math,isFinite,LUXML:{featVer:17},
 getState:async()=>({fvDispatched:17}),getStates:async()=>models,setState:async(_db,_k,v)=>{saved=v;},log:async()=>{},
 fetch:async()=>{dispatched++;return {status:204};}});
const start=src.indexOf('async function _luxAutoRetrainModal(env) {');
vm.runInContext(src.slice(start,src.indexOf('\n}',start)+2),recovery);
const db={prepare:()=>({bind(){return this;},async first(){return {c:1000};}})};
async function run(change){models=Object.fromEntries(keys.map(k=>[k,{source:'external',trainedAt:now-3600000,featVer:17}]));dispatched=0;change?.(models);await recovery._luxAutoRetrainModal({DB:db,GITHUB_TOKEN:'mock-only'});return dispatched;}
assert.equal(await run(),0);assert.equal(await run(m=>m.xgb_trust.featVer=15),1);
assert.equal(await run(m=>m.cat_trust.trainedAt=now-30*3600000),1);
assert.equal(await run(m=>delete m.lgb_trust),1);
const py=String.raw`
import ast, copy, pathlib, numpy as np, sys, types
sys.dont_write_bytecode=True
sys.modules['requests']=types.ModuleType('requests') # prep-only: no network dependency or requests
sys.path.insert(0,'tools')
from modal_freshness import oldest_required_age, REQUIRED
p={'externalTrain':{k:dict(trained=True,external=True,ageH=1,featVer=17,wantVer=17) for k in REQUIRED}}
assert oldest_required_age(p)==1
p['externalTrain']['cat']['ageH']=30
assert oldest_required_age(p)==30
p['externalTrain']['cat']['featVer']=15
assert oldest_required_age(p)==9999
tree=ast.parse(pathlib.Path('trainer/modal/modal_train.py').read_text(encoding='utf-8'))
ns={'_EMBARGO_MS':10*86400000,'_HORIZON_MS':10*86400000,'_uw_pick':lambda u,n,i:np.asarray(u)[i]}
ns['MIN_PER_MARKET']=ast.literal_eval(next(n.value for n in tree.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='MIN_PER_MARKET' for t in n.targets)))
split=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='_split_ts')
exec(compile(ast.Module(body=[split],type_ignores=[]),'split','exec'),ns)
for name in ('_train_and_upload_boosters','_train_per_market'):
 f=copy.deepcopy(next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name==name))
 if name.endswith('boosters'):
  f.body=f.body[:next(i for i,n in enumerate(f.body) if isinstance(n,ast.FunctionDef) and n.name=='_wout')]
  f.body+=ast.parse('return locals()').body
 else:
  loop=next(n for n in f.body if isinstance(n,ast.For))
  idx=next(i for i,n in enumerate(loop.body) if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='cand' for t in n.targets))
  loop.body=loop.body[:idx]+ast.parse('return locals()').body
  f.body=f.body[:f.body.index(loop)+1]
 exec(compile(ast.fix_missing_locations(ast.Module(body=[f],type_ignores=[])),'prep','exec'),ns)
 n=5000; X=np.arange(n*4).reshape(n,4); Y=np.arange(n)%2; TS=np.arange(n)*86400000/10; PNL=np.sin(np.arange(n))+2; U=np.ones(n)
 if name.endswith('boosters'): z=ns[name]('', '', {}, X,Y,TS,17,4,PNL,U)
 else: z=ns[name]('', '', {},np.array(['us']*n),X,Y,TS,PNL,17,4,U)
 assert len(z['Xtr'])==len(z['Wtr']), (name,len(z['Xtr']),len(z['Wtr']))
 assert np.array_equal(z['Wtr'],z['W'][z['_tri']])
 assert len(z['W'][:-z['nval']])!=len(z['Xtr']), 'fixture must detect old broken slice'
 print(name,'aligned rows',len(z['Xtr']))
`;
const r=spawnSync('python',['-c',py],{cwd:new URL('..',import.meta.url),encoding:'utf8',env:{...process.env,PYTHONUTF8:'1'}});
assert.equal(r.status,0,r.stdout+'\n'+r.stderr);console.log(r.stdout);
console.log('PASS: embargo weight alignment; all-model recovery; KR event provenance and v7 session timestamps');
