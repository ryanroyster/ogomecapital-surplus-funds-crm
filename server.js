const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 8787);
const REAPI_BASE = "https://api.realestateapi.com";
const CRM_PARTS = Array.from({length:8},(_,i)=>path.join(ROOT,"crm_parts",`part${String(i+1).padStart(2,"0")}.html`));

function loadEnvFile() {
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const s=line.trim(); if(!s||s.startsWith("#"))continue;
    const i=s.indexOf("="); if(i<0)continue;
    const k=s.slice(0,i).trim(), v=s.slice(i+1).trim().replace(/^['"]|['"]$/g,"");
    if(!(k in process.env))process.env[k]=v;
  }
}
loadEnvFile();

const cfg={
  reapiKey:()=>String(process.env.REALESTATEAPI_KEY||"").trim(),
  supabaseUrl:()=>String(process.env.SUPABASE_URL||"").trim().replace(/\/+$/,"") ,
  supabaseAnon:()=>String(process.env.SUPABASE_ANON_KEY||"").trim(),
  supabaseService:()=>String(process.env.SUPABASE_SERVICE_ROLE_KEY||"").trim()
};
function supabaseConfigured(){return !!(cfg.supabaseUrl()&&cfg.supabaseAnon()&&cfg.supabaseService())}
function json(res,status,payload){
  const body=JSON.stringify(payload);
  res.writeHead(status,{"Content-Type":"application/json; charset=utf-8","Content-Length":Buffer.byteLength(body),"Cache-Control":"no-store","X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer"});
  res.end(body);
}
function sendHtml(res,body){
  res.writeHead(200,{"Content-Type":"text/html; charset=utf-8","Content-Length":Buffer.byteLength(body),"Cache-Control":"no-store","X-Content-Type-Options":"nosniff","Referrer-Policy":"same-origin"});
  res.end(body);
}
function sendPreservedCRM(res){
  try{
    for(const p of CRM_PARTS) if(!fs.existsSync(p)) throw new Error(`Missing CRM asset: ${path.basename(p)}`);
    return sendHtml(res,CRM_PARTS.map(p=>fs.readFileSync(p,"utf8")).join("").replace('<script src="/public/automation-ui.js">','<script src="/public/calendar-domain.js"></script><script src="/public/automation-ui.js">'));
  }catch(e){
    console.error("CRM frontend assembly failed:",e.message);
    return json(res,500,{error:"CRM frontend assembly failed"});
  }
}
function sendFile(res,filePath){
  const ext=path.extname(filePath).toLowerCase(),types={".html":"text/html; charset=utf-8",".js":"application/javascript; charset=utf-8",".css":"text/css; charset=utf-8",".json":"application/json; charset=utf-8",".txt":"text/plain; charset=utf-8",".md":"text/markdown; charset=utf-8",".png":"image/png",".jpg":"image/jpeg",".jpeg":"image/jpeg",".svg":"image/svg+xml",".ico":"image/x-icon"};
  fs.readFile(filePath,(err,data)=>{if(err)return json(res,404,{error:"File not found"});res.writeHead(200,{"Content-Type":types[ext]||"application/octet-stream","X-Content-Type-Options":"nosniff"});res.end(data)});
}
function safeStaticPath(urlPath){
  let decoded;try{decoded=decodeURIComponent(urlPath)}catch{return null}
  const rel=decoded.replace(/^\/+/ ,""),full=path.resolve(ROOT,rel);
  if(!full.startsWith(path.resolve(ROOT)+path.sep))return null;
  return full;
}
async function readBody(req){
  return new Promise((resolve,reject)=>{let data="";req.on("data",c=>{data+=c;if(data.length>3*1024*1024){reject(new Error("Request body too large"));req.destroy()}});req.on("end",()=>{if(!data)return resolve({});try{resolve(JSON.parse(data))}catch{reject(new Error("Invalid JSON"))}});req.on("error",reject)});
}
function bearer(req){const h=String(req.headers.authorization||"");return h.toLowerCase().startsWith("bearer ")?h.slice(7).trim():""}
async function fetchJson(url,options={}){
  const r=await fetch(url,options),text=await r.text();let d={};try{d=text?JSON.parse(text):{}}catch{d={raw:text}}
  if(!r.ok){const e=new Error(d.error_description||d.msg||d.message||d.error||`Request failed: ${r.status}`);e.status=r.status;throw e}
  return d;
}
async function supabaseAuth(endpoint,body){
  if(!supabaseConfigured()){const e=new Error("Supabase backend is not configured.");e.status=503;throw e}
  return fetchJson(cfg.supabaseUrl()+"/auth/v1/"+endpoint,{method:"POST",headers:{"apikey":cfg.supabaseAnon(),"Content-Type":"application/json"},body:JSON.stringify(body)});
}
async function requireUser(req){
  if(!supabaseConfigured()){const e=new Error("Cloud backend is not configured.");e.status=503;throw e}
  const token=bearer(req);if(!token){const e=new Error("Authentication required.");e.status=401;throw e}
  const user=await fetchJson(cfg.supabaseUrl()+"/auth/v1/user",{headers:{"apikey":cfg.supabaseAnon(),"Authorization":"Bearer "+token}});
  if(!user?.id){const e=new Error("Invalid cloud session.");e.status=401;throw e}
  return user;
}
function serviceHeaders(extra={}){return {"apikey":cfg.supabaseService(),"Authorization":"Bearer "+cfg.supabaseService(),"Content-Type":"application/json",...extra}}
async function dbGet(table,userId){
  const url=cfg.supabaseUrl()+`/rest/v1/${table}?user_id=eq.${encodeURIComponent(userId)}&select=record_id,payload,updated_at`;
  const rows=await fetchJson(url,{headers:serviceHeaders()});
  return Array.isArray(rows)?rows.map(r=>r.payload).filter(Boolean):[];
}
async function dbMergeUpcoming(userId,items){
  if(!Array.isArray(items)||items.some(item=>!item||typeof item!=="object"||Array.isArray(item)||!["string","number"].includes(typeof item.id)||!String(item.id).trim())){
    const e=new Error("Upcoming records must be an array with stable record IDs.");e.status=400;throw e;
  }
  const unique=[...new Map(items.map(item=>[String(item.id),item])).values()];
  if(!unique.length)return 0;
  const now=new Date().toISOString();
  const rows=unique.map(item=>({user_id:userId,record_id:String(item.id),payload:item,updated_at:now}));
  // One atomic upsert: never delete existing records during synchronization.
  await fetchJson(cfg.supabaseUrl()+"/rest/v1/crm_upcoming?on_conflict=user_id,record_id",{
    method:"POST",headers:serviceHeaders({"Prefer":"resolution=merge-duplicates,return=minimal"}),body:JSON.stringify(rows)
  });
  return unique.length;
}

function cleanState(v){return String(v||"").trim().toUpperCase().slice(0,2)}
async function reapi(pathname,body){
  if(!cfg.reapiKey()){const e=new Error("REALESTATEAPI_KEY is not configured.");e.status=503;throw e}
  return fetchJson(REAPI_BASE+pathname,{method:"POST",headers:{"Content-Type":"application/json","Accept":"application/json","x-api-key":cfg.reapiKey()},body:JSON.stringify(body)});
}
function arrayFromSearch(p){if(Array.isArray(p))return p;if(Array.isArray(p?.data))return p.data;if(Array.isArray(p?.data?.data))return p.data.data;if(Array.isArray(p?.results))return p.results;if(Array.isArray(p?.properties))return p.properties;return []}
function detailObject(p){return p?.data||p?.property||p||{}}
const operations=require('./operations-api')({cfg,fetchJson,serviceHeaders,requireUser,readBody,json,dbGet});
const automation=require('./automation-api')({cfg,fetchJson,serviceHeaders,requireUser,readBody,json,dbGet});
setInterval(()=>automation.dispatch().catch(()=>console.error('Automation dispatch deferred')),60000).unref();

function pickAuctionInfo(d){const a=d.auctionInfo||{};let h=Array.isArray(d.foreclosureInfo)?d.foreclosureInfo:[];h=[...h].sort((x,y)=>String(y.auctionDate||"").localeCompare(String(x.auctionDate||"")));const f=h.find(x=>x.active)||h[0]||{};return Object.keys(a).length?a:f}
function normalize(d){
  const a=pickAuctionInfo(d),oi=d.ownerInfo||{};
  // PropertyDetail nests situs fields; PropertySearch may return them at the root.
  const rawAddress=d.propertyInfo?.address||d.address||d.propertyAddress||{};
  const addr=typeof rawAddress==="string"?{}:rawAddress;
  const street=addr.address||[addr.house,addr.street,addr.streetType].filter(Boolean).join(" ");
  const address=typeof rawAddress==="string"?rawAddress:(addr.label||[street,addr.city,addr.state,addr.zip].filter(Boolean).join(", "));
  const ownerName=oi.owner1FullName||[oi.owner1FirstName,oi.owner1LastName].filter(Boolean).join(" ")||d.owner1FullName||[d.owner1FirstName,d.owner1LastName].filter(Boolean).join(" ")||"";
  return {id:d.id??null,apn:d.lotInfo?.apn||d.lotInfo?.apnUnformatted||d.apn||d.parcelAccountNumber||d.parcel_account_number||null,address:address||d.addressString||d.propertyAddressString||"",city:addr.city||d.city||"",county:addr.county||d.county||d.countyName||"",state:addr.state||d.state||"",zip:addr.zip||d.zip||"",ownerName,propertyType:d.propertyType||d.propertyInfo?.propertyType||"",estimatedValue:d.estimatedValue??null,estimatedEquity:d.estimatedEquity??null,equityPercent:d.equityPercent??null,highEquity:d.highEquity??false,corporateOwned:d.corporateOwned??false,individualOwned:d.individualOwned??null,inherited:d.inherited??false,death:d.death??false,lien:d.lien??false,judgment:d.judgment??false,auctionDate:a.auctionDate?String(a.auctionDate).slice(0,10):null,openingBid:a.openingBid??null,judgmentAmount:a.judgmentAmount??null,caseNumber:a.caseNumber??null,foreclosureId:a.foreclosureId??null,documentType:a.documentType??null,noticeType:a.noticeType??null,trusteeFullName:a.trusteeFullName??null,typeName:a.typeName??null,active:a.active??null,lastUpdateDate:d.lastUpdateDate??null};
}

const server=http.createServer(async(req,res)=>{
  try{
    const u=new URL(req.url,`http://${req.headers.host||"localhost"}`);

    if(req.method==="GET"&&u.pathname==="/api/health")return json(res,200,{ok:true,service:"Ogome Capital Surplus Funds CRM v25",frontend:"preserved-v24-ui",operationsVersion:1,automationVersion:1,automationProviders:automation.providers(),cloudConfigured:supabaseConfigured(),realEstateApiConfigured:!!cfg.reapiKey()});
    if(req.method==="GET"&&u.pathname==="/api/cloud/status")return json(res,200,{ok:true,provider:"Supabase",configured:supabaseConfigured(),architecture:"server-mediated",serviceRoleExposedToBrowser:false});

    if(req.method==="POST"&&u.pathname==="/api/auth/login"){
      const b=await readBody(req),d=await supabaseAuth("token?grant_type=password",{email:String(b.email||""),password:String(b.password||"")});
      return json(res,200,{access_token:d.access_token,refresh_token:d.refresh_token,expires_in:d.expires_in,user:d.user});
    }
    if(req.method==="POST"&&u.pathname==="/api/auth/signup"){
      const b=await readBody(req),d=await supabaseAuth("signup",{email:String(b.email||""),password:String(b.password||"")});
      return json(res,200,d);
    }
    if(req.method==="POST"&&u.pathname==="/api/auth/refresh"){
      const b=await readBody(req);
      if(typeof b.refresh_token!=="string"||!b.refresh_token)return json(res,400,{error:"Refresh token required."});
      const d=await supabaseAuth("token?grant_type=refresh_token",{refresh_token:b.refresh_token});
      return json(res,200,{access_token:d.access_token,refresh_token:d.refresh_token,expires_in:d.expires_in,user:d.user});
    }
    if(await automation.handle(req,res,u))return;
    if(await operations.handle(req,res,u))return;
    if(req.method==="GET"&&u.pathname==="/api/cloud/upcoming"){const user=await requireUser(req);return json(res,200,{upcoming:await dbGet("crm_upcoming",user.id)})}
    if(req.method==="PUT"&&u.pathname==="/api/cloud/upcoming"){const user=await requireUser(req),b=await readBody(req);const count=await dbMergeUpcoming(user.id,b.upcoming);return json(res,200,{ok:true,count})}

    if(req.method==="GET"&&u.pathname==="/api/reapi/status")return json(res,200,{ok:true,configured:!!cfg.reapiKey(),provider:"RealEstateAPI",keyExposedToBrowser:false,purpose:"upcoming-auction-discovery-only"});
    if(req.method==="POST"&&u.pathname==="/api/reapi/property-detail"){
      const b=await readBody(req),input={};if(b.id)input.id=String(b.id);else if(b.address)input.address=String(b.address);else if(b.apn){input.apn=String(b.apn);if(b.state)input.state=cleanState(b.state);if(b.county)input.county=String(b.county)}else return json(res,400,{error:"Provide id, address, or apn."});
      return json(res,200,{result:normalize(detailObject(await reapi("/v2/PropertyDetail",input)))});
    }
    if(req.method==="POST"&&u.pathname==="/api/reapi/search-auctions"){
      const b=await readBody(req),states=Array.isArray(b.states)&&b.states.length?b.states.map(cleanState).filter(Boolean):["CA"],size=Math.min(Math.max(Number(b.size||50),1),100),auctionDateMin=String(b.auctionDateMin||"").slice(0,10),auctionDateMax=String(b.auctionDateMax||"").slice(0,10),estimatedEquityMin=Number(b.estimatedEquityMin||0),propertyType=String(b.propertyType||"").trim(),merged=[];
      for(const state of states){
        const query={size,auction:true,state};if(auctionDateMin)query.auction_date_min=auctionDateMin;if(auctionDateMax)query.auction_date_max=auctionDateMax;if(estimatedEquityMin>0)query.estimated_equity_min=estimatedEquityMin;if(propertyType)query.property_type=propertyType;
        const rows=arrayFromSearch(await reapi("/v2/PropertySearch",query));
        for(const row of rows.slice(0,size)){let detail=row;const n=normalize(detailObject(row));if((!n.auctionDate||!n.address||n.estimatedValue==null)&&row?.id!=null){try{detail=detailObject(await reapi("/v2/PropertyDetail",{id:String(row.id)}))}catch(_){}}const x=normalize(detailObject(detail));if(x.auctionDate)merged.push(x)}
      }
      const seen=new Set(),unique=merged.filter(x=>{const k=String(x.id||`${x.state}|${x.apn}|${x.auctionDate}`);if(seen.has(k))return false;seen.add(k);return true});
      return json(res,200,{provider:"RealEstateAPI",verification:"Discovery only — verify against official county source",count:unique.length,results:unique});
    }

    if(req.method==="GET"&&(u.pathname==="/"||u.pathname==="/index.html"))return sendPreservedCRM(res);
    if(req.method==="GET"&&['/public/operations-domain.js','/public/operations-ui.js','/public/automation-domain.js','/public/automation-ui.js','/public/automation.css','/public/calendar-domain.js'].includes(u.pathname))return sendFile(res,path.join(ROOT,u.pathname.slice(1)));

    return json(res,404,{error:"Not found"});
  }catch(e){console.error(e);return json(res,e.status||500,{error:e.message||"Server error"})}
});

server.on("error",e=>{console.error("CRM server error:",e.message);process.exit(1)});
server.listen(PORT,"0.0.0.0",()=>{console.log(`Ogome Capital CRM v25 listening on ${PORT}`);console.log(`Frontend: preserved v24 UI assembled from ${CRM_PARTS.length} parts`);console.log(`Cloud configured: ${supabaseConfigured()?"YES":"NO"}`);console.log(`RealEstateAPI configured: ${cfg.reapiKey()?"YES":"NO"}`)});
