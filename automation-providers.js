'use strict';
// Vendor-neutral, server-only adapters. No simulated deliveries or fabricated AI results.
const {createHmac,timingSafeEqual}=require('crypto');
function configured(kind){return !!(process.env[`CRM_${kind}_GATEWAY_URL`]&&process.env[`CRM_${kind}_GATEWAY_TOKEN`]);}
function status(){return {llm:configured('LLM')?'connected':'not_connected',stt:configured('STT')?'connected':'not_connected',telephony:process.env.CRM_TELEPHONY_CONNECTED==='true'?'connected':'not_connected',sms:configured('SMS')&&process.env.CRM_SMS_FROM&&process.env.CRM_WEBHOOK_SECRET&&process.env.CRM_SMS_ENABLED==='true'?'live':'not_connected'};}
async function invoke(kind,input){
 if(!configured(kind))throw Object.assign(new Error(`${kind} provider is not connected.`),{status:503});
 const url=new URL(process.env[`CRM_${kind}_GATEWAY_URL`]);if(url.protocol!=='https:')throw new Error('Provider gateway must use HTTPS.');
 const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+process.env[`CRM_${kind}_GATEWAY_TOKEN`]},body:JSON.stringify(input),signal:AbortSignal.timeout(45000)});
 if(!response.ok)throw new Error(`${kind} provider request failed (${response.status}).`);
 const value=await response.json();return value;
}
function verify(raw,headers,now=Date.now()){
 const secret=process.env.CRM_WEBHOOK_SECRET,t=String(headers['x-crm-timestamp']||''),signature=String(headers['x-crm-signature']||'');
 if(!secret||!/^\d+$/.test(t)||Math.abs(now-Number(t)*1000)>300000||! /^[a-f0-9]{64}$/i.test(signature))return false;
 const expected=createHmac('sha256',secret).update(t+'.'+raw).digest();return timingSafeEqual(expected,Buffer.from(signature,'hex'));
}
module.exports={status,invoke,verify};
