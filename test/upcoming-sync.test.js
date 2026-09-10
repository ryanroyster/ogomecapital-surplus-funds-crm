const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.join(__dirname,'..');
const parts=Array.from({length:8},(_,i)=>fs.readFileSync(path.join(root,'crm_parts',`part0${i+1}.html`),'utf8'));
const html=parts.join('');
const seedsCode=html.slice(html.indexOf('const upcomingAuctions = ['),html.indexOf('function daysUntil('));
const cloud=parts[4];
function context(saved=[]){
  const storage=new Map([['surplusCRM_upcoming_v1',JSON.stringify(saved)]]);
  const ctx=vm.createContext({console,localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},cloudReady:()=>false});
  vm.runInContext(seedsCode,ctx);
  return {ctx,storage,run:s=>vm.runInContext(s,ctx)};
}
test('all assembled scripts parse and visual markup remains separate',()=>{
  for(const m of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g))new vm.Script(m[1]);
});
test('seeds and saved overrides survive reload without duplicate IDs',()=>{
  const initial=context();
  const seeds=JSON.parse(initial.run('JSON.stringify(upcomingAuctions)'));
  assert.equal(seeds.length,3);
  assert.deepEqual(seeds.map(x=>x.owner),['John P. Love Jr.',"David J. O'Leary",'Darlene Sims / James Sims']);
  initial.run('saveUpcomingAuctions()');
  assert.deepEqual(JSON.parse(initial.storage.get('surplusCRM_upcoming_v1')),seeds);
  const revised={...seeds[0],notes:'Locally updated research'};
  const next=context([revised,{id:'test-import',owner:'Synthetic test candidate'}]);
  assert.equal(next.run('upcomingAuctions.length'),4);
  assert.equal(next.run('upcomingAuctions[0].notes'),revised.notes);
});
test('uploads include seeds and queue imports arriving during an upload',async()=>{
  const {ctx,run}=context();
  let release;const pending=new Promise(r=>release=r);const calls=[];
  ctx.cloudReady=()=>true;
  ctx.cloudRequest=async(p,o)=>{calls.push(JSON.parse(o.body));if(calls.length===1)await pending;return {ok:true};};
  run(cloud.slice(cloud.indexOf('let upcomingSyncFlight='),cloud.indexOf('async function restoreUpcomingSync')));
  const first=run('cloudSyncUpcoming()');
  assert.equal(calls[0].upcoming.length,3);
  run("upcomingAuctions.push({id:'test-import'})");
  const second=run('cloudSyncUpcoming()');
  release();await Promise.all([first,second]);
  assert.equal(calls.length,2);assert.equal(calls[1].upcoming.length,4);
});
test('failed upload keeps local data and can retry',async()=>{
  const {ctx,run,storage}=context();ctx.cloudReady=()=>true;
  ctx.cloudRequest=async()=>{throw new Error('offline')};
  run(cloud.slice(cloud.indexOf('let upcomingSyncFlight='),cloud.indexOf('async function restoreUpcomingSync')));
  await assert.rejects(run('cloudSyncUpcoming()'),/offline/);
  assert.equal(run('upcomingSyncPending'),true);
  assert.equal(JSON.parse(storage.get('surplusCRM_upcoming_v1')).length,3);
  ctx.cloudRequest=async()=>({ok:true});await run('cloudSyncUpcoming()');
  assert.equal(run('upcomingSyncPending'),false);
});
test('session restore preserves cloud payloads while adding missing seeds',async()=>{
  const {ctx,run}=context();ctx.cloudReady=()=>true;
  ctx.checkCloudBackend=async()=>{};ctx.setCloudUI=()=>{};
  ctx.document={getElementById:()=>null};
  const remote=JSON.parse(run('JSON.stringify(upcomingAuctions[0])'));remote.notes='Cloud research preserved';
  let uploaded;
  ctx.cloudRequest=async(p,o)=>{
    if(!o)return {upcoming:[remote,{id:'cloud-only'}]};
    uploaded=JSON.parse(o.body).upcoming;return {ok:true};
  };
  run(cloud.slice(cloud.indexOf('let upcomingSyncFlight='),cloud.indexOf('async function syncNow')));
  await run('restoreUpcomingSync()');
  assert.equal(uploaded.length,4);assert.deepEqual(uploaded.find(x=>x.id===remote.id),remote);
});
test('expired sessions refresh once and retry the authenticated request',async()=>{
  const {ctx,run}=context();let refreshes=0,requests=0;
  ctx.cloudReady=()=>true;ctx.cloudHeaders=()=>({});ctx.disconnectCloud=()=>assert.fail('unexpected sign out');
  ctx.fetch=async()=>++requests===1?{status:401}:{status:200,ok:true,json:async()=>({upcoming:[]})};
  ctx.backendAuth=async()=>{refreshes++;return {access_token:'synthetic-new',refresh_token:'synthetic-refresh'};};
  run("const CLOUD_SESSION_KEY='test-session';let cloudSession={access_token:'synthetic-expired',refresh_token:'synthetic-refresh'};");
  run(cloud.slice(cloud.indexOf('let cloudRefreshFlight='),cloud.indexOf('async function syncToCloud')));
  await run("cloudRequest('/api/cloud/upcoming')");
  assert.equal(refreshes,1);assert.equal(requests,2);
});
test('backend merges by user and stable ID in one request, rejects malformed data',async()=>{
  const source=fs.readFileSync(path.join(root,'server.js'),'utf8');
  const requests=[];
  const ctx=vm.createContext({cfg:{supabaseUrl:()=> 'https://database.invalid'},serviceHeaders:x=>x,fetchJson:async(u,o)=>requests.push({u,o})});
  vm.runInContext(source.slice(source.indexOf('async function dbMergeUpcoming'),source.indexOf('function cleanState')),ctx);
  const count=await vm.runInContext("dbMergeUpcoming('test-user',[{id:'one',owner:'A'},{id:'one',owner:'B'},{id:'two',owner:'C'}])",ctx);
  assert.equal(count,2);assert.equal(requests.length,1);assert.equal(requests[0].o.method,'POST');
  assert.match(requests[0].u,/on_conflict=user_id,record_id/);
  const rows=JSON.parse(requests[0].o.body);
  assert.deepEqual(rows.map(r=>[r.user_id,r.record_id,r.payload.owner]),[['test-user','one','B'],['test-user','two','C']]);
  await vm.runInContext("dbMergeUpcoming('test-user',[])",ctx);assert.equal(requests.length,1);
  await assert.rejects(vm.runInContext("dbMergeUpcoming('test-user',[{owner:'no id'}])",ctx),/stable record IDs/);
  await assert.rejects(vm.runInContext("dbMergeUpcoming('test-user',null)",ctx),/stable record IDs/);
});
