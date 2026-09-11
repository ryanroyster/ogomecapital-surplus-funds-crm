'use strict';
const domain=require('./public/operations-domain');
const {randomUUID}=require('crypto');
module.exports=function({cfg,fetchJson,serviceHeaders,requireUser,readBody,json,dbGet}){
 const queues=new Map();
 const url=(table,user,query='')=>cfg.supabaseUrl()+`/rest/v1/crm_${table}?user_id=eq.${encodeURIComponent(user)}`+query;
 const get=(table,user,query='')=>fetchJson(url(table,user,query),{headers:serviceHeaders()});
 const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
 async function locked(user,fn){const previous=queues.get(user)||Promise.resolve();const next=previous.catch(()=>{}).then(fn);queues.set(user,next);try{return await next;}finally{if(queues.get(user)===next)queues.delete(user);}}
 async function audit(user,entity,id,action,metadata){
  try{await fetchJson(cfg.supabaseUrl()+'/rest/v1/crm_audit_events',{method:'POST',headers:serviceHeaders({'Prefer':'return=minimal'}),body:JSON.stringify({user_id:user,entity_type:entity,entity_id:String(id),action,metadata})});return null;}
  catch{ return 'Saved, but cloud audit logging failed. Please retain your local history and contact the workspace administrator.'; }
 }
 async function owned(table,user,id,key='id'){
  const rows=await get(table,user,`&${key}=eq.${encodeURIComponent(id)}&limit=1`);if(!rows.length)fail('Related record is not available in this workspace.',404);return rows[0];
 }
 async function leads(user,items){
  if(!Array.isArray(items)||items.some(x=>!x||typeof x!=='object'||Array.isArray(x)||!['string','number'].includes(typeof x.id)||!String(x.id).trim()))fail('Leads must be an array with stable IDs.');
  if(new Set(items.map(x=>String(x.id))).size!==items.length)fail('Duplicate lead IDs.');
  const existing=await dbGet('crm_leads',user),map=new Map(existing.map(l=>[String(l.id),l]));
  const identity=l=>l.apn&&l.county&&l.state?JSON.stringify([l.state,l.county,l.apn,l.name,l.excess,l.source,l.caseNumber,l.case_number,l.saleDate,l.sale_date].map(x=>String(x??'').trim().toLowerCase())):null;
  const identities=new Map(existing.map(l=>[identity(l),String(l.id)]).filter(([k])=>k));
  for(const item of items){const key=identity(item);if(key&&identities.has(key)&&identities.get(key)!==String(item.id))fail('A matching claim already exists. Refresh the CRM to download cloud leads; the device backup preserves unsynced edits.',409);if(key)identities.set(key,String(item.id));}
  const changed=[];
  for(const item of items){const previous=map.get(String(item.id)),next=domain.compliance({...previous,...item});try{domain.validate(next,previous);}catch(e){fail(e.message,422);}if(JSON.stringify(previous)!==JSON.stringify(next))changed.push({previous,next});}
  if(changed.length)await fetchJson(cfg.supabaseUrl()+'/rest/v1/crm_leads?on_conflict=user_id,record_id',{method:'POST',headers:serviceHeaders({'Prefer':'resolution=merge-duplicates,return=minimal'}),body:JSON.stringify(changed.map(({next})=>({user_id:user,record_id:String(next.id),payload:next,updated_at:new Date().toISOString()})))});
  let warning=null;
  for(const c of changed)warning=await audit(user,'leads',c.next.id,c.previous?'updated':'created',{changed_fields:Object.keys(c.next).filter(k=>JSON.stringify(c.previous?.[k])!==JSON.stringify(c.next[k])),previous_stage:c.previous?.stage,stage:c.next.stage,previous_compliance_status:c.previous?.compliance_status||'NOT_REVIEWED',compliance_status:c.next.compliance_status})||warning;
  return {ok:true,count:items.length,warning};
 }
 async function handle(req,res,u){
  const match=u.pathname.match(/^\/api\/cloud\/(tasks|attorneys|claims|payments|audit-events|assignees|leads)(?:\/([^/]+))?$/);if(!match)return false;
  const user=await requireUser(req),kind=match[1],id=match[2]?decodeURIComponent(match[2]):null;
  if(kind==='leads'){
   if(req.method==='GET'&&!id){json(res,200,{leads:(await dbGet('crm_leads',user.id)).map(domain.compliance)});return true;}
   if(req.method==='PUT'&&!id){const b=await readBody(req);json(res,200,await locked(user.id,()=>leads(user.id,b.leads)));return true;}
   if(req.method==='DELETE'&&id){await locked(user.id,async()=>{await owned('leads',user.id,id,'record_id');await fetchJson(url('leads',user.id,`&record_id=eq.${encodeURIComponent(id)}`),{method:'DELETE',headers:serviceHeaders()});json(res,200,{ok:true,warning:await audit(user.id,'leads',id,'deleted',{})});});return true;}
  }else if(kind==='assignees'&&req.method==='GET'){
   // Records currently belong to individual workspaces; do not imply organization-wide sharing.
   json(res,200,{items:[{id:user.id,name:user.email||'Me'}]});return true;
  }else if(kind==='audit-events'&&req.method==='GET'){
   const lead=u.searchParams.get('lead_record_id');
   const query=lead?`&or=(and(entity_type.eq.leads,entity_id.eq.${encodeURIComponent('"'+lead.replace(/["\\]/g,'')+'"')}),metadata->>lead_record_id.eq.${encodeURIComponent('"'+lead.replace(/["\\]/g,'')+'"')})`:'';
   json(res,200,{items:await get('audit_events',user.id,query+'&order=created_at.desc&limit=200')});return true;
  }else if(domain.schemas[kind]){
   if(req.method==='GET'){
    const lead=u.searchParams.get('lead_record_id');let query=id?`&id=eq.${encodeURIComponent(id)}`:'';
    if(lead&&kind!=='attorneys')query+=`&lead_record_id=eq.${encodeURIComponent(lead)}`;
    // Paginate so executive totals never silently stop at the default REST row limit.
    let items=[],page;do{page=await get(kind,user.id,query+`&order=created_at.asc,id.asc&limit=500&offset=${items.length}`);items.push(...page);}while(page.length===500);
    json(res,200,{items});return true;
   }
   if((req.method==='POST'&&!id)||(req.method==='PATCH'&&id)){
    const body=await readBody(req);if(!body||typeof body!=='object'||Array.isArray(body))fail('Invalid record.');
    const result=await locked(user.id,async()=>{
     const schema=domain.schemas[kind],previous=id?await owned(kind,user.id,id):null;
     const data={...(!id?schema.defaults:{})};
     for(const key of [...Object.keys(schema.fields),'lead_record_id'])if(Object.hasOwn(body,key)&&!(kind==='attorneys'&&key==='lead_record_id'))data[key]=body[key];
     for(const key of schema.required)if((data[key]??previous?.[key])==null||(data[key]??previous?.[key])==='')fail(`${key} is required.`);
     for(const [key,type] of Object.entries(schema.fields))if(data[key]!=null){
      const value=data[key];
      if(Array.isArray(type)&&!type.includes(value))fail(`Invalid ${key}.`);
      if(type==='number'&&(typeof value!=='number'||!Number.isFinite(value)||value<0))fail(`Invalid ${key}.`);
      if(['date','datetime-local'].includes(type)&&(typeof value!=='string'||!Number.isFinite(Date.parse(value))))fail(`Invalid ${key}.`);
      if(type==='states'&&(!Array.isArray(value)||value.some(x=>typeof x!=='string')))fail('Invalid states.');
      if(['text','textarea','email','attorney','claim','assignee'].includes(type)&&typeof value!=='string')fail(`Invalid ${key}.`);
     }
     const effective={...previous,...data};
     if(effective.lead_record_id)await owned('leads',user.id,effective.lead_record_id,'record_id');
     if(effective.attorney_id)await owned('attorneys',user.id,effective.attorney_id);
     if(effective.claim_id){const claim=await owned('claims',user.id,effective.claim_id);if(claim.lead_record_id!==effective.lead_record_id)fail('Claim must belong to this lead.');}
     if(effective.assigned_user_id&&effective.assigned_user_id!==user.id)fail('Assignee must belong to this individual workspace.');
     const recordId=id||body.id||randomUUID();if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(recordId))fail('Invalid record ID.');
     // Client IDs allow safe retries after a connection loss; never upsert an unscoped ID.
     if(!id){const found=await get(kind,user.id,`&id=eq.${encodeURIComponent(recordId)}`);if(found.length)return {item:found[0],ok:true};}
     const rows=await fetchJson(id?url(kind,user.id,`&id=eq.${encodeURIComponent(id)}`):cfg.supabaseUrl()+`/rest/v1/crm_${kind}`,{method:id?'PATCH':'POST',headers:serviceHeaders({'Prefer':'return=representation'}),body:JSON.stringify({...data,...(!id?{id:recordId,user_id:user.id}:{}),updated_at:new Date().toISOString()})});
     return {ok:true,item:rows[0],warning:await audit(user.id,kind,recordId,id?'updated':'created',{lead_record_id:effective.lead_record_id,changed_fields:Object.keys(data),before:previous?Object.fromEntries(Object.keys(data).map(k=>[k,previous[k]])):null,after:data})};
    });json(res,200,result);return true;
   }
  }
  json(res,405,{error:'Method not allowed.'});return true;
 }
 return {handle};
};
