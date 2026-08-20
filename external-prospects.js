(function(global){
"use strict";
if(global.MedicHallExternalProspects)return;

const esc=value=>String(value??"").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
const list=value=>Array.isArray(value)?value:[];
const uuid=()=>global.crypto.randomUUID();
const safeUrl=value=>{try{const url=new URL(String(value||""));return url.protocol==="https:"&&!url.username&&!url.password?url.href:null;}catch(_){return null;}};
const label=value=>String(value||"").toLowerCase().replace(/(^|[_\s])\w/g,text=>text.toUpperCase()).replace(/_/g," ");
const ACTIVE_STATUSES=new Set(["QUEUED","RUNNING"]);
const TERMINAL_STATUSES=new Set(["COMPLETED","PARTIAL","FAILED"]);
const POLL_MAX_MS=10*60*1000;
const STAGES=[
  ["loading_profile","Understanding your company and products"],
  ["preparing_market_search","Preparing your European market search"],
  ["searching_procurement","Searching European procurement evidence"],
  ["checking_business_sources","Checking official business sources"],
  ["verifying_websites","Verifying public company websites"],
  ["removing_duplicates","Removing duplicates and MedicHall members"],
  ["ranking_prospects","Ranking evidence-backed buyer candidates"],
  ["preparing_results","Preparing your results"]
];
const SOURCE_LABELS={
  COMPANY_WEBSITE:"Company website",PRODUCT_CATALOGUE:"Product catalogue",
  TED_AWARD:"European procurement record",ASSOCIATION_DIRECTORY:"Industry association",
  EXHIBITOR_DIRECTORY:"Industry directory",PUBLIC_REGISTRY:"Official business registry",
  OTHER_PUBLIC_SOURCE:"Other public source"
};
const COUNTRY_COVERAGE={
  FR:{name:"France",tone:"active",title:"Official registry signals active",detail:"Company and business-activity evidence may enrich results."},
  NO:{name:"Norway",tone:"active",title:"Official registry signals active",detail:"Company and business-activity evidence may enrich results."},
  PL:{name:"Poland",tone:"partial",title:"Limited registry enrichment",detail:"Official KRS enrichment is available only when an explicit KRS identifier is already known."},
  DE:{name:"Germany",tone:"neutral",title:"Registry enrichment unavailable",detail:"Official registry requests remain disabled pending legal review."},
  IT:{name:"Italy",tone:"neutral",title:"Registry enrichment unavailable",detail:"Official registry requests remain disabled pending legal review."},
  NL:{name:"Netherlands",tone:"neutral",title:"Registry enrichment unavailable",detail:"Official registry requests remain disabled pending legal review."},
  BE:{name:"Belgium",tone:"neutral",title:"Registry enrichment unavailable",detail:"Official registry requests remain disabled pending legal review."},
  ES:{name:"Spain",tone:"neutral",title:"Registry enrichment unavailable",detail:"No supported official registry integration is currently available."}
};

function createWorkspace(options){
  if(!options?.root||typeof options.rpc!=="function"||typeof options.edge!=="function")throw new Error("Buyer Discovery workspace configuration is incomplete.");
  const state={
    data:{runs:[],prospects:[]},loading:false,discovering:false,openId:null,
    notice:null,pollTimer:null,pollInFlight:false,destroyed:false,lastTerminalRun:null,
    filters:{query:"",country:"",market:"",type:"",evidence:"",score:"",freshness:"",status:"",sort:"score"}
  };
  const toast=message=>options.toast?.(message);
  const track=event=>options.track?.(event);

  function currentRun(){return list(state.data.runs)[0]||null;}
  function isActive(run=currentRun()){return ACTIVE_STATUSES.has(String(run?.status||"").toUpperCase());}
  function pollingExpired(run=currentRun()){
    if(!isActive(run))return false;
    const started=Date.parse(run.started_at||run.created_at||"");
    return Number.isFinite(started)&&Date.now()-started>POLL_MAX_MS;
  }
  function targetCountries(){
    const profileCountries=list(options.profile?.target_countries);
    return [...new Set(list(options.targetCountries).concat(profileCountries).map(value=>String(value||"").trim().toUpperCase()).filter(Boolean))];
  }
  function readiness(){
    const productCount=Math.max(0,Number(options.activeProductCount||0));
    const markets=targetCountries();
    return {
      role:String(options.profile?.role||"manufacturer").toLowerCase()==="manufacturer",
      products:productCount,
      markets,
      ready:productCount>0&&markets.length>0&&String(options.profile?.role||"manufacturer").toLowerCase()==="manufacturer"
    };
  }

  async function load(settings={}){
    if(state.loading||state.destroyed)return;
    state.loading=true;
    if(!settings.silent&&!state.data.prospects.length)options.root.innerHTML='<div class="mhxp"><div class="mhxp-empty"><b>Loading European Buyer Discovery…</b></div></div>';
    try{
      state.data=await options.rpc("get_external_prospect_workspace_v1",{p_company_id:Number(options.companyId),p_limit:200})||{runs:[],prospects:[]};
      if(!state.destroyed){syncPolling();render();}
    }catch(error){
      if(!settings.silent&&!state.destroyed)options.root.innerHTML='<div class="mhxp"><div class="mhxp-error" role="alert"><b>Buyer Discovery is unavailable.</b><br>'+esc(friendlyError(error))+'</div></div>';
    }finally{state.loading=false;}
  }

  function schedulePoll(delay=3200){
    clearTimeout(state.pollTimer);
    if(state.destroyed||pollingExpired()||(!isActive()&&!state.discovering))return;
    state.pollTimer=setTimeout(poll,delay);
  }
  async function poll(){
    if(state.destroyed||pollingExpired()||(!isActive()&&!state.discovering))return;
    if(document.hidden||state.pollInFlight){schedulePoll(3200);return;}
    state.pollInFlight=true;
    try{await load({silent:true});}
    finally{state.pollInFlight=false;if(isActive()||state.discovering)schedulePoll(3200);}
  }
  function syncPolling(){
    if(pollingExpired()){
      clearTimeout(state.pollTimer);
      state.notice={tone:"neutral",title:"This search is taking longer than expected.",message:"Automatic refresh has paused after 10 minutes. Use Refresh results to check the saved backend state; do not start a duplicate search."};
    }else if(isActive()||state.discovering)schedulePoll(900);
    else clearTimeout(state.pollTimer);
    const run=currentRun();
    if(run&&TERMINAL_STATUSES.has(String(run.status||"").toUpperCase())&&state.lastTerminalRun!==run.id){
      state.lastTerminalRun=run.id;
      if(String(run.status).toUpperCase()!=="FAILED")track("external_prospect_discovery_completed");
    }
  }

  function filtered(){
    const query=state.filters.query.trim().toLowerCase();
    const prospects=list(state.data.prospects).filter(item=>{
      const evidence=list(item.evidence);
      return (!query||[item.company_name,item.country_name,item.company_type,item.reason_summary,...list(item.taxonomy).map(row=>row.canonical_name)].join(" ").toLowerCase().includes(query))&&
        (!state.filters.country||item.country_code===state.filters.country)&&
        (!state.filters.market||item.target_market===true)&&
        (!state.filters.type||item.company_type===state.filters.type)&&
        (!state.filters.score||Number(item.relevance_score||0)>=Number(state.filters.score))&&
        (!state.filters.freshness||item.freshness===state.filters.freshness)&&
        (!state.filters.status||item.workflow_status===state.filters.status)&&
        (!state.filters.evidence||evidence.some(row=>row.source_type===state.filters.evidence));
    });
    return prospects.sort((a,b)=>state.filters.sort==="recent"
      ?String(b.last_scored_at||"").localeCompare(String(a.last_scored_at||""))
      :state.filters.sort==="procurement"?Number(b.procurement_signal_score||0)-Number(a.procurement_signal_score||0)
      :state.filters.sort==="country"?String(a.country_name||a.country_code||"").localeCompare(String(b.country_name||b.country_code||""))
      :state.filters.sort==="name"?String(a.company_name||"").localeCompare(String(b.company_name||""))
      :Number(b.relevance_score||0)-Number(a.relevance_score||0));
  }

  function filterOptions(field){return [...new Set(list(state.data.prospects).map(item=>item[field]).filter(Boolean))].sort();}
  function stageIndex(stage){return STAGES.findIndex(row=>row[0]===stage);}
  function stageName(stage,status){
    if(stage==="completed")return status==="PARTIAL"?"Search completed with limited source coverage":"Search completed";
    if(stage==="failed")return"Search could not be completed";
    return STAGES.find(row=>row[0]===stage)?.[1]||label(stage||status);
  }
  function coverageHtml(run){
    const requested=targetCountries();
    if(!requested.length)return"";
    const diagnostic=list(run?.diagnostics?.registry_coverage);
    const diagnosticCodes=new Set(diagnostic.map(row=>String(row.country_code||"").toUpperCase()));
    return '<details class="mhxp-coverage"><summary>Source coverage for your target markets</summary><div class="mhxp-coverage-grid">'+requested.map(code=>{
      const known=COUNTRY_COVERAGE[code]||{name:code,tone:"neutral",title:"Procurement and public-web search available",detail:"Official registry enrichment is not currently supported for this market."};
      const checked=diagnosticCodes.has(code)?" · checked in this run":"";
      return '<article class="'+known.tone+'"><b>'+esc(known.name)+'</b><span>'+esc(known.title)+esc(checked)+'</span><p>'+esc(known.detail)+'</p></article>';
    }).join("")+'</div><p class="mhxp-coverage-note">Registry coverage affects enrichment only. European procurement and public-web evidence can still produce candidates where available.</p></details>';
  }
  function runHtml(run){
    if(!run)return"";
    const status=String(run.status||"").toUpperCase();
    const current=stageIndex(run.stage);
    const steps=STAGES.map((row,index)=>'<li class="'+(index<current?"done":index===current&&isActive(run)?"active":"")+'"><span aria-hidden="true">'+(index<current?"✓":index===current&&isActive(run)?"●":"○")+'</span>'+esc(row[1])+'</li>').join("");
    const sourceCount=Number(run.sources_checked||0),found=Number(run.candidates_found||0),accepted=Number(run.candidates_accepted||0),deduped=Number(run.candidates_deduplicated||0);
    let outcome="";
    if(status==="PARTIAL")outcome='<div class="mhxp-state partial"><b>Results are ready with limited source coverage.</b><p>Available evidence was ranked normally. One or more public sources could not be reached, so absence of a result is not proof that no buyer exists.</p></div>';
    if(status==="FAILED")outcome='<div class="mhxp-state failed" role="alert"><b>This search could not be completed.</b><p>'+esc(friendlyRunError(run.error_code))+'</p><button type="button" data-action="reload">Check status</button></div>';
    if(status==="COMPLETED")outcome='<div class="mhxp-state complete"><b>European buyer search complete.</b><p>'+accepted+' evidence-backed candidate'+(accepted===1?"":"s")+' met the current confidence threshold.</p></div>';
    return '<section class="mhxp-progress '+status.toLowerCase()+'" aria-live="polite" aria-label="Buyer Discovery progress"><div class="mhxp-progress-head"><div><span class="mhxp-kicker">Latest search</span><h4>'+esc(stageName(run.stage,status))+'</h4><p>Only completed backend work is shown. No estimated percentage is used.</p></div><span class="mhxp-run-state '+status.toLowerCase()+'">'+esc(status)+'</span></div>'+
      (isActive(run)?'<ol class="mhxp-stages">'+steps+'</ol>':"")+
      '<div class="mhxp-counters"><div><strong>'+sourceCount+'</strong><span>public sources checked</span></div><div><strong>'+found+'</strong><span>candidates found</span></div><div><strong>'+deduped+'</strong><span>duplicates removed</span></div><div><strong>'+accepted+'</strong><span>evidence-backed results</span></div></div>'+outcome+coverageHtml(run)+'</section>';
  }

  function components(item){return[
    ["Product fit",item.product_taxonomy_score,40],["Market fit",item.geography_score,15],["Buyer type",item.company_type_score,15],
    ["Procurement",item.procurement_signal_score,15],["Evidence",item.evidence_quality_score,10],["Recency",item.recency_score,5]
  ].map(row=>'<div class="mhxp-component"><span>'+esc(row[0])+'</span><b>'+Number(row[1]||0)+' / '+row[2]+'</b></div>').join("");}
  function evidenceHtml(item){
    const evidence=list(item.evidence).map(row=>{
      const url=safeUrl(row.source_url),direct=row.evidence_kind==="DIRECT_PRODUCT_EVIDENCE";
      return '<article><span class="mhxp-kind '+(direct?"direct":"indirect")+'">'+(direct?"Direct product evidence":"Indirect commercial evidence")+'</span><span class="mhxp-source">'+esc(SOURCE_LABELS[row.source_type]||"Public business source")+'</span><b>'+esc(row.source_title||row.source_domain||"Verified public record")+'</b><p>'+esc(row.evidence_snippet||"Public source record")+'</p>'+(url?'<a href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">Open public evidence ↗</a>':"")+'</article>';
    }).join("");
    const activities=list(item.activities).map(row=>'<article class="mhxp-activity"><span class="mhxp-kind indirect">Indirect commercial evidence</span><span class="mhxp-source">Official business activity</span><b>'+esc(row.normalized_activity_class||"Relevant medical trade activity")+'</b><p>'+esc(row.activity_description||"Relevant registered commercial activity")+'</p></article>').join("");
    return evidence+activities||'<article><b>No visible evidence</b><p>This candidate is not presented as a verified result without supporting public evidence.</p></article>';
  }
  function signalCounts(item){
    const rows=list(item.evidence).concat(list(item.activities));
    return {direct:rows.filter(row=>row.evidence_kind==="DIRECT_PRODUCT_EVIDENCE").length,indirect:rows.filter(row=>row.evidence_kind!=="DIRECT_PRODUCT_EVIDENCE").length};
  }
  function card(item){
    const open=Number(state.openId)===Number(item.match_id),website=safeUrl(item.website_url),status=String(item.workflow_status||"NEW"),signals=signalCounts(item);
    const freshness={RECENT:"Recently verified",AGING:"Verification aging",STALE:"Recheck recommended"}[item.freshness]||"Verification date unavailable";
    return '<article class="mhxp-card '+(status==="DISMISSED"?"dismissed":"")+'" data-match="'+Number(item.match_id)+'"><div class="mhxp-top"><div><div class="mhxp-badges"><span class="mhxp-badge external">European buyer candidate</span><span class="mhxp-badge">Not yet a MedicHall member</span><span class="mhxp-badge">'+esc(freshness)+'</span></div><h4>'+esc(item.company_name)+'</h4><div class="mhxp-meta">'+esc(label(item.company_type||"Business buyer"))+(item.country_name||item.country_code?' · '+esc(item.country_name||item.country_code):"")+(item.city_region?' · '+esc(item.city_region):"")+'</div></div><div class="mhxp-score" style="--score:'+Number(item.relevance_score||0)+'"><b>'+Number(item.relevance_score||0)+'</b><span>match</span></div></div><p class="mhxp-reason">'+esc(item.reason_summary||"Evidence suggests commercial relevance to your product categories.")+'</p><div class="mhxp-signal-summary"><span>'+signals.direct+' direct product signal'+(signals.direct===1?"":"s")+'</span><span>'+signals.indirect+' supporting commercial signal'+(signals.indirect===1?"":"s")+'</span></div><div class="mhxp-components">'+components(item)+'</div><div class="mhxp-taxonomy">'+list(item.taxonomy).map(row=>'<span>'+esc(row.canonical_name)+'</span>').join("")+'</div><div class="mhxp-card-actions"><button type="button" data-action="detail" data-id="'+Number(item.match_id)+'" aria-expanded="'+String(open)+'">'+(open?"Hide evidence":"View evidence")+'</button>'+(website?'<a class="mhxp-button" data-action="website" data-id="'+Number(item.match_id)+'" href="'+esc(website)+'" target="_blank" rel="noopener noreferrer">Company website ↗</a>':"")+'<button type="button" data-action="feedback" data-state="SAVED" data-id="'+Number(item.match_id)+'">'+(status==="SAVED"?"Saved ✓":"Save")+'</button><button type="button" data-action="feedback" data-state="INTERESTING" data-id="'+Number(item.match_id)+'">Interesting</button><button type="button" data-action="feedback" data-state="DISMISSED" data-id="'+Number(item.match_id)+'">Dismiss</button></div><div class="mhxp-detail" '+(open?"":"hidden")+'><div class="mhxp-section"><h5>Why this company appears</h5><p class="mhxp-evidence-note">Direct evidence supports a product-level statement. Indirect evidence supports commercial relevance only and never proves the company currently sells your exact product.</p><div class="mhxp-evidence">'+evidenceHtml(item)+'</div></div><div class="mhxp-section"><h5>Private company note</h5><textarea class="mhxp-note" maxlength="2000" data-note="'+Number(item.match_id)+'" placeholder="Visible only inside your company workspace">'+esc(item.private_note||"")+'</textarea><p class="mhxp-note-help">No outreach is sent. MedicHall stores this note only for your company.</p><button type="button" data-action="note" data-id="'+Number(item.match_id)+'">Save private note</button></div></div></article>';
  }
  function selectOptions(values,current,labels={}){return values.map(value=>'<option '+(current===value?'selected':'')+' value="'+esc(value)+'">'+esc(labels[value]||label(value))+'</option>').join("");}
  function filtersHtml(){
    return '<details class="mhxp-filter-shell" open><summary>Refine buyer results</summary><div class="mhxp-filters"><div class="mhxp-search"><label>Search</label><input data-filter="query" value="'+esc(state.filters.query)+'" placeholder="Company, product category or reason"></div>'+[
      '<div><label>Country</label><select data-filter="country"><option value="">All countries</option>'+selectOptions(filterOptions("country_code"),state.filters.country)+'</select></div>',
      '<div><label>Market</label><select data-filter="market"><option value="">All markets</option><option value="target" '+(state.filters.market?'selected':'')+'>Target markets</option></select></div>',
      '<div><label>Buyer type</label><select data-filter="type"><option value="">All types</option>'+selectOptions(filterOptions("company_type"),state.filters.type)+'</select></div>',
      '<div><label>Minimum match</label><select data-filter="score"><option value="">Any score</option>'+selectOptions(["75","55"],state.filters.score,{75:"75 or higher",55:"55 or higher"})+'</select></div>',
      '<div><label>Evidence source</label><select data-filter="evidence"><option value="">All evidence</option>'+selectOptions(Object.keys(SOURCE_LABELS),state.filters.evidence,SOURCE_LABELS)+'</select></div>',
      '<div><label>Freshness</label><select data-filter="freshness"><option value="">Any age</option>'+selectOptions(["RECENT","AGING","STALE"],state.filters.freshness,{RECENT:"Recently verified",AGING:"Verification aging",STALE:"Recheck recommended"})+'</select></div>',
      '<div><label>Saved state</label><select data-filter="status"><option value="">All states</option>'+selectOptions(["NEW","SAVED","INTERESTING","DISMISSED"],state.filters.status)+'</select></div>',
      '<div><label>Sort</label><select data-filter="sort"><option value="score" '+(state.filters.sort==="score"?'selected':'')+'>Best match</option><option value="recent" '+(state.filters.sort==="recent"?'selected':'')+'>Most recent</option><option value="procurement" '+(state.filters.sort==="procurement"?'selected':'')+'>Procurement signal</option><option value="country" '+(state.filters.sort==="country"?'selected':'')+'>Country</option><option value="name" '+(state.filters.sort==="name"?'selected':'')+'>Company A–Z</option></select></div>'
    ].join("")+'</div></details>';
  }
  function readinessHtml(){
    const ready=readiness();
    const checks=[
      [ready.role,"Manufacturer company profile","Buyer Discovery is available to manufacturer accounts."],
      [ready.products>0,"At least one active product",ready.products?ready.products+" active product"+(ready.products===1?"":"s")+" will guide category matching.":"Add a structured product so MedicHall knows what you sell."],
      [ready.markets.length>0,"European target markets",ready.markets.length?ready.markets.join(", "):"Add at least one target country to your matchmaking profile."]
    ];
    return '<section class="mhxp-empty mhxp-ready"><div class="mhxp-empty-icon" aria-hidden="true">⌁</div><span class="mhxp-kicker">Evidence-backed growth</span><h4>Find credible European buyers beyond the MedicHall network.</h4><p>MedicHall combines relevant procurement history, public company websites, industry sources and supported official business-activity signals. It never collects private contact details or sends outreach.</p><div class="mhxp-readiness">'+checks.map(row=>'<div class="'+(row[0]?"ready":"needed")+'"><span aria-hidden="true">'+(row[0]?"✓":"○")+'</span><div><b>'+esc(row[1])+'</b><p>'+esc(row[2])+'</p></div></div>').join("")+'</div><button class="primary" type="button" data-action="discover" '+(!ready.ready?'disabled aria-disabled="true"':'')+'>Search Europe for buyers</button>'+(!ready.ready?'<p class="mhxp-help">Complete the missing items above before starting a search.</p>':'<p class="mhxp-help">Searches are bounded, cached and rate-limited. You stay in control.</p>')+coverageHtml(null)+'</section>';
  }
  function friendlyRunError(code){
    const value=String(code||"").toUpperCase();
    if(value.includes("CONTEXT")||value.includes("PROFILE"))return"Your company or product context could not be loaded. Review your profile, then try again.";
    if(value.includes("TAXONOMY"))return"Your structured product categories could not be loaded. Review your products, then try again.";
    return"No saved results were removed. Refresh the status, then retry when ready.";
  }
  function friendlyError(error){
    const value=String(error?.userMessage||error?.message||"Buyer Discovery could not be completed.");
    if(/30 minutes|cooldown/i.test(value))return"A recent search is still within the safety cooldown. Your existing results remain available; try again after 30 minutes.";
    if(/daily/i.test(value))return"Today’s safe search limit has been reached. Existing results remain available; try again tomorrow.";
    if(/monthly/i.test(value))return"This month’s search limit has been reached. Existing results remain available.";
    if(/access denied|42501/i.test(value))return"This company workspace is not available to the current account.";
    return"Buyer Discovery could not be completed. Existing saved results are unchanged; please try again.";
  }
  function render(){
    if(state.destroyed)return;
    const prospects=filtered(),all=list(state.data.prospects),run=currentRun(),active=isActive(run),ready=readiness();
    const header='<div class="mhxp-head"><div><span class="mhxp-kicker">European market development</span><h3>European Buyer Discovery</h3><p>Find evidence-backed distributors, importers, wholesalers and institutional buyers beyond the current MedicHall member network.</p></div><div class="mhxp-actions"><button class="primary" type="button" data-action="discover" '+(active||state.discovering||!ready.ready?'disabled':'')+'>'+(active||state.discovering?'Search in progress…':all.length?'Search Europe again':'Search Europe for buyers')+'</button><button type="button" data-action="reload">Refresh results</button></div></div>';
    const privacy='<div class="mhxp-notice"><b>Public business evidence only.</b> No private contact details are collected, no outreach is sent, and broad activity codes are never presented as proof of exact product availability.</div>';
    const notice=state.notice?'<div class="mhxp-state '+esc(state.notice.tone||"neutral")+'" role="status"><b>'+esc(state.notice.title)+'</b><p>'+esc(state.notice.message)+'</p></div>':"";
    const results=all.length?'<section class="mhxp-results"><div class="mhxp-results-head"><div><span class="mhxp-kicker">Ranked candidates</span><h4>'+all.length+' buyer candidate'+(all.length===1?"":"s")+'</h4><p>Each result passed the configured direct-or-multiple-independent-signal confidence gate.</p></div></div>'+filtersHtml()+(prospects.length?'<div class="mhxp-list">'+prospects.map(card).join("")+'</div>':'<div class="mhxp-empty"><b>No buyers match these filters.</b><p>Clear or change a filter to see more saved results.</p></div>')+'</section>':(!run||statusAllowsEmpty(run)?readinessHtml():'<div class="mhxp-empty"><b>No candidates met the evidence threshold.</b><p>The search completed normally. Try again later after updating products or target markets; weak single-source matches are intentionally excluded.</p></div>');
    options.root.innerHTML='<div class="mhxp">'+header+privacy+notice+runHtml(run)+results+'</div>';
  }
  function statusAllowsEmpty(run){return !run||ACTIVE_STATUSES.has(String(run.status||"").toUpperCase())||String(run.status||"").toUpperCase()==="FAILED";}

  async function discover(){
    if(state.discovering||isActive()){
      state.notice={tone:"neutral",title:"A search is already running.",message:"Progress will update here automatically. Starting the same search again would not create a second request."};
      render();syncPolling();return;
    }
    const ready=readiness();
    if(!ready.ready){state.notice={tone:"neutral",title:"Finish your discovery setup first.",message:"Add an active product and at least one European target market."};render();return;}
    state.discovering=true;state.notice=null;render();track("external_prospect_discovery_started");
    const request=options.edge("external-prospect-discovery",{company_id:Number(options.companyId),idempotency_key:uuid()});
    schedulePoll(700);
    try{
      const result=await request;
      await load({silent:true});
      state.notice={tone:"complete",title:result?.cached?"Existing results restored.":"Buyer search finished.",message:result?.cached?"MedicHall reused the matching cached search safely.":"The latest evidence-backed results are ready to review."};
      toast(result?.cached?"Existing Buyer Discovery results loaded.":"European Buyer Discovery completed.");
    }catch(error){
      await load({silent:true});
      state.notice={tone:"failed",title:"Search not started or interrupted.",message:friendlyError(error)};
      toast(friendlyError(error));
    }finally{state.discovering=false;render();syncPolling();}
  }
  async function feedback(id,feedbackState,note){
    try{
      await options.rpc("set_external_prospect_feedback_v1",{p_match_id:Number(id),p_feedback_state:feedbackState,p_private_note:note??null,p_idempotency_key:uuid()});
      if(feedbackState==="SAVED"||feedbackState==="INTERESTING")track("external_prospect_saved");
      if(feedbackState==="DISMISSED")track("external_prospect_dismissed");
      await load({silent:true});toast(feedbackState==="DISMISSED"?"Buyer candidate dismissed.":"Buyer candidate updated.");
    }catch(error){toast(friendlyError(error));}
  }
  function onClick(event){
    const target=event.target.closest("[data-action]");if(!target||!options.root.contains(target))return;
    const action=target.dataset.action,id=Number(target.dataset.id);
    if(action==="discover")discover();
    else if(action==="reload")load();
    else if(action==="detail"){state.openId=state.openId===id?null:id;if(state.openId)track("external_prospect_viewed");render();}
    else if(action==="feedback")feedback(id,target.dataset.state,null);
    else if(action==="note"){const note=options.root.querySelector('[data-note="'+id+'"]')?.value||"";feedback(id,"NOTE_ONLY",note);}
    else if(action==="website")track("external_prospect_website_clicked");
  }
  function onChange(event){const key=event.target.dataset.filter;if(!key)return;state.filters[key]=event.target.value;render();}
  function onVisibility(){if(!document.hidden&&(isActive()||state.discovering))schedulePoll(100);}
  options.root.addEventListener("click",onClick);
  options.root.addEventListener("change",onChange);
  document.addEventListener("visibilitychange",onVisibility);
  return Object.freeze({
    load,render,
    destroy(){state.destroyed=true;clearTimeout(state.pollTimer);options.root.removeEventListener("click",onClick);options.root.removeEventListener("change",onChange);document.removeEventListener("visibilitychange",onVisibility);}
  });
}

global.MedicHallExternalProspects=Object.freeze({createWorkspace});
})(globalThis);
