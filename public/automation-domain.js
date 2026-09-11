(function(root){
'use strict';
const fail=m=>{throw Object.assign(new Error(m),{status:422});};
const stages=['New Lead','County Verified','Recorder Research','Claimant Verified','Qualified','Call Ready','Contacted','Interested','Signed Contract','Attorney Review','Claim Filed','Approved','Paid','Closed / Lost'];
const eventTypes=['appointment','callback','follow_up','claim_deadline','attorney_meeting','task_due'];
const fields=['phone','email','nextAction','contactStatus','qualification_status'];
function text(v,name,max=4000){if(typeof v!=='string'||!v.trim()||v.length>max)fail(`${name} is required (maximum ${max} characters).`);return v.trim();}
function cleared(l){if(l?.compliance_status!=='CLEARED')fail('Compliance Clearance must be CLEARED before automation.');}
function phone(v){if(!/^\+[1-9]\d{7,14}$/.test(String(v)))fail('Use an international phone number, for example +14155550100.');return v;}
function consent(c){if(c?.status!=='granted'||!c.jurisdiction||!c.basis||!c.recorded_at)fail('Record consent, participant jurisdictions and consent basis before storing or transcribing audio.');if(!Number.isFinite(Date.parse(c.recorded_at)))fail('Invalid consent date.');}
function smsEligible(l,c,p){return !!(l&&l.compliance_status==='CLEARED'&&(l.qualification_status==='Qualified'||l.stage==='Qualified')&&l.dnc!==true&&c?.status==='opted_in'&&c.dnc!==true&&c.phone===p);}
function event(v){
 text(v.title,'Title',200);if(!eventTypes.includes(v.kind))fail('Invalid event type.');
 if(!Number.isFinite(Date.parse(v.start_at))||!Number.isFinite(Date.parse(v.end_at))||Date.parse(v.end_at)<=Date.parse(v.start_at))fail('Event end must be after its start.');
 try{new Intl.DateTimeFormat('en-US',{timeZone:v.timezone}).format();}catch{fail('Choose a valid timezone.');}
 if(!['scheduled','completed','cancelled'].includes(v.status))fail('Invalid event status.');return v;
}
function summary(v){
 text(v.summary,'Call summary',12000);
 for(const k of ['key_notes','objections','commitments','next_steps'])if(!Array.isArray(v[k])||v[k].some(x=>typeof x!=='string'||x.length>2000)||v[k].length>30)fail(`Invalid ${k}.`);
 for(const k of ['sentiment','intent'])text(v[k],k,300);
 if(typeof v.confidence!=='number'||v.confidence<0||v.confidence>1)fail('Confidence must be between 0 and 1.');
 if(v.proposed_stage&&!stages.includes(v.proposed_stage))fail('Invalid proposed pipeline stage.');return v;
}
function evidence(v){if(!['executed_agreement','esign_confirmation','counsel_approved_verbal'].includes(v.kind))fail('Choose an explicit contract evidence type.');text(v.reference,'Evidence reference',2000);if(v.kind==='counsel_approved_verbal')text(v.counsel_reference,'Counsel approval reference',2000);return v;}
function autoOutcome(s,source,threshold=.9){return source==='provider'&&s.confidence>=threshold&&(!s.proposed_stage||['Contacted','Interested'].includes(s.proposed_stage));}
function proposed(v){
 if(!['add_note','update_field','move_stage','create_task','schedule_event','assign_attorney','cancel_event'].includes(v.type))fail('Unsupported assistant action.');
 if(v.type==='add_note')text(v.note,'Note');
 if(v.type==='update_field'){if(!fields.includes(v.field))fail('This field requires the lead editor / compliance review.');text(v.value,'Value',2000);if(v.field==='qualification_status'&&!['Qualified','Not Qualified','Researching'].includes(v.value))fail('Invalid qualification status.');}
 if(v.type==='move_stage'&&!stages.includes(v.stage))fail('Invalid stage.');
 if(v.type==='create_task'){text(v.title,'Task title',200);if(v.due_at&&!Number.isFinite(Date.parse(v.due_at)))fail('Invalid due date.');}
 if(v.type==='schedule_event')event(v.event);
 if(v.type==='assign_attorney')text(v.attorney_id,'Attorney');
 if(v.type==='cancel_event')text(v.event_id,'Event');return v;
}
function highImpact(a){return ['move_stage','assign_attorney','cancel_event'].includes(a.type)||a.type==='update_field';}
function localDay(iso,tz){return new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(iso));}
function inSendWindow(now,tz){const parts=new Intl.DateTimeFormat('en-US',{timeZone:tz,weekday:'short',hour:'numeric',hourCycle:'h23'}).formatToParts(new Date(now));const get=t=>parts.find(x=>x.type===t)?.value;return !['Sat','Sun'].includes(get('weekday'))&&+get('hour')>=9&&+get('hour')<17;}
function renderTemplate(template,lead,slots,tz){return template.replaceAll('{{name}}',String(lead.name||'there')).replaceAll('{{slots}}',slots.map((x,i)=>`${i+1}: ${new Date(x.start_at).toLocaleString('en-US',{timeZone:tz})} ${tz}`).join('; '));}
const api={stages,eventTypes,fields,text,phone,consent,cleared,smsEligible,event,summary,evidence,autoOutcome,proposed,highImpact,localDay,inSendWindow,renderTemplate};
if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.CRMAutomation=api;
})(globalThis);
