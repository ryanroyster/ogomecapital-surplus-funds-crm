/* Repair legacy browser seed duplication without capping or reordering legitimate leads. */
(function(root){
'use strict';
const norm=v=>String(v??'').trim().toLowerCase();
function repair(rows){
 const out=[],seen=new Map();
 for(const row of rows){
  const key=row.apn&&row.state&&row.name?JSON.stringify([norm(row.state),norm(row.county),norm(row.apn),norm(row.name),Number(row.excess),norm(row.caseNumber||row.case_number),norm(row.saleDate||row.sale_date)]):'id:'+String(row.id);
  const existing=seen.get(key);if(!existing){const copy={...row};seen.set(key,copy);out.push(copy);continue;}
  // Keep the first record's identity, rank and status; retain duplicate notes and communications.
  if(row.notes&&row.notes!==existing.notes&&!String(existing.notes||'').includes(row.notes))existing.notes=[existing.notes,row.notes].filter(Boolean).join('\n\n');
  if(row.commLog?.length){const records=[...(existing.commLog||[]),...row.commLog],unique=new Map(records.map(x=>[JSON.stringify(x),x]));existing.commLog=[...unique.values()];}
  for(const k of ['phone','email','smsDraft'])if(!existing[k]&&row[k])existing[k]=row[k];
 }
 return out;
}
if(typeof module!=='undefined'&&module.exports){module.exports={repair};return;}
// preservedSavedLeads was captured before the old seed migrations ran.
const saved=preservedSavedLeads,source=saved.length?saved:leads,result=repair(source);
if(JSON.stringify(leads)!==JSON.stringify(result)){
 // A failed backup aborts the repair rather than discarding recoverable device data.
 try{const key='surplusCRM_duplicate_recovery_v2';if(!localStorage.getItem(key))localStorage.setItem(key,JSON.stringify({saved,generated:leads,at:new Date().toISOString()}));localStorage.setItem('surplusCRM_v1',JSON.stringify(result));leads=result;}catch(error){console.warn('Browser lead repair could not save its recovery backup.');}
}
renderAll();
})(globalThis);
