// Codex V33.346: execute actual preparation/routing code, not merely its comments.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import vm from 'node:vm';
const src=readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
const cut=(a,b)=>src.slice(src.indexOf(a),src.indexOf(b,src.indexOf(a)));
// V33.351: session windows moved into marketWindows/marketSessionNow, so load that core first.
// Stub clocks report 08:10 KST on a weekday (day 5, minute 490) and no calendar date, so the
// special-day table is skipped and the default KR windows decide the session.
const ctx=vm.createContext({Date,Number,Math,JSON,isFinite,String,
 getKST:()=>({day:5,totalMin:490}),getUSEt:()=>({day:5,totalMin:490}),
 _num:(v,d)=>Number.isFinite(Number(v))?Number(v):d,DEFAULT_CFG:{extTrade:{freshMs:420000,minPrice:3,maxMovePct:12}}});
vm.runInContext(cut('const MARKET_HOURS = {','function isMarketOpen(market, now)')+
 cut('function applyKrOverMarket(o, d) {','// [PRE/POST 표시]')+
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
// The production write helpers preserve the complete quote bundle, never a fake timestamp.
const writes=vm.createContext({});
vm.runInContext(cut('function quoteSessionFields(q) {','function applyDisplayOverMarket(q) {'),writes);
assert.equal(writes.quoteSessionFields({pre:105,extTs:123}).extTs,123);
assert.equal(writes.quoteSessionFields({pre:105}).extTs,0);
assert.equal(writes.quoteSessionFields({mstate:'REGULAR'}).pre,null);
assert.match(cut('const prevQ = prevQuoteMap[sym]','quoteStmts.push('),/quoteSessionFields\(bq\)/);
assert.match(cut('const _qts = Date.now();','if (dailyRsi == null)'),/quoteSessionFields\(_quoteSource\)/);
assert.match(cut('const targets = Array.from(new Set(missing','if (stmts2.length)'),/quoteSessionFields\(q\)/);
// A-1: execute the common final guard with mocked committed ledger counts.
let count=0;
// V33.351: the session-start minute now comes from marketWindows, so load that core too.
const entry=vm.createContext({Date,Number,Math,String,
 _extSessionAt:()=> 'pre',extTradeSession:()=> 'pre',extTradePrice:()=>105,
 _num:(x,d)=>typeof x==='number'?x:d,_clamp:(x,a,b)=>Math.min(b,Math.max(a,x)),
 getUSEt:()=>({day:3,totalMin:490}),getKST:()=>({day:3,totalMin:490})});
vm.runInContext(cut('const MARKET_HOURS = {','function isMarketOpen(market, now)')+
 cut('async function extBuyGuard(','async function executeBuy('),entry);
const entryDB={prepare:()=>({bind(){return this;},first:async()=>({n:count})})};
const entryCfg={extTrade:{enabled:true,entries:true,minPickP:.62,sizeMult:.5,maxNewPerSession:2}};
const guard=(c=entryCfg,p=.7)=>entry.extBuyGuard(entryDB,'us',10,105,{mlMindP:p},c,{quote:{}},Date.now());
assert.equal((await guard()).qty,5);assert.equal((await guard(entryCfg,.61)).ok,false);
assert.equal((await guard({extTrade:{...entryCfg.extTrade,entries:false}})).ok,false);
count=2;assert.equal((await guard()).ok,false);
count=0;entry.extTradePrice=()=>null;assert.equal((await guard()).ok,false);
assert.match(cut('async function executeBuy(','const feeRate = market === "us" ? cfg.feeUS'),/await extBuyGuard/);
let riskLogs=[];
const risk=vm.createContext({Date,Math,isFinite,_num:(v,d)=>typeof v==='number'?v:d,
 extBuyGuard:async(_db,_m,q)=>({ok:true,qty:q}),_slipRate:()=>0,
 computeCashFromTrades:async()=>1000,riskPreTradeCheck:async()=>{throw Error('simulated unavailable');},
 log:async(...args)=>riskLogs.push(args)});
vm.runInContext(cut('async function executeBuy(','function getTrendSizing('),risk);
const cash={us:1000};
assert.equal(await risk.executeBuy({},'us','TEST','trend',1,100,{},null,{feeUS:0},cash),cash);
assert.ok(riskLogs.some(x=>String(x[3]).includes('사전거래 리스크 검사 실패')));
// Exercise Worker auto-recovery with a mock DB/fetch; never contacts a network.
const now=Date.now(), keys=['mind_model','dnn_trust','gbdt_trust','xgb_trust','lgb_trust','cat_trust'];
let models, dispatched, saved;
const recovery=vm.createContext({Date,JSON,Object,Math,isFinite,LUXML:{featVer:17},
 _num:(v,d)=>typeof v==='number'?v:d,
 getState:async()=>({fvDispatched:17}),getStates:async()=>models,setState:async(_db,_k,v)=>{saved=v;},log:async()=>{},
 fetch:async()=>{dispatched++;return {status:204};}});
const start=src.indexOf('async function _luxAutoRetrainModal(env) {');
vm.runInContext(cut('function latestExternalReceipt(live, shadow) {','async function _luxAutoRetrainModal(env) {'),recovery);
vm.runInContext(src.slice(start,src.indexOf('\n}',start)+2),recovery);
const db={prepare:()=>({bind(){return this;},async first(){return {c:1000};}})};
async function run(change){models=Object.fromEntries(keys.map(k=>[k,{source:'external',trainedAt:now-3600000,featVer:17}]));dispatched=0;change?.(models);await recovery._luxAutoRetrainModal({DB:db,GITHUB_TOKEN:'mock-only'});return dispatched;}
assert.equal(await run(),0);assert.equal(await run(m=>m.xgb_trust.featVer=15),1);
assert.equal(await run(m=>m.cat_trust.trainedAt=now-30*3600000),1);
assert.equal(await run(m=>delete m.lgb_trust),1);
assert.equal(await run(m=>{m.xgb_trust.featVer=15;m.xgb_trust_ext={source:'external',trainedAt:now,featVer:17,trusted:false};}),0,
 'fresh rejected shadow proves training receipt, not admission');
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
# [V33.376] _split_ts 는 홀드아웃 크기를 _holdout_rows(+정책표 HOLDOUT)에 물어본다 —
#   함수 하나만 떼어 오면 NameError 가 난다. ★같이 떼어 온다★(베끼지 않는다).
ns['HOLDOUT']=ast.literal_eval(next(n.value for n in tree.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='HOLDOUT' for t in n.targets)))
hrows=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='_holdout_rows')
exec(compile(ast.Module(body=[hrows],type_ignores=[]),'hrows','exec'),ns)
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
# B-2: execute SEQ preprocessing on out-of-order rows; validation must be beyond the embargo.
torch=types.ModuleType('torch'); torch.nn=types.ModuleType('torch.nn'); torch.device=lambda x:x; torch.cuda=types.SimpleNamespace(is_available=lambda:False)
sys.modules['torch']=torch; sys.modules['torch.nn']=torch.nn
ns['_build_sequences']=lambda X,TS,SYM,L:np.zeros((len(X),L),dtype=int)
f=copy.deepcopy(next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='_train_and_upload_seq'))
f.body=f.body[:next(i for i,n in enumerate(f.body) if isinstance(n,ast.ClassDef))]+ast.parse('return locals()').body
exec(compile(ast.fix_missing_locations(ast.Module(body=[f],type_ignores=[])),'seqprep','exec'),ns)
n=20000; rng=np.random.default_rng(11); TS=rng.permutation(np.arange(n)*86400000/100); X=np.column_stack([TS,TS/2]); Y=np.arange(n)%2
z=ns['_train_and_upload_seq']('','',{},X,Y,TS,np.array(['T']*n),17,2)
assert TS[z['_tri']].max()+10*86400000 < TS[z['_vai']].min()
assert np.allclose(z['mean'],X[z['_tri']].mean(axis=0))
assert len(z['_tri'])<n-len(z['_vai'])
try: ns['_split_ts'](np.ones(1000),.2,10*86400000)
except ValueError: pass
else: raise AssertionError('embargo silently abandoned')
print('SEQ embargo and training-only normalization verified')
# Targeted recovery runs only the requested auxiliary stage (not another full DNN pass).
# V33.350: the branch now looks the stage up in the single _PLAN table instead of repeating
# every trainer call, so pull _PLAN/_PLAN_BY in with it and stub the budget gate.
job=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='train_job')
branch=next(n for n in job.body if isinstance(n,ast.If) and ast.unparse(n.test)=="target not in ('all', 'dnn')")
plan=[n for n in job.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id in ('_PLAN','_PLAN_BY') for t in n.targets)]
assert len(plan)==2, 'expected a single _PLAN/_PLAN_BY definition in train_job'
tf=ast.parse('def run_target(target, dry=False): pass').body[0]
tf.body=[copy.deepcopy(x) for x in plan]+[copy.deepcopy(branch)]
calls=[]; ns.update(BASE='',KEY='',HDR={},X=X,Y=Y,TS=TS,SYM=np.array(['T']*n),featver=17,D=2,UNIQ=np.ones(n),cfg={},N=n,
                    PNL=np.ones(n),MKT=np.array(['us']*n),featnames=['f0','f1'],_ran=[],_skipped=[])
