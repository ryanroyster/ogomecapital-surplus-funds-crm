'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const {randomUUID,createHmac}=require('crypto');const D=require('../public/automation-domain');const P=require('../automation-providers');const make=require('../automation-api');
const uid='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
function harness(){
 const lead={id:'lead-1',name:'Synthetic owner',stage:'Qualified',qualification_status:'Qualified',compliance_status:'CLEARED',notes:'Original note'};
 const db={leads:[{user_id:uid,record_id:lead.id,payload:lead}],audit:[]};for(const t of ['calendars','calendar_events','call_sessions','call_transcripts','ai_summaries','action_proposals','assistant_actions','messaging_campaigns','messages','messaging_consents','contract_evidence','tasks','attorneys','claims'])db[t]=[];
 let tick=0;
 const headers=()=>({});
 async function fetchJson(raw,o={}){const u=new URL(raw);
  if(u.pathname.endsWith('/rpc/crm_automation_commit')){
   const b=JSON.parse(o.body),l=db.leads.find(x=>x.user_id===b.p_user&&x.record_id===b.p_lead)?.payload;
   if(b.p_lead){assert.deepEqual(l,b.p_expected);if(b.p_clearance)D.cleared(l);}
   if(b.p_sms_phone&&!D.smsEligible(l,db.messaging_consents.find(x=>x.user_id===b.p_user&&x.payload.phone===b.p_sms_phone)?.payload,b.p_sms_phone))throw new Error('Consent required');
   // Validate every record before changing anything, matching the transactional RPC.
   for(const w of b.p_writes){const old=db[w.table].find(x=>x.id===w.row.id);if(old){assert.equal(old.user_id,b.p_user);assert.equal(old.updated_at,w.expected_at);}else if(w.expected_at)throw new Error('Stale row');}
   const out=[];for(const w of b.p_writes){const old=db[w.table].find(x=>x.id===w.row.id),r={created_at:old?.created_at||new Date().toISOString(),...old,...w.row,user_id:b.p_user,updated_at:new Date(Date.now()+ ++tick).toISOString()};if(old)Object.assign(old,r);else db[w.table].push(r);out.push(structuredClone(r));db.audit.push({table:w.table,id:r.id});}
   if(b.p_patch||b.p_note){Object.assign(l,b.p_patch||{});if(b.p_note)l.notes=[l.notes,b.p_note].filter(Boolean).join('\n\n');l._automation_revision=(l._automation_revision||0)+1;}return {items:out,lead:l};
  }
  const t=u.pathname.split('/crm_')[1];if(!db[t])throw new Error('Unknown table '+t);
  const items=db[t].filter(r=>['id','user_id','record_id','lead_record_id'].every(k=>!u.searchParams.has(k)||String(r[k])===u.searchParams.get(k).slice(3)));
  return structuredClone(items.slice(Number(u.searchParams.get('offset')||0),Number(u.searchParams.get('offset')||0)+Number(u.searchParams.get('limit')||500)));
 }
 const api=make({cfg:{supabaseUrl:()=> 'https://db.invalid'},fetchJson,serviceHeaders:headers,requireUser:async req=>{if(req.noAuth)throw Object.assign(new Error('Authentication required'),{status:401});return {id:req.user||uid};},readBody:async r=>r.body,json:(res,status,body)=>Object.assign(res,{status,body}),dbGet:async(t,user)=>db.leads.filter(x=>x.user_id===user).map(x=>structuredClone(x.payload))});
 async function request(method,path,body={},user=uid,noAuth=false){const res={};try{await api.handle({method,body,user,noAuth},res,new URL('https://app.invalid/api/automation/'+path));}catch(e){res.status=e.status||422;res.body={error:e.message};}return res;}
 return {db,lead,request,api};
}
const manualSummary={summary:'Owner will review documents. No contract executed.',key_notes:['Requested documents'],objections:[],commitments:['Review documents'],next_steps:['Send documents after clearance'],sentiment:'Neutral',intent:'Review',confidence:.95,proposed_stage:'Interested'};
test('evidence and confidence never infer an executed agreement',()=>{
 assert.equal(D.autoOutcome({...manualSummary,proposed_stage:'Signed Contract'},'provider'),false);
 assert.equal(D.autoOutcome(manualSummary,'manual'),false);assert.equal(D.autoOutcome({...manualSummary,confidence:.6},'provider'),false);assert.equal(D.autoOutcome(manualSummary,'provider'),true);
 assert.throws(()=>D.evidence({kind:'counsel_approved_verbal',reference:'phone agreement'}));
 assert.throws(()=>D.consent({status:'not_recorded'}));assert.throws(()=>D.event({title:'Bad time',kind:'appointment',status:'scheduled',start_at:'2026-01-02',end_at:'2026-01-01',timezone:'UTC'}));
});
test('automation routes require authentication and enforce record ownership',async()=>{
 const h=harness();assert.equal((await h.request('GET','overview',{},uid,true)).status,401);
 const r=await h.request('POST','calls',{lead_record_id:'lead-1',title:'Synthetic call'});assert.equal(r.status,200);
 assert.equal((await h.request('POST','calls/'+r.body.items[0].id+'/transcript',{text:'private',source:'manual'},other)).status,404);
});
test('manual call notes append once, then require review before stage movement',async()=>{
 const h=harness();let r=await h.request('POST','calls',{lead_record_id:'lead-1',title:'Synthetic call'});const id=r.body.items[0].id;
 assert.equal((await h.request('POST','calls/'+id+'/transcript',{text:'Owner asks to review documents',source:'manual'})).status,200);
 assert.equal((await h.request('POST','calls/'+id+'/summarize',{summary:manualSummary})).status,200);
 assert.match(h.lead.notes,/Original note/);assert.match(h.lead.notes,/Owner will review/);assert.equal(h.lead.stage,'Qualified');
 assert.equal((await h.request('POST','calls/'+id+'/summarize',{summary:manualSummary})).status,422);
 const p=h.db.action_proposals[0];assert.equal((await h.request('POST','proposals/'+p.id+'/execute',{})).status,422);
 assert.equal((await h.request('POST','proposals/'+p.id+'/execute',{confirm:true})).status,200);assert.equal(h.lead.stage,'Interested');
 assert.equal(h.db.call_sessions[0].payload.status,'reviewed');const count=h.db.audit.length;
 assert.equal((await h.request('POST','proposals/'+p.id+'/execute',{confirm:true})).body.already_executed,true);assert.equal(h.db.audit.length,count);
});
test('uncleared leads cannot mutate through assistant or summarize calls',async()=>{
 const h=harness();h.lead.compliance_status='HOLD';assert.equal((await h.request('POST','assistant/propose',{lead_record_id:'lead-1',action:{type:'add_note',note:'hello'}})).status,422);assert.equal(h.db.action_proposals.length,0);
});
test('assistant proposals reject stale snapshots and require evidence for signed status',async()=>{
 const h=harness();let r=await h.request('POST','assistant/propose',{lead_record_id:'lead-1',action:{type:'move_stage',stage:'Signed Contract'}});const id=r.body.items[0].id;
 assert.equal((await h.request('POST','proposals/'+id+'/execute',{confirm:true})).status,422);
 h.db.contract_evidence.push({id:randomUUID(),user_id:uid,lead_record_id:'lead-1',payload:{kind:'executed_agreement',reference:'synthetic-document',verified_by:uid}});
 assert.equal((await h.request('POST','proposals/'+id+'/execute',{confirm:true})).status,200);
 r=await h.request('POST','assistant/propose',{lead_record_id:'lead-1',action:{type:'add_note',note:'New note'}});h.lead.notes='Changed elsewhere';assert.equal((await h.request('POST','proposals/'+r.body.items[0].id+'/execute',{})).status,409);
});
test('provider-free campaigns remain drafts and STOP cancels all pending messages idempotently',async()=>{
 const h=harness(),phone='+15555550100';await h.request('POST','consents',{lead_record_id:'lead-1',phone,status:'opted_in',basis:'Synthetic documented opt-in',recorded_at:new Date().toISOString()});
 const b={lead_record_id:'lead-1',phone,timezone:'America/Los_Angeles',slots:[{start_at:'2099-01-01T16:00:00Z',end_at:'2099-01-01T16:30:00Z'}],cadence_hours:[0,48,120],template:'Ogome Capital: {{name}}, reply 1 for {{slots}}. Reply STOP to opt out.'};
 let r=await h.request('POST','campaigns',b);assert.equal(r.status,200);assert.equal(h.db.messaging_campaigns[0].payload.status,'provider_pending');assert.equal(h.db.messages.filter(x=>x.payload.status==='sent').length,0);
 assert.equal((await h.request('POST','campaigns',b)).status,422);
 const event={workspace_id:uid,event_id:'synthetic-stop',type:'sms_inbound',from:phone,body:'Please stop texting me'};await h.api.internals.webhook(event);assert.equal(h.lead.dnc,true);assert.equal(h.db.messaging_consents[0].payload.status,'opted_out');assert.equal(h.db.messages.filter(x=>x.payload.status==='cancelled').length,3);assert.equal((await h.api.internals.webhook(event)).duplicate,true);
 assert.equal((await h.request('POST','campaigns',b)).status,422);
});
test('webhook HMAC rejects forgery and expired signatures',()=>{
 process.env.CRM_WEBHOOK_SECRET='synthetic-test-only';const raw='{"event_id":"test"}',time=String(Math.floor(Date.now()/1000));const sig=createHmac('sha256',process.env.CRM_WEBHOOK_SECRET).update(time+'.'+raw).digest('hex');
 assert.equal(P.verify(raw,{'x-crm-timestamp':time,'x-crm-signature':sig}),true);assert.equal(P.verify(raw+' ',{'x-crm-timestamp':time,'x-crm-signature':sig}),false);assert.equal(P.verify(raw,{'x-crm-timestamp':time,'x-crm-signature':sig},Date.now()+600000),false);delete process.env.CRM_WEBHOOK_SECRET;
});
test('send windows use recipient timezone, exclude weekends and quiet hours',()=>{
 assert.equal(D.inSendWindow('2026-09-14T16:00:00Z','America/Los_Angeles'),true);assert.equal(D.inSendWindow('2026-09-13T16:00:00Z','America/Los_Angeles'),false);assert.equal(D.inSendWindow('2026-09-14T08:00:00Z','America/Los_Angeles'),false);
});
test('SMS numbered reply creates one appointment, cancels invitations and queues reminders without faking delivery',async()=>{
 const h=harness(),phone='+15555550100';await h.request('POST','consents',{lead_record_id:'lead-1',phone,status:'opted_in',basis:'Synthetic consent',recorded_at:new Date().toISOString()});
 await h.request('POST','campaigns',{lead_record_id:'lead-1',phone,timezone:'UTC',slots:[{start_at:'2099-01-01T16:00:00Z',end_at:'2099-01-01T16:30:00Z'}],cadence_hours:[0,48],template:'Ogome Capital {{slots}}. STOP to opt out.'});
 h.db.messaging_campaigns[0].payload.status='active';for(const m of h.db.messages)m.payload.status='queued';
 const event={workspace_id:uid,event_id:'booking-test',type:'sms_inbound',from:phone,body:'1'};await h.api.internals.webhook(event);
 assert.equal(h.db.calendar_events.length,1);assert.equal(h.db.calendar_events[0].payload.booking_source,'sms');assert.equal(h.db.messaging_campaigns[0].payload.status,'booked');assert.match(h.lead.nextAction,/Appointment booked/);
 assert.equal(h.db.messages.filter(x=>x.payload.status==='sent').length,0);assert.equal(h.db.messages.filter(x=>x.payload.kind==='reminder').length,2);
 await h.api.internals.webhook(event);assert.equal(h.db.calendar_events.length,1);
});
test('signed call webhook stores consented transcripts once and does not pretend to summarize without an LLM',async()=>{
 const h=harness(),b={workspace_id:uid,event_id:'synthetic-call',type:'call_completed',lead_record_id:'lead-1',transcript:'Synthetic call transcript.',consent:{status:'granted',jurisdiction:'Synthetic jurisdiction',basis:'Recorded affirmative consent',recorded_at:new Date().toISOString()},jurisdiction_warning_acknowledged:true};
 await h.api.internals.webhook(b);assert.equal(h.db.call_sessions.length,1);assert.equal(h.db.call_transcripts.length,1);assert.equal(h.db.call_sessions[0].payload.status,'awaiting_summary');assert.equal(h.db.ai_summaries.length,0);
 assert.equal((await h.api.internals.webhook(b)).duplicate,true);
});
test('sign-in replaces random device seeds with canonical cloud records and keeps a recovery copy',async()=>{
 const fs=require('fs'),vm=require('vm'),source=fs.readFileSync(require('path').join(__dirname,'../crm_parts/part05.html'),'utf8');
 const code=source.slice(source.indexOf('async function syncFromCloud('),source.indexOf('let upcomingSyncFlight='));
 const local=[{id:'random-device-id',apn:'parcel',notes:'Device note'}],remote=[{id:'canonical-id',apn:'parcel',notes:'Cloud note'}],storage=new Map([['pending','true']]);
 const ctx={leads:local,cloudReady:()=>true,cloudSession:{user:{id:uid}},leadPendingKey:()=> 'pending',localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},syncToCloud:async()=>{throw new Error('Sign-in must not upload random seed IDs');},setCloudUI:()=>{},cloudRequest:async p=>p.endsWith('/leads')?{leads:remote}:{upcoming:[]},window:{},document:{getElementById:()=>null},renderAll:()=>{}};
 vm.createContext(ctx);vm.runInContext(code,ctx);await ctx.syncFromCloud(false);
 assert.deepEqual(ctx.leads,remote);assert.equal(storage.has('pending'),false);assert.deepEqual(JSON.parse(storage.get('surplusCRM_before_cloud_'+uid)),local);
});
test('calendar collections enforce ownership and imports are deduplicated',async()=>{const h=harness();let r=await h.request('POST','calendars',{name:'Team',color:'#5688eb'});assert.equal(r.status,200);const id=r.body.items[0].id;const e={title:'Synthetic event',calendar_id:id,kind:'follow_up',start_at:'2026-10-01T09:00:00Z',end_at:'2026-10-01T10:00:00Z',timezone:'UTC',import_uid:'fixture-1'};assert.equal((await h.request('POST','calendar',e,other)).status,404);r=await h.request('POST','calendar-batch',{events:[e,e]});assert.equal(r.status,200);assert.equal(r.body.imported,1);r=await h.request('POST','calendar-batch',{events:[e]});assert.equal(r.body.imported,0);assert.equal(h.db.calendar_events.length,1);assert.equal(h.lead.notes,'Original note');});
test('simplified board supports an explicit Docs Sent transition with audit and clearance checks',async()=>{const h=harness();const p=await h.request('POST','assistant/propose',{lead_record_id:'lead-1',action:{type:'move_stage',stage:'Docs Sent'}});assert.equal(p.status,200);const id=p.body.items.find(x=>x.payload.status==='pending').id;assert.equal((await h.request('POST','proposals/'+id+'/execute',{confirm:true})).status,200);assert.equal(h.lead.stage,'Docs Sent');assert.ok(h.db.audit.length>0);h.lead.compliance_status='HOLD';assert.equal((await h.request('POST','assistant/propose',{lead_record_id:'lead-1',action:{type:'move_stage',stage:'Paid'}})).status,422);});
