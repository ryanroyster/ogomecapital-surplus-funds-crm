const {test}=require('node:test');
const assert=require('node:assert/strict');
const D=require('../public/operations-domain');
const makeAPI=require('../operations-api');
const uid='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
function harness(initial={}){
 const db={leads:[],tasks:[],attorneys:[],claims:[],payments:[],audit_events:[],...structuredClone(initial)},requests=[];
 async function fetchJson(raw,options={}){
  const u=new URL(raw),kind=u.pathname.split('crm_')[1],method=options.method||'GET';requests.push({raw,method});
  const matches=r=>['user_id','id','record_id','lead_record_id'].every(k=>!u.searchParams.has(k)||String(r[k])===u.searchParams.get(k).slice(3));
  if(method==='GET'){let rows=db[kind].filter(matches);const offset=Number(u.searchParams.get('offset')||0),limit=Number(u.searchParams.get('limit')||1000);return structuredClone(rows.slice(offset,offset+limit));}
  const body=options.body?JSON.parse(options.body):{};
  if(method==='DELETE'){db[kind]=db[kind].filter(r=>!matches(r));return [];}
  if(method==='PATCH'){const rows=db[kind].filter(matches);rows.forEach(r=>Object.assign(r,body));return structuredClone(rows);}
  const rows=Array.isArray(body)?body:[body];for(const row of rows){const old=kind==='leads'?db[kind].find(r=>r.user_id===row.user_id&&r.record_id===row.record_id):null;if(old)Object.assign(old,row);else db[kind].push(row);}return structuredClone(rows);
 }
 const api=makeAPI({cfg:{supabaseUrl:()=> 'https://db.invalid'},fetchJson,serviceHeaders:()=>({}),requireUser:async r=>{if(r.noAuth)throw Object.assign(new Error('Unauthorized'),{status:401});return {id:uid,email:'synthetic@example.invalid'};},readBody:async r=>r.body,json:(res,status,body)=>Object.assign(res,{status,body}),dbGet:async(t,user)=>db.leads.filter(r=>r.user_id===user).map(r=>structuredClone(r.payload))});
 async function request(method,path,body,noAuth=false){const res={};try{await api.handle({method,body,noAuth},res,new URL('https://app.invalid'+path));}catch(e){res.status=e.status||500;res.body={error:e.message};}return res;}
 return {db,requests,request};
}
test('Nevada overrides only its own workspace and leaves original scores/order untouched',()=>{
 const rows=[{id:'original',state:'California',name:'Original priority',excess:1e6,closingProbability:90},{id:'tim',state:'Nevada',name:'Timothy B. Murri',excess:2e5,closingProbability:70},{id:'leo',state:'Nevada',name:'Carl F. Leonard / Eva J. Leonard',excess:3e5,closingProbability:40},{id:'olga',state:'Nevada',name:'Olga Ohm',excess:1e5,closingProbability:80}];const before=structuredClone(rows);const global=a=>a.slice().sort((a,b)=>b.excess*b.closingProbability-a.excess*a.closingProbability).map(x=>x.id);
 assert.deepEqual(D.stateQueue(rows.filter(x=>x.state==='Nevada'),'Nevada').map(x=>x.id),['olga','tim','leo']);assert.deepEqual(rows,before);assert.deepEqual(global(rows),global(before));assert.deepEqual(D.stateQueue(rows,'California').map(x=>x.id),global(rows));
});
test('no seed clears compliance; historical Call Ready remains saved but is not operationally ready',()=>{
 for(const state of ['Nevada','Texas','Florida','California'])assert.equal(D.compliance({state}).compliance_status,'NOT_REVIEWED');
 const historical=D.compliance({stage:'Call Ready'});assert.doesNotThrow(()=>D.validate(historical,historical));assert.equal(D.ready(historical),false);assert.match(D.label(historical),/historical/);assert.throws(()=>D.validate(historical,{stage:'County Verified'}),/CLEARED/);assert.equal(D.ready({...historical,compliance_status:'CLEARED'}),true);
});
test('lead merge preserves omitted records and unknown fields, rejects invalid transition atomically',async()=>{
 const h=harness({leads:[{user_id:uid,record_id:'a',payload:{id:'a',stage:'County Verified',phone:'synthetic',commLog:[{type:'note'}],closingProbability:84}},{user_id:uid,record_id:'b',payload:{id:'b',stage:'Call Ready'}}]});
 let r=await h.request('PUT','/api/cloud/leads',{leads:[{id:'a',compliance_notes:'Review pending'}]});assert.equal(r.status,200);assert.equal(h.db.leads.length,2);assert.equal(h.db.leads[0].payload.phone,'synthetic');assert.equal(h.db.leads[0].payload.closingProbability,84);assert.equal(h.db.leads[0].payload.compliance_status,'NOT_REVIEWED');assert.ok(h.db.audit_events.length);
 const before=structuredClone(h.db.leads);r=await h.request('PUT','/api/cloud/leads',{leads:[{id:'a',stage:'Call Ready'}]});assert.equal(r.status,422);assert.deepEqual(h.db.leads,before);assert.equal((await h.request('PUT','/api/cloud/leads',{})).status,400);assert.ok(!h.requests.some(r=>r.method==='DELETE'));
 r=await h.request('PUT','/api/cloud/leads',{leads:[{id:'b',notes:'Historical record retained'}]});assert.equal(r.status,200);assert.equal(h.db.leads[1].payload.stage,'Call Ready');
});
test('operating routes scope ownership, validate relations and ignore forged owner fields',async()=>{
 const h=harness({leads:[{user_id:uid,record_id:'lead',payload:{id:'lead'}}],attorneys:[{id:other,user_id:other,name:'Other private attorney'}]});
 assert.equal((await h.request('GET','/api/cloud/tasks',null,true)).status,401);
 assert.equal((await h.request('GET','/api/cloud/attorneys')).body.items.length,0);
 assert.equal((await h.request('PATCH','/api/cloud/attorneys/'+other,{name:'changed'})).status,404);
 assert.equal((await h.request('POST','/api/cloud/claims',{lead_record_id:'lead',attorney_id:other})).status,404);
 let r=await h.request('POST','/api/cloud/tasks',{title:'Synthetic follow-up',lead_record_id:'lead',user_id:other,organization_id:other,assigned_user_id:uid});assert.equal(r.status,200);assert.equal(r.body.item.user_id,uid);assert.equal(r.body.item.organization_id,undefined);
 assert.equal((await h.request('POST','/api/cloud/tasks',{title:'bad',assigned_user_id:other})).status,400);
 assert.equal((await h.request('POST','/api/cloud/claims',{lead_record_id:'lead',status:'invented'})).status,400);
 assert.equal((await h.request('POST','/api/cloud/payments',{lead_record_id:'lead',amount:-1})).status,400);
 assert.equal((await h.request('POST','/api/cloud/audit-events',{action:'forged'})).status,405);
});
test('tasks claims attorneys payments support create/update with an audit trail and idempotent create',async()=>{
 const h=harness({leads:[{user_id:uid,record_id:'lead',payload:{id:'lead'}}]});
 const attorney=(await h.request('POST','/api/cloud/attorneys',{name:'Synthetic counsel',states:['Nevada']})).body.item;
 const claim=(await h.request('POST','/api/cloud/claims',{lead_record_id:'lead',attorney_id:attorney.id,status:'filed',claimed_amount:100000,filing_date:'2026-09-10',deadline:'2027-01-01'})).body.item;
 const r=await h.request('PATCH','/api/cloud/claims/'+claim.id,{status:'approved',approved_amount:90000,fee_amount:9000});assert.equal(r.body.item.status,'approved');
 const payment={id:other,lead_record_id:'lead',claim_id:claim.id,amount:9000,payment_type:'company_fee',status:'received'};await h.request('POST','/api/cloud/payments',payment);await h.request('POST','/api/cloud/payments',payment);assert.equal(h.db.payments.length,1);assert.equal(h.db.audit_events.length,4);
});
test('executive KPIs avoid counting recovery funds as company revenue',()=>{
 const m=D.metrics([{excess:100000,closingProbability:80,stage:'County Verified'},{excess:999,closingProbability:100,stage:'Paid'}],{claims:[{status:'approved',approved_amount:100000,fee_amount:10000},{status:'denied',approved_amount:999999,fee_amount:99999}],payments:[{payment_type:'recovery',status:'received',amount:100000},{payment_type:'company_fee',status:'received',amount:10000},{payment_type:'company_fee',status:'expected',amount:20000}],tasks:[{status:'open',due_at:'2020-01-01'},{status:'done',due_at:'2020-01-01'}]});assert.deepEqual(m,{pipeline:80000,approved:100000,fees:10000,revenue:10000,outstanding:1,overdue:1});
});
test('lead upload queues concurrent edits and keeps failed changes pending',async()=>{
 const fs=require('node:fs'),vm=require('node:vm');const source=fs.readFileSync(require('node:path').join(__dirname,'../crm_parts/part05.html'),'utf8');const storage=new Map([['surplusCRM_leads_pending_u','true']]);let release;const wait=new Promise(r=>release=r),uploads=[];
 const ctx=vm.createContext({cloudReady:()=>true,cloudSession:{user:{id:'u'}},leads:[{id:'one',notes:'first'}],localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},setCloudUI:()=>{},cloudRequest:async(p,o)=>{uploads.push(JSON.parse(o.body));if(uploads.length===1)await wait;return {ok:true};}});
 vm.runInContext(source.slice(source.indexOf('let leadSyncFlight='),source.indexOf('async function syncFromCloud')),ctx);
 const a=vm.runInContext('syncToCloud()',ctx);ctx.leads=[{id:'one',notes:'newer'}];const b=vm.runInContext('syncToCloud()',ctx);release();await Promise.all([a,b]);assert.equal(uploads.length,2);assert.equal(uploads[1].leads[0].notes,'newer');assert.equal(storage.size,0);
 storage.set('surplusCRM_leads_pending_u','true');ctx.cloudRequest=async()=>{throw new Error('offline')};await assert.rejects(vm.runInContext('syncToCloud()',ctx),/offline/);assert.equal(storage.size,1);
});
