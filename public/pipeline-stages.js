(function(root){
'use strict';
const sections=[{name:'New',stage:'New Lead',color:'#377ff3'},{name:'Contacted',stage:'Contacted',color:'#e4af00'},{name:'Docs Sent',stage:'Docs Sent',color:'#fb7610'},{name:'Signed',stage:'Signed Contract',color:'#10b781'},{name:'Attorney Review',stage:'Attorney Review',color:'#aa6deb'},{name:'Claim Filed',stage:'Claim Filed',color:'#8955ee'},{name:'Paid',stage:'Paid',color:'#208c68'}];
function bucket(l){if(l.stage==='Closed / Lost')return null;if(l.stage==='Paid')return 'Paid';if(['Claim Filed','Approved'].includes(l.stage))return 'Claim Filed';if(l.stage==='Attorney Review')return 'Attorney Review';if(l.stage==='Signed Contract')return 'Signed';if(l.stage==='Docs Sent')return 'Docs Sent';if(['Contacted','Interested'].includes(l.stage))return 'Contacted';return 'New';}
const api={sections,bucket};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.OGPipeline=api;
})(globalThis);
