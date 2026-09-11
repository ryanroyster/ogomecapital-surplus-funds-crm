(function(root){
'use strict';
const statuses=['NOT_REVIEWED','RESEARCHING','COUNSEL_REVIEW','CLEARED','HOLD'];
const defaults={compliance_status:'NOT_REVIEWED',state_model:null,fee_cap:null,contract_version:null,attorney_required:null,attorney_assigned:null,claim_deadline:null,reviewed_by:null,review_date:null,compliance_notes:null};
function compliance(l){return {...defaults,...l,compliance_status:l.compliance_status||'NOT_REVIEWED'};}
function ready(l){return l.stage==='Call Ready'&&l.compliance_status==='CLEARED';}
function pipelineStage(l){return l.stage==='Call Ready'&&!ready(l)?'Clearance required (historical)':l.stage;}
function label(l){return l.stage==='Call Ready'&&!ready(l)?'Call Ready (historical; clearance required)':l.stage||'New Lead';}
function validate(l,previous){
 if(!statuses.includes(l.compliance_status))throw new Error('Invalid Compliance Status.');
 if(l.stage==='Call Ready'&&l.compliance_status!=='CLEARED'&&previous?.stage!=='Call Ready')throw new Error('Compliance Status must be CLEARED before marking a lead Call Ready.');
}
function stateRank(l,state){
 if(state!=='Nevada'||l.state!=='Nevada')return 99;
 const n=String(l.name||'').toLowerCase();
 return n==='olga ohm'?0:n==='timothy b. murri'?1:(n.includes('carl f.')&&n.includes('eva j.')&&n.includes('leonard'))?2:99;
}
function stateQueue(rows,state){return rows.slice().sort((a,b)=>stateRank(a,state)-stateRank(b,state)||(Number(b.excess||0)*Number(b.closingProbability||0))-(Number(a.excess||0)*Number(a.closingProbability||0)));}
const schemas={
 tasks:{title:'Follow-up',fields:{title:'text',status:['open','in_progress','blocked','done','cancelled'],priority:['low','normal','high','urgent'],due_at:'datetime-local',assigned_user_id:'assignee',notes:'textarea'},required:['title'],defaults:{status:'open',priority:'normal'}},
 attorneys:{title:'Attorney',fields:{name:'text',firm:'text',states:'states',phone:'text',email:'email',notes:'textarea'},required:['name'],defaults:{states:[]}},
 claims:{title:'Claim',fields:{attorney_id:'attorney',status:['research','attorney_review','documents_requested','filed','pending','approved','denied','paid','closed'],filing_date:'date',deadline:'date',claimed_amount:'number',approved_amount:'number',fee_amount:'number',notes:'textarea'},required:['lead_record_id'],defaults:{status:'research'}},
 payments:{title:'Payment',fields:{claim_id:'claim',amount:'number',payment_type:['recovery','company_fee','attorney_fee','expense','refund','other'],status:['expected','invoiced','received','paid','void'],paid_at:'datetime-local',notes:'textarea'},required:['amount','lead_record_id'],defaults:{payment_type:'company_fee',status:'expected'}}
};
function metrics(leads,data,now=Date.now()){
 const sum=(xs,k)=>xs.reduce((s,x)=>s+(Number(x[k])||0),0),claims=data.claims||[],payments=data.payments||[];
 return {pipeline:leads.filter(l=>!['Paid','Closed / Lost'].includes(l.stage)).reduce((s,l)=>s+(Number(l.excess)||0)*(Number(l.closingProbability)||0)/100,0),approved:sum(claims.filter(c=>['approved','paid'].includes(c.status)),'approved_amount'),fees:sum(claims.filter(c=>!['denied','closed'].includes(c.status)),'fee_amount'),revenue:sum(payments.filter(p=>p.payment_type==='company_fee'&&p.status==='received'),'amount'),outstanding:claims.filter(c=>!['denied','paid','closed'].includes(c.status)).length,overdue:(data.tasks||[]).filter(t=>!['done','cancelled'].includes(t.status)&&t.due_at&&Date.parse(t.due_at)<now).length};
}
const api={statuses,defaults,compliance,ready,pipelineStage,label,validate,stateQueue,schemas,metrics};
if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.CRMOperations=api;
})(typeof globalThis!=='undefined'?globalThis:this);
