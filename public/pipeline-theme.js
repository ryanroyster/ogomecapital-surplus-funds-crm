/* Match the reference board without changing stages or lead records. */
(function(){
'use strict';
const {sections,bucket}=OGPipeline;
if(!STAGES.includes('Docs Sent'))STAGES.push('Docs Sent');
for(const id of ['stage','stageFilter']){const select=document.getElementById(id);if(select&&![...select.options].some(x=>x.value==='Docs Sent'))select.add(new Option('Docs Sent','Docs Sent'));}
const colors=Object.fromEntries(sections.map(x=>[x.name,x.color]));
const money=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(Number(n)||0);
function decorate(){
 const board=document.getElementById('kanban');if(!board)return;const legend=board.previousElementSibling;if(legend?.classList.contains('lead-color-legend'))legend.innerHTML='<summary>Pipeline color guide</summary><p>Stage headers: blue New · yellow Contacted · orange Docs Sent · green Signed · lavender Attorney Review · purple Claim Filed · deep green Paid. Card dots show priority: A+ rose, A green, B amber, C blue, D slate. Compliance clearance is shown separately on each card.</p>';
 for(const col of board.querySelectorAll('.col')){
  const stage=col.dataset.section,items=leads.filter(l=>bucket(l)===stage);col.style.setProperty('--stage-color',colors[stage]||'#687080');
  const head=col.querySelector('.colhead');head.replaceChildren();const title=document.createElement('div');title.className='pipeline-stage-title';title.textContent=stage+' ('+items.length+')';const total=document.createElement('div');total.className='pipeline-stage-total';total.textContent=money(items.reduce((sum,l)=>sum+(Number(l.excess)||0),0))+' total';head.append(title,total);
  for(const card of col.querySelectorAll('.leadcard')){
   const id=card.getAttribute('onclick')?.match(/openLeadComm\('([^']+)'\)/)?.[1],l=items.find(x=>String(x.id)===id);if(!l)continue;
   // Replace card contents only; original click and drag handlers stay on the card.
   card.tabIndex=0;card.setAttribute('role','button');card.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();openLeadComm(l.id);}};card.replaceChildren();const text=(tag,cls,value)=>{const e=document.createElement(tag);e.className=cls;e.textContent=value;return e;};
   const name=text('div','pipeline-lead-name',l.name||'Unnamed lead');name.title='Priority '+(l.priority||'Not rated');const dot=text('span','pipeline-priority-dot','');dot.style.background=({ 'A+':'#f69bab',A:'#91ddb3',B:'#edcb7d',C:'#9cbfff',D:'#b6c1d1'})[l.priority]||'#b6c1d1';dot.setAttribute('aria-label','Priority '+(l.priority||'Not rated'));name.prepend(dot);card.append(name,text('div','pipeline-address',l.address||'Address not recorded'));
   const amount=text('div','pipeline-card-row','');amount.append(text('strong','',money(l.excess)),text('span','',l.saleType||l.sale_type||l.auctionType||'Sale type unverified'));card.append(amount);
   const location=text('div','pipeline-card-row','');const date=l.saleDate||l.sale_date;location.append(text('span','',[l.county,l.state].filter(Boolean).join(', ')||'County not recorded'),text('span','pipeline-sale-date',date||''));card.append(location);
   const footer=text('div','pipeline-card-footer','');footer.append(text('span','','Priority '+(l.priority||'Not rated')),text('span','',l.compliance_status||'NOT_REVIEWED'));card.append(footer);
   const next=l.nextAction;if(next){card.title=next;}
  }
 }
}
function regroup(){
 const board=document.getElementById('kanban');if(!board)return;
 const cards=new Map([...board.querySelectorAll('.leadcard')].map(card=>[card.getAttribute('onclick')?.match(/openLeadComm\('([^']+)'\)/)?.[1],card]));board.replaceChildren();
 for(const section of sections){const col=document.createElement('div');col.className='col';col.dataset.section=section.name;col.dataset.stage=section.stage;const head=document.createElement('div');head.className='colhead';col.append(head);col.ondragover=e=>e.preventDefault();col.ondrop=e=>move(e,section);for(const l of leads.filter(l=>bucket(l)===section.name)){const card=cards.get(String(l.id));if(card)col.append(card);}if(col.children.length===1){const empty=document.createElement('div');empty.className='empty';empty.textContent='No leads';col.append(empty);}board.append(col);}
 let note=document.getElementById('pipelineClosedNote');if(!note){note=document.createElement('button');note.id='pipelineClosedNote';note.className='linkbtn';note.style.marginTop='12px';board.after(note);note.onclick=()=>document.querySelector('.nav [data-view="leads"]')?.click();}const closed=leads.filter(l=>!bucket(l)).length;note.hidden=!closed;note.textContent=closed+' closed / lost leads · view in Leads';
}
async function move(e,section){
 e.preventDefault();const id=e.dataTransfer.getData('text/plain'),lead=leads.find(l=>String(l.id)===id);if(!lead||bucket(lead)===section.name)return;
 if(!cloudReady()){alert('Sign in to move leads securely.');return;}
 if(!confirm('Move '+lead.name+' to '+section.name+'? Compliance clearance is required. Signed requires verified contract evidence.'))return;
 try{if(localStorage.getItem(leadPendingKey()))await syncToCloud();const proposal=await cloudRequest('/api/automation/assistant/propose',{method:'POST',body:JSON.stringify({lead_record_id:id,action:{type:'move_stage',stage:section.stage}})});const p=proposal.items.find(x=>x.payload?.status==='pending');if(!p)throw new Error('No review proposal was created.');await cloudRequest('/api/automation/proposals/'+p.id+'/execute',{method:'POST',body:JSON.stringify({confirm:true})});await syncFromCloud(false);}catch(error){alert(error.message);}
}
function snapshot(target,rows){const node=document.getElementById(target);if(!node)return;node.replaceChildren();for(const section of sections){const row=document.createElement('div');row.className='row';row.style.setProperty('--snapshot-color',section.color);const label=document.createElement('span');label.textContent=section.name;const count=document.createElement('b');count.textContent=rows.filter(l=>bucket(l)===section.name).length;row.append(label,count);node.append(row);}}
const previous=renderPipeline;renderPipeline=function(...args){const result=previous.apply(this,args);regroup();decorate();return result;};
const dashboard=renderDashboard;renderDashboard=function(...args){const result=dashboard.apply(this,args);snapshot('pipelineBars',leads);return result;};
const states=renderStateWorkspace;renderStateWorkspace=function(...args){const result=states.apply(this,args);snapshot('statePipeline',leads.filter(l=>(l.state||'California')===activeState));return result;};
renderPipeline();snapshot('pipelineBars',leads);snapshot('statePipeline',leads.filter(l=>(l.state||'California')===activeState));
})();
