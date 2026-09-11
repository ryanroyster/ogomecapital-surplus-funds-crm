/* Presentation only: existing CRM actions, priorities and cloud ownership remain authoritative. */
(function(){
'use strict';
const $=id=>document.getElementById(id),E=esc;
let overview=null,owner=null,loading=false,failed=false;
const dashboard=$('dashboard');
const hero=document.createElement('section');hero.className='og-hero';hero.innerHTML='<div class="og-clock" id="ogClock"></div><div class="og-date" id="ogDate"></div><div class="og-welcome"><div><h2>Welcome to OGOME Capital</h2><p id="ogWelcome"></p><button class="og-due" id="ogDue" type="button">Open calendar</button></div><div class="og-brand-card"><b>OGOME CAPITAL</b><span>CLAIM RECOVERY WORKSPACE</span></div></div>';dashboard.prepend(hero);
const grid=document.createElement('div');grid.className='og-dashboard-grid';grid.innerHTML='<section class="panel og-summary"><h2>OGOME Activity Summary</h2><div id="ogActivityMetrics" class="og-activity-metrics"></div><div class="og-briefing" id="ogBriefing"></div><div class="og-section-title"><span>MY TASKS</span><button class="linkbtn" id="ogViewTasks">View calendar</button></div><div id="ogTasks"></div></section>';
const pipeline=$('pipelineBars').closest('.panel');pipeline.querySelector('h2').textContent='Pipeline Snapshot';grid.append(pipeline);$('kpiCards').after(grid);
const activity=document.createElement('section');activity.className='panel og-recent';activity.innerHTML='<h2>Recent Activity</h2><div id="ogRecent"></div>';grid.after(activity);
const goCalendar=()=>document.querySelector('.nav [data-view="auto-calendar"]')?.click();$('ogDue').onclick=goCalendar;$('ogViewTasks').onclick=goCalendar;
function clock(){const d=new Date();$('ogClock').textContent=d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',hour12:false});$('ogDate').textContent=d.toLocaleDateString([],{weekday:'long',month:'long',day:'numeric'});}clock();setInterval(clock,30000);
function paint(){
 const connected=cloudReady(),valid=connected&&owner===cloudSession?.user?.id&&overview,rows=k=>valid?overview[k]||[]:[],tasks=rows('tasks').filter(x=>!['done','cancelled'].includes(x.status)),today=new Date().toLocaleDateString(),due=tasks.filter(x=>x.due_at&&new Date(x.due_at).toLocaleDateString()===today),cleared=leads.filter(x=>x.compliance_status==='CLEARED').length;
 $('ogWelcome').textContent=`${leads.length} leads in your workspace. Keep your next steps in view.`;
 $('ogDue').textContent=valid?`${due.length} tasks due today · review calendar`:'Open your calendar';
 const metrics=[['Calls recorded',rows('call_sessions').length],['Texts sent',rows('messages').filter(x=>['sent','delivered'].includes(x.payload.status)).length],['Contacted',leads.filter(x=>x.stage==='Contacted').length],['Signed',leads.filter(x=>x.stage==='Signed Contract').length]];
 $('ogActivityMetrics').innerHTML=metrics.map(([label,n],i)=>`<div><span>${E(label)}</span><b>${i<2&&!valid?'—':n}</b></div>`).join('');
 $('ogBriefing').textContent=valid?`${cleared} of ${leads.length} leads are compliance cleared. ${tasks.length} follow-ups remain open. Your priority queue below keeps its existing order. Activity reflects saved CRM records.`:connected?(failed?'Activity could not be loaded. Use Sync now or try again shortly.':'Loading saved activity…'):`Sign in to see cloud activity and follow-ups. Your ${leads.length} visible leads and existing priorities remain available.`;
 const sorted=tasks.slice().sort((a,b)=>(Date.parse(a.due_at)||Infinity)-(Date.parse(b.due_at)||Infinity)).slice(0,4);
 $('ogTasks').replaceChildren();for(const t of sorted){const row=document.createElement('button');row.type='button';row.className='og-task';const title=document.createElement('span');title.textContent=t.title;const date=document.createElement('small');date.textContent=t.due_at?new Date(t.due_at).toLocaleDateString([],{month:'short',day:'numeric'}):'No due date';row.append(title,date);row.onclick=()=>t.lead_record_id?openLeadComm(t.lead_record_id):goCalendar();$('ogTasks').append(row);}if(!sorted.length)$('ogTasks').innerHTML=`<p class="og-empty">${valid?'No open tasks. Add a follow-up from a lead’s workspace.':'Sign in to load your tasks.'}</p>`;
 const activity=[...rows('call_sessions').map(x=>({at:x.created_at,text:'Call session · '+x.payload.title,lid:x.lead_record_id})),...rows('assistant_actions').map(x=>({at:x.created_at,text:'Assistant · '+String(x.payload.type||'action').replaceAll('_',' '),lid:x.lead_record_id}))].sort((a,b)=>Date.parse(b.at)-Date.parse(a.at)).slice(0,5);
 $('ogRecent').replaceChildren();for(const item of activity){const row=document.createElement('div');row.className='og-task';const label=document.createElement('span');label.textContent=item.text;const date=document.createElement('small');date.textContent=new Date(item.at).toLocaleString();row.append(label,date);$('ogRecent').append(row);}if(!activity.length)$('ogRecent').innerHTML=`<p class="og-empty">${valid?'No call or assistant activity recorded yet.':'Sign in to see recorded activity.'}</p>`;
}
async function refresh(){if(!cloudReady()){overview=null;owner=null;paint();return;}if(loading)return;loading=true;const uid=cloudSession.user.id;try{const r=await cloudRequest('/api/automation/overview');if(cloudSession?.user?.id===uid){overview=r;owner=uid;failed=false;}}catch{overview=null;failed=true;}finally{loading=false;paint();}}
const original=renderAll;renderAll=function(...args){const result=original.apply(this,args);paint();return result;};
const disconnect=disconnectCloud;disconnectCloud=function(...args){overview=null;owner=null;const r=disconnect.apply(this,args);paint();return r;};
paint();refresh();setInterval(refresh,30000);
})();
