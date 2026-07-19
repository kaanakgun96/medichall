import { createClient } from "npm:@supabase/supabase-js@2";

const ORIGINS = new Set([
  "https://medichall.com",
  "https://www.medichall.com",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);
const MAX_PAGES = 8;
const MAX_LINKS = 180;
const MAX_HTML_BYTES = 4 * 1024 * 1024;

const MIME_BY_EXT: Record<string,string> = {
  pdf:"application/pdf",
  doc:"application/msword",
  docx:"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls:"application/vnd.ms-excel",
  xlsx:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv:"text/csv",
  txt:"text/plain",
  zip:"application/zip",
};

function headers(req:Request){
  const origin=req.headers.get("origin")||"";
  return {
    "Access-Control-Allow-Origin":ORIGINS.has(origin)?origin:"https://medichall.com",
    "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods":"POST, OPTIONS",
    "Content-Type":"application/json; charset=utf-8",
    "Vary":"Origin",
  };
}
function reply(req:Request,body:unknown,status=200){
  return new Response(JSON.stringify(body),{status,headers:headers(req)});
}
function blockedHost(host:string){
  const h=host.toLowerCase();
  return h==="localhost"||h.endsWith(".local")||h==="0.0.0.0"||h==="::1"||
    /^127\./.test(h)||/^10\./.test(h)||/^192\.168\./.test(h)||
    /^169\.254\./.test(h)||/^172\.(1[6-9]|2\d|3[01])\./.test(h);
}
function safeUrl(value:string,base?:string){
  try{
    const u=new URL(value,base);
    if(!["http:","https:"].includes(u.protocol)||blockedHost(u.hostname)) return null;
    u.hash="";
    return u;
  }catch{return null}
}
function decode(v:string){
  return v.replaceAll("&amp;","&").replaceAll("&quot;",'"')
    .replaceAll("&#39;","'").replaceAll("&lt;","<").replaceAll("&gt;",">");
}
function cleanText(v:string){
  return decode(v.replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim());
}
function extInfo(url:string){
  try{
    const name=decodeURIComponent(new URL(url).pathname.split("/").pop()||"");
    const ext=(name.split(".").pop()||"").toLowerCase();
    return {name:name||null,mime:MIME_BY_EXT[ext]||null};
  }catch{return {name:null,mime:null}}
}
function docType(title:string,url:string){
  const x=(title+" "+url).toLowerCase();
  if(/technical|specification|capitolato|cahier|leistungsverzeichnis/.test(x)) return "technical_specification";
  if(/boq|bill.?of.?quant|quantit|computo/.test(x)) return "boq";
  if(/price|pricing|prezzo|preis|financial.?offer/.test(x)) return "price_schedule";
  if(/lot|lotti/.test(x)) return "lot_document";
  if(/administrative|disciplinare|instructions/.test(x)) return "administrative";
  return "other";
}
function candidates(body:string,pageUrl:string){
  const out=new Map<string,{url:string,title:string,source:string}>();
  const a=/<a\b[^>]*?\bhref\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi;
  for(const m of body.matchAll(a)){
    const u=safeUrl(decode(m[2]),pageUrl); if(!u) continue;
    out.set(u.href,{url:u.href,title:cleanText(m[3]).slice(0,250),source:pageUrl});
  }
  // TED/eForms BT-15 procurement document URI values.
  const uri=/<(?:\w+:)?URI\b[^>]*>([\s\S]*?)<\/(?:\w+:)?URI>/gi;
  for(const m of body.matchAll(uri)){
    const u=safeUrl(cleanText(m[1]),pageUrl); if(!u) continue;
    out.set(u.href,{url:u.href,title:"Procurement documents",source:pageUrl});
  }
  for(const raw of body.match(/https?:\/\/[^\s"'<>\\]+/gi)||[]){
    const u=safeUrl(decode(raw.replace(/[),.;]+$/,"")),pageUrl); if(!u) continue;
    if(!out.has(u.href)) out.set(u.href,{url:u.href,title:"",source:pageUrl});
  }
  return [...out.values()].slice(0,MAX_LINKS);
}
async function fetchText(url:string){
  const r=await fetch(url,{
    redirect:"follow",
    headers:{
      "User-Agent":"MedicHall-Tender-Attachment-Discovery/1.0",
      "Accept":"text/html,application/xhtml+xml,application/xml,text/xml,*/*;q=0.8",
    }
  });
  if(!r.ok) throw new Error(`Page request failed (${r.status})`);
  const n=Number(r.headers.get("content-length")||0);
  if(n>MAX_HTML_BYTES) throw new Error("Page too large");
  const b=new Uint8Array(await r.arrayBuffer());
  if(b.byteLength>MAX_HTML_BYTES) throw new Error("Page too large");
  return {body:new TextDecoder().decode(b),url:r.url||url};
}
async function inspect(c:{url:string,title:string,source:string}){
  const e=extInfo(c.url);
  if(e.mime){
    return {kind:"document",row:{
      file_url:c.url,title:c.title||e.name,file_name:e.name,mime_type:e.mime,
      document_type:docType(c.title,c.url),source_page_url:c.source,is_active:true,
      updated_at:new Date().toISOString()
    }};
  }
  try{
    let r=await fetch(c.url,{method:"HEAD",redirect:"follow",
      headers:{"User-Agent":"MedicHall-Tender-Attachment-Discovery/1.0"}});
    if(r.status===405){
      r=await fetch(c.url,{method:"GET",redirect:"follow",
        headers:{"User-Agent":"MedicHall-Tender-Attachment-Discovery/1.0","Range":"bytes=0-1024"}});
    }
    if(!r.ok&&r.status!==206) return null;
    const ct=(r.headers.get("content-type")||"").split(";")[0].toLowerCase();
    const final=r.url||c.url, info=extInfo(final);
    if(ct&&!ct.includes("html")&&!ct.includes("xml")&&
       (ct.includes("pdf")||ct.includes("word")||ct.includes("excel")||
        ct.includes("spreadsheet")||ct.includes("csv")||ct.includes("zip")||
        ct==="text/plain"||ct==="application/octet-stream")){
      return {kind:"document",row:{
        file_url:final,title:c.title||info.name,file_name:info.name,
        mime_type:ct==="application/octet-stream"?info.mime:ct,
        document_type:docType(c.title,final),source_page_url:c.source,is_active:true,
        updated_at:new Date().toISOString()
      }};
    }
    return {kind:"page",candidate:c};
  }catch{return {kind:"page",candidate:c}}
}
async function run(admin:any,jobId:number){
  const {data:job,error}=await admin.from("tender_document_discovery_jobs")
    .select("id,tender_id,company_id,source_url").eq("id",jobId).single();
  if(error||!job) throw new Error("Discovery job not found");
  await admin.from("tender_document_discovery_jobs").update({
    status:"processing",started_at:new Date().toISOString(),updated_at:new Date().toISOString()
  }).eq("id",jobId);

  const source=safeUrl(job.source_url); if(!source) throw new Error("Invalid source URL");
  const queue=[{url:source.href,title:"Tender source",source:source.href}];
  const pages=new Set<string>(),links=new Set<string>();
  const docs=new Map<string,any>(); let examined=0;

  while(queue.length&&pages.size<MAX_PAGES){
    const p=queue.shift()!; if(pages.has(p.url)) continue; pages.add(p.url);
    let page; try{page=await fetchText(p.url)}catch{continue}
    for(const c of candidates(page.body,page.url)){
      if(examined>=MAX_LINKS) break;
      if(links.has(c.url)) continue; links.add(c.url); examined++;
      const result=await inspect(c); if(!result) continue;
      if(result.kind==="document"){docs.set(result.row.file_url,result.row);continue}
      const u=safeUrl(result.candidate.url); if(!u) continue;
      const useful=/(document|download|attachment|procurement|tender|appalto|march|vergabe|licit)/i
        .test(u.href+" "+result.candidate.title);
      if((u.hostname===source.hostname||useful)&&!pages.has(u.href)) queue.push(result.candidate);
    }
  }
  const rows=[...docs.values()].map(r=>({...r,tender_id:job.tender_id}));
  if(rows.length){
    const {error:e}=await admin.from("tender_documents").upsert(rows,{onConflict:"tender_id,file_url"});
    if(e) throw new Error(e.message);
  }
  await admin.from("tender_document_discovery_jobs").update({
    status:rows.length?"completed":"partial",
    pages_scanned:pages.size,links_examined:examined,documents_found:rows.length,
    error_message:rows.length?null:
      "No open document links found. The portal may require login, JavaScript, CAPTCHA or manual URLs.",
    completed_at:new Date().toISOString(),updated_at:new Date().toISOString()
  }).eq("id",jobId);
}

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS") return new Response("ok",{headers:headers(req)});
  if(req.method!=="POST") return reply(req,{error:"Method not allowed"},405);
  const origin=req.headers.get("origin"); if(origin&&!ORIGINS.has(origin)) return reply(req,{error:"Origin not allowed"},403);
  const url=Deno.env.get("SUPABASE_URL"),anon=Deno.env.get("SUPABASE_ANON_KEY"),
        service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!url||!anon||!service) return reply(req,{error:"Discovery engine is not configured"},500);
  const auth=req.headers.get("authorization")||"";
  if(!auth.toLowerCase().startsWith("bearer ")) return reply(req,{error:"Authentication required"},401);
  const token=auth.slice(7).trim();
  const authClient=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:{user},error:authError}=await authClient.auth.getUser(token);
  if(authError||!user) return reply(req,{error:"Invalid or expired session"},401);
  let body:any; try{body=await req.json()}catch{return reply(req,{error:"Invalid JSON"},400)}
  const tenderId=Number(body.tender_id),companyId=Number(body.company_id);
  if(!Number.isInteger(tenderId)||!Number.isInteger(companyId))
    return reply(req,{error:"Valid tender_id and company_id are required"},400);
  const userClient=createClient(url,anon,{
    global:{headers:{Authorization:`Bearer ${token}`}},
    auth:{persistSession:false,autoRefreshToken:false}
  });
  if(body.action==="status"){
    const {data,error}=await userClient.rpc("get_tender_document_discovery_status",{
      p_tender_id:tenderId,p_company_id:companyId
    });
    if(error) return reply(req,{error:error.message},400);
    return reply(req,{job:Array.isArray(data)?data[0]??null:data});
  }
  const {data,error}=await userClient.rpc("queue_tender_document_discovery",{
    p_tender_id:tenderId,p_company_id:companyId
  });
  if(error) return reply(req,{error:error.message},400);
  const job=Array.isArray(data)?data[0]:data;
  if(!job?.id) return reply(req,{error:"Could not create discovery job"},500);
  const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
  EdgeRuntime.waitUntil(run(admin,Number(job.id)).catch(async(e)=>{
    await admin.from("tender_document_discovery_jobs").update({
      status:"failed",error_message:String(e?.message||e).slice(0,1000),
      completed_at:new Date().toISOString(),updated_at:new Date().toISOString()
    }).eq("id",job.id);
  }));
  return reply(req,{ok:true,job_id:job.id,status:job.status},202);
});
