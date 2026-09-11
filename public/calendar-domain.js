(function(root){
'use strict';
const palette=['#5688eb','#8f6bdd','#27a6ba','#39a984','#c69043','#c56688'];
function segments(events,day){
 const begin=new Date(day);begin.setHours(0,0,0,0);const finish=new Date(begin);finish.setDate(finish.getDate()+1);
 const minutes=d=>d.getHours()*60+d.getMinutes();
 const entries=events.filter(e=>!e.all_day&&Date.parse(e.start_at)<finish&&Math.max(Date.parse(e.end_at),Date.parse(e.start_at)+60000)>begin).map(e=>{const s=new Date(e.start_at),end=new Date(e.end_at);return {...e,top:s<begin?0:minutes(s),bottom:end>=finish?1440:Math.min(1440,Math.max(minutes(end),(s<begin?0:minutes(s))+15))};}).sort((a,b)=>a.top-b.top||b.bottom-a.bottom);
 let group=[],end=-1;
 const assign=()=>{const lanes=[];for(const e of group){let lane=lanes.findIndex(v=>v<=e.top);if(lane<0)lane=lanes.length;lanes[lane]=e.bottom;e.lane=lane;}for(const e of group)e.lanes=lanes.length;};
 for(const e of entries){if(e.top>=end){assign();group=[];end=-1;}group.push(e);end=Math.max(end,e.bottom);}assign();return entries;
}
const escapeICS=s=>String(s||'').replaceAll('\\','\\\\').replaceAll('\n','\\n').replaceAll(';','\\;').replaceAll(',','\\,');
const unescapeICS=s=>s.replace(/\\[nN]/g,'\n').replace(/\\([,;\\])/g,'$1');
const localDate=v=>{const d=new Date(v);return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;};
function exportICS(events){const stamp=d=>new Date(d).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');return ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//OGOME Capital//CRM Calendar//EN','CALSCALE:GREGORIAN',...events.flatMap(e=>['BEGIN:VEVENT','UID:'+escapeICS(e.import_uid||e.id+'@ogome-crm'),'DTSTAMP:'+stamp(new Date()),...(e.all_day?['DTSTART;VALUE=DATE:'+localDate(e.start_at),'DTEND;VALUE=DATE:'+localDate(e.end_at)]:['DTSTART:'+stamp(e.start_at),'DTEND:'+stamp(e.end_at)]),'SUMMARY:'+escapeICS(e.title),'DESCRIPTION:'+escapeICS(e.notes),'LOCATION:'+escapeICS(e.location),'END:VEVENT']),'END:VCALENDAR'].join('\r\n');}
function parseICS(raw){
 if(typeof raw!=='string'||raw.length>1000000)throw new Error('Choose an iCalendar file under 1 MB.');if(!raw.includes('BEGIN:VCALENDAR'))throw new Error('This is not an iCalendar (.ics) file.');
 const blocks=raw.replace(/\r?\n[ \t]/g,'').split('BEGIN:VEVENT').slice(1),events=[];
 for(const block of blocks){const obj={};for(const line of block.split(/\r?\n/)){if(line==='END:VEVENT')break;const i=line.indexOf(':');if(i<0)continue;const key=line.slice(0,i),base=key.split(';')[0];obj[base]={key,value:line.slice(i+1)};}
  if(obj.RRULE)throw new Error('This file contains recurrence rules. Export individual occurrences or use the CRM repeat control; no events were imported.');
  const date=field=>{if(!field)return null;const v=field.value;if(/TZID=/.test(field.key)&&!v.endsWith('Z'))throw new Error('Import requires UTC or all-day dates. Export UTC dates to preserve timezone accuracy.');const m=v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);if(!m)throw new Error('Invalid calendar date.');if(m[4]&&!m[7])throw new Error('Timed imports need explicit UTC (Z) dates.');const result=m[4]?`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`:`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`;if(!Number.isFinite(Date.parse(result)))throw new Error('Invalid calendar date.');return result;};
  const start=date(obj.DTSTART);if(!start)throw new Error('An imported event has no start date.');const allDay=!obj.DTSTART.value.includes('T'),end=date(obj.DTEND)||new Date(Date.parse(start)+(allDay?86400000:1800000)).toISOString();
  events.push({title:unescapeICS(obj.SUMMARY?.value||'Imported event'),start_at:start,end_at:end,timezone:'UTC',all_day:allDay,kind:'appointment',status:'scheduled',notes:unescapeICS(obj.DESCRIPTION?.value||''),location:unescapeICS(obj.LOCATION?.value||''),import_uid:obj.UID?.value||start+'|'+(obj.SUMMARY?.value||'')});
 }
 if(!events.length)throw new Error('No events were found.');if(events.length>200)throw new Error('Import up to 200 events at a time.');return events;
}
const api={palette,segments,exportICS,parseICS};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.CRMCalendar=api;
})(globalThis);
