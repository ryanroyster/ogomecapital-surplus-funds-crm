/* Match the reference board without changing stages or lead records. */
(function(){
'use strict';
const colors={'New Lead':'#377ff3','County Verified':'#377ff3','Recorder Research':'#5886df','Claimant Verified':'#438cc9','Qualified':'#229cad','Call Ready':'#219cad','Contacted':'#e4af00','Interested':'#fb7610','Signed Contract':'#10b781','Attorney Review':'#aa6deb','Claim Filed':'#8955ee','Approved':'#2eac87','Paid':'#208c68','Closed / Lost':'#687080','Clearance required (historical)':'#b86565'};
const money=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(Number(n)||0);
function decorate(){
 const board=document.getElementById('kanban');if(!board)return;const legend=board.previousElementSibling;if(legend?.classList.contains('lead-color-legend'))legend.innerHTML='<summary>Pipeline color guide</summary><p>Stage headers: blue early stages · yellow Contacted · orange Interested · green Signed Contract · purple Claim Filed. Card dots show priority: A+ rose, A green, B amber, C blue, D slate. Compliance clearance is shown separately on each card.</p>';
 for(const col of board.querySelectorAll('.col')){
  const stage=col.dataset.stage,items=leads.filter(l=>CRMOperations.pipelineStage(l)===stage);col.style.setProperty('--stage-color',colors[stage]||'#687080');
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
const previous=renderPipeline;renderPipeline=function(...args){const result=previous.apply(this,args);decorate();return result;};decorate();
})();