ns['_stage']=lambda name,fn:fn()
for _t in ('_train_and_upload_gbdt','_train_and_upload_boosters','_train_per_market',
           '_train_and_upload_scalp','_train_and_upload_memo'):
 ns[_t]=(lambda t: (lambda *a,**kw: calls.append(t)))(_t)
ns['_train_and_upload_seq']=lambda *a,**kw:calls.append('seq')
exec(compile(ast.fix_missing_locations(ast.Module(body=[tf],type_ignores=[])),'target','exec'),ns)
assert ns['run_target']('seq')['target']=='seq' and calls==['seq'], calls
ns['run_target']('seq',True); assert calls==['seq'], calls
# every other target routes to its own trainer and to nothing else
for _tg,_want in (('mind','_train_and_upload_gbdt'),('memo','_train_and_upload_memo'),
                  ('boosters','_train_and_upload_boosters'),('markets','_train_per_market'),
                  ('scalp','_train_and_upload_scalp')):
 calls.clear(); ns['run_target'](_tg); assert calls==[_want], (_tg,calls)
print('targeted recovery routes each stage through the single plan table')
`;
const r=spawnSync('python',['-c',py],{cwd:new URL('..',import.meta.url),encoding:'utf8',env:{...process.env,PYTHONUTF8:'1'}});
assert.equal(r.status,0,r.stdout+'\n'+r.stderr);console.log(r.stdout);
console.log('PASS: embargo weight alignment; all-model recovery; KR event provenance and v7 session timestamps');
