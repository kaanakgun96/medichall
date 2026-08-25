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
  ["loading_profile","Understanding your selected product intent"],
  ["preparing_market_search","Preparing your European market search"],
  ["searching_procurement","Searching European procurement evidence"],
  ["checking_business_sources","Checking official business sources"],
  ["verifying_websites","Verifying websites and matching product categories"],
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
const EUROPE_COUNTRIES=[
  ["AT","Austria"],["BE","Belgium"],["BG","Bulgaria"],["HR","Croatia"],["CY","Cyprus"],["CZ","Czechia"],
  ["DK","Denmark"],["EE","Estonia"],["FI","Finland"],["FR","France"],["DE","Germany"],["GR","Greece"],
  ["HU","Hungary"],["IE","Ireland"],["IT","Italy"],["LV","Latvia"],["LT","Lithuania"],["LU","Luxembourg"],
  ["MT","Malta"],["NL","Netherlands"],["NO","Norway"],["PL","Poland"],["PT","Portugal"],["RO","Romania"],
  ["SK","Slovakia"],["SI","Slovenia"],["ES","Spain"],["SE","Sweden"],["CH","Switzerland"],["GB","United Kingdom"]
];
const INTENT_LABELS={PROFILE_PRODUCT:"My products",AD_HOC_PRODUCT:"Manual product search",WEBSITE_DETECTED_PRODUCT:"Detected from your website",UNMAPPED_PRODUCT:"Searching as entered product"};

function createWorkspace(options){
  if(!options?.root||typeof options.rpc!=="function"||typeof options.edge!=="function")throw new Error("Buyer Discovery workspace configuration is incomplete.");
  const state={
    data:{runs:[],prospects:[],website_scans:[],product_context:{}},loading:false,discovering:false,scanning:false,openId:null,
    notice:null,pollTimer:null,pollInFlight:false,destroyed:false,lastTerminalRun:null,retryRequired:false,
    initialized:false,mode:null,selectedRunId:null,profileSelected:new Set(),websiteSelected:new Set(),
    countryMode:"europe",selectedCountries:new Set(),adhocQuery:"",adhocResolution:null,
    filters:{query:"",country:"",market:"",type:"",evidence:"",score:"",freshness:"",status:"",sort:"score"}
  };
  const toast=message=>options.toast?.(message);
  const track=event=>options.track?.(event);

  function activeRun(){return list(state.data.runs).find(run=>ACTIVE_STATUSES.has(String(run?.status||"").toUpperCase()))||null;}
  function currentRun(){return activeRun()||list(state.data.runs).find(run=>String(run.id)===String(state.selectedRunId))||list(state.data.runs)[0]||null;}
  function isActive(run=activeRun()){return ACTIVE_STATUSES.has(String(run?.status||"").toUpperCase());}
  function pollingExpired(run=currentRun()){
    if(!isActive(run))return false;
    const started=Date.parse(run.started_at||run.created_at||"");
    return Number.isFinite(started)&&Date.now()-started>POLL_MAX_MS;
  }
  function targetCountries(){
    return state.countryMode==="selected"?[...state.selectedCountries].sort():[];
  }
  function readiness(){
    const products=list(state.data.product_context?.products),website=state.data.product_context?.website_available===true;
    const selection=state.mode==="profile"?state.profileSelected.size:state.mode==="adhoc"?(state.adhocResolution?.confirmed?1:0):state.websiteSelected.size;
    return {
      role:String(options.profile?.role||"manufacturer").toLowerCase()==="manufacturer",
      products,website,selection,
      ready:selection>0&&(state.countryMode!=="selected"||state.selectedCountries.size>0)&&String(options.profile?.role||"manufacturer").toLowerCase()==="manufacturer"
    };
  }

  function hydrate(){
    if(state.initialized)return;
    const context=state.data.product_context||{},products=list(context.products).filter(item=>item.taxonomy_id);
    products.slice(0,8).forEach(item=>state.profileSelected.add(Number(item.taxonomy_id)));
    const saved=[...new Set(list(options.targetCountries).concat(list(options.profile?.target_countries)).map(value=>String(value||"").trim().toUpperCase()).filter(value=>/^[A-Z]{2}$/.test(value)))];
    saved.forEach(value=>state.selectedCountries.add(value));
    state.countryMode=saved.length?"selected":"europe";
    const scan=list(state.data.website_scans).find(item=>["COMPLETED","NO_PRODUCTS"].includes(String(item.status)));
    list(scan?.suggestions).filter(item=>Number.isSafeInteger(Number(item.taxonomy_id))&&item.confidence!=="LOW").forEach(item=>state.websiteSelected.add(Number(item.taxonomy_id)));
    state.mode=products.length?"profile":context.website_available?"website":"adhoc";
    state.selectedRunId=list(state.data.runs)[0]?.id||null;
    state.initialized=true;
  }

  async function load(settings={}){
    if(state.loading||state.destroyed)return;
    state.loading=true;
    if(!settings.silent&&!state.data.prospects.length)options.root.innerHTML='<div class="mhxp"><div class="mhxp-empty"><b>Loading European Buyer Discovery…</b></div></div>';
    try{
      state.data=await options.rpc("get_external_prospect_workspace_v2",{p_company_id:Number(options.companyId),p_limit:200})||{runs:[],prospects:[],website_scans:[],product_context:{}};
      hydrate();
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
    const intentHash=currentRun()?.intent_hash;
    const prospects=list(state.data.prospects).filter(item=>!intentHash||item.intent_hash===intentHash).filter(item=>{
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
  function runContext(run){
    const context=run?.intent_context||{},countries=list(context.target_countries);
    return {
      product:context.normalized_product_label||"your selected products",
      source:INTENT_LABELS[run?.intent_source||context.intent_source]||"Buyer Discovery",
      markets:countries.length?countries.join(" · "):"Europe-wide",
      temporary:context.temporary_intent===true
    };
  }
  function coverageHtml(run){
    const requested=run?list(run.intent_context?.target_countries):targetCountries();
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
    const sourceCount=Number(run.sources_checked||0),found=Number(run.candidates_found||0),accepted=Number(run.candidates_accepted||0),deduped=Number(run.candidates_deduplicated||0),context=runContext(run);
    let outcome="";
    if(status==="PARTIAL")outcome='<div class="mhxp-state partial"><b>Results are ready with limited source coverage.</b><p>Available evidence was ranked normally. One or more public sources could not be reached, so absence of a result is not proof that no buyer exists.</p></div>';
    if(status==="FAILED")outcome='<div class="mhxp-state failed" role="alert"><b>This search could not be completed.</b><p>'+esc(friendlyRunError(run.error_code))+'</p><button type="button" data-action="retry">Retry search</button></div>';
    if(status==="COMPLETED")outcome='<div class="mhxp-state complete"><b>European buyer search complete.</b><p>'+accepted+' evidence-backed candidate'+(accepted===1?"":"s")+' met the current confidence threshold.</p></div>';
    return '<section class="mhxp-progress '+status.toLowerCase()+'" aria-live="polite" aria-label="Buyer Discovery progress"><div class="mhxp-progress-head"><div><span class="mhxp-kicker">'+esc(context.source)+'</span><h4>'+esc(stageName(run.stage,status))+'</h4><p><b>Buyer Discovery for: '+esc(context.product)+'</b> · '+esc(context.markets)+'. '+(context.temporary?'Searching as entered product. ':'Matched category. ')+'Only completed backend work is shown; no estimated percentage is used.</p></div><span class="mhxp-run-state '+status.toLowerCase()+'">'+esc(status)+'</span></div>'+
      (isActive(run)?'<ol class="mhxp-stages">'+steps+'</ol>':"")+
      '<div class="mhxp-counters"><div><strong>'+sourceCount+'</strong><span>public sources checked</span></div><div><strong>'+found+'</strong><span>candidates found</span></div><div><strong>'+deduped+'</strong><span>duplicates removed</span></div><div><strong>'+accepted+'</strong><span>evidence-backed results</span></div></div>'+outcome+coverageHtml(run)+'</section>';
  }

  function components(item){return[
    ["Product & commercial fit",item.product_taxonomy_score,40],["Market fit",item.geography_score,10],["Buyer type",item.company_type_score,15],
    ["Procurement",item.procurement_signal_score,15],["Evidence",item.evidence_quality_score,10],["Recency",item.recency_score,5]
  ].map(row=>'<div class="mhxp-component"><span>'+esc(row[0])+'</span><b>'+Number(row[1]||0)+' / '+row[2]+'</b></div>').join("");}
  function evidenceHtml(item){
    const evidence=list(item.evidence).map(row=>{
      const url=safeUrl(row.source_url),evidenceClass=String(row.relevance_class||"").toUpperCase()||(row.evidence_kind==="DIRECT_PRODUCT_EVIDENCE"?"DIRECT":row.evidence_kind==="INDIRECT_COMMERCIAL_EVIDENCE"?"ADJACENT":"GENERIC");
      const kindLabel=evidenceClass==="DIRECT"?"Direct product evidence":evidenceClass==="ADJACENT"?"Adjacent commercial evidence":"Generic company context";
      return '<article><span class="mhxp-kind '+evidenceClass.toLowerCase()+'">'+kindLabel+'</span><span class="mhxp-source">'+esc(SOURCE_LABELS[row.source_type]||"Public business source")+'</span><b>'+esc(row.source_title||row.source_domain||"Verified public record")+'</b><p>'+esc(row.evidence_snippet||"Public source record")+'</p>'+(url?'<a href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">Open public evidence ↗</a>':"")+'</article>';
    }).join("");
    const activities=list(item.activities).map(row=>'<article class="mhxp-activity"><span class="mhxp-kind indirect">Indirect commercial evidence</span><span class="mhxp-source">Official business activity</span><b>'+esc(row.normalized_activity_class||"Relevant medical trade activity")+'</b><p>'+esc(row.activity_description||"Relevant registered commercial activity")+'</p></article>').join("");
    return evidence+activities||'<article><b>No visible evidence</b><p>This candidate is not presented as a verified result without supporting public evidence.</p></article>';
  }
  function signalCounts(item){
    const rows=list(item.evidence),classOf=row=>String(row.relevance_class||"").toUpperCase()||(row.evidence_kind==="DIRECT_PRODUCT_EVIDENCE"?"DIRECT":row.evidence_kind==="INDIRECT_COMMERCIAL_EVIDENCE"?"ADJACENT":"GENERIC");
    return {direct:rows.filter(row=>classOf(row)==="DIRECT").length,adjacent:rows.filter(row=>classOf(row)==="ADJACENT").length,generic:rows.filter(row=>classOf(row)==="GENERIC").length+list(item.activities).length};
  }
  function card(item){
    const open=Number(state.openId)===Number(item.match_id),website=safeUrl(item.website_url),status=String(item.workflow_status||"NEW"),signals=signalCounts(item);
    const reasons=list(item.reasons),fit=reasons.find(row=>row.code==="COMMERCIAL_FIT")||{},archetype=reasons.find(row=>row.code==="BUYER_ARCHETYPE")||{};
    const freshness={RECENT:"Recently verified",AGING:"Verification aging",STALE:"Recheck recommended"}[item.freshness]||"Verification date unavailable";
    return '<article class="mhxp-card '+(status==="DISMISSED"?"dismissed":"")+'" data-match="'+Number(item.match_id)+'"><div class="mhxp-top"><div><div class="mhxp-badges"><span class="mhxp-badge external">European buyer candidate</span><span class="mhxp-badge">'+esc(fit.confidence||"Evidence-backed")+' confidence</span><span class="mhxp-badge">'+esc(freshness)+'</span></div><h4>'+esc(item.company_name)+'</h4><div class="mhxp-meta">'+esc(archetype.text||label(item.company_type||"Business buyer"))+(item.country_name||item.country_code?' · '+esc(item.country_name||item.country_code):"")+(item.city_region?' · '+esc(item.city_region):"")+'</div></div><div class="mhxp-score" style="--score:'+Number(item.relevance_score||0)+'"><b>'+Number(item.relevance_score||0)+'</b><span>match</span></div></div><p class="mhxp-reason">'+esc(fit.text||item.reason_summary||"Evidence suggests commercial relevance to your product categories.")+'</p><div class="mhxp-signal-summary"><span>'+signals.direct+' direct product signal'+(signals.direct===1?"":"s")+'</span><span>'+signals.adjacent+' adjacent commercial signal'+(signals.adjacent===1?"":"s")+'</span><span>'+signals.generic+' generic context signal'+(signals.generic===1?"":"s")+'</span></div><div class="mhxp-components">'+components(item)+'</div><div class="mhxp-taxonomy">'+list(item.taxonomy).map(row=>'<span>'+esc(row.canonical_name)+'</span>').join("")+'</div><div class="mhxp-card-actions"><button type="button" data-action="detail" data-id="'+Number(item.match_id)+'" aria-expanded="'+String(open)+'">'+(open?"Hide evidence":"View evidence")+'</button>'+(website?'<a class="mhxp-button" data-action="website" data-id="'+Number(item.match_id)+'" href="'+esc(website)+'" target="_blank" rel="noopener noreferrer">Company website ↗</a>':"")+'<button type="button" data-action="feedback" data-state="SAVED" data-id="'+Number(item.match_id)+'">'+(status==="SAVED"?"Saved ✓":"Save")+'</button><button type="button" data-action="feedback" data-state="INTERESTING" data-id="'+Number(item.match_id)+'">Interesting</button><button type="button" data-action="feedback" data-state="DISMISSED" data-id="'+Number(item.match_id)+'">Dismiss</button></div><div class="mhxp-detail" '+(open?"":"hidden")+'><div class="mhxp-section"><h5>Why this company appears</h5><p class="mhxp-evidence-note">Direct evidence supports a product-level statement. Adjacent evidence supports commercial relevance only and never proves the company currently sells your exact product. Generic context cannot qualify a result by itself.</p><div class="mhxp-evidence">'+evidenceHtml(item)+'</div></div><div class="mhxp-section"><h5>Private company note</h5><textarea class="mhxp-note" maxlength="2000" data-note="'+Number(item.match_id)+'" placeholder="Visible only inside your company workspace">'+esc(item.private_note||"")+'</textarea><p class="mhxp-note-help">No outreach is sent. MedicHall stores this note only for your company.</p><button type="button" data-action="note" data-id="'+Number(item.match_id)+'">Save private note</button></div></div></article>';
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
  function profileTaxonomyIds(){return new Set(list(state.data.product_context?.products).map(item=>Number(item.taxonomy_id)).filter(Number.isSafeInteger));}
  function countryHtml(){
    const specific=state.countryMode==="selected";
    return '<fieldset class="mhxp-country"><legend>Where should MedicHall search?</legend><div class="mhxp-country-modes"><label><input type="radio" name="mhxp-country-mode" data-country-mode="europe" '+(!specific?'checked':'')+'> Europe-wide</label><label><input type="radio" name="mhxp-country-mode" data-country-mode="selected" '+(specific?'checked':'')+'> Selected countries</label></div>'+(specific?'<label class="mhxp-country-select">Target countries <select multiple size="6" data-country-select aria-describedby="mhxp-country-help">'+EUROPE_COUNTRIES.map(row=>'<option value="'+row[0]+'" '+(state.selectedCountries.has(row[0])?'selected':'')+'>'+esc(row[1])+'</option>').join("")+'</select></label><p id="mhxp-country-help" class="mhxp-help">Your choice applies only to this search and does not change saved target markets.</p>':'<p class="mhxp-help">Search across Europe. Official registry enrichment varies by country; TED and public-web evidence remain available where supported.</p>')+'</fieldset>';
  }
  function productSuggestionActions(item,source){
    const existing=profileTaxonomyIds().has(Number(item.taxonomy_id));
    return existing?'<span class="mhxp-already">Already in your profile</span>':'<button type="button" data-action="add-profile" data-source="'+esc(source)+'" data-taxonomy="'+Number(item.taxonomy_id)+'" data-name="'+esc(item.canonical_name)+'" data-slug="'+esc(item.slug||"")+'">Add to my profile</button>';
  }
  function profileModeHtml(){
    const products=list(state.data.product_context?.products);
    if(!products.length)return '<div class="mhxp-mode-empty"><b>No catalogue products yet—and that is okay.</b><p>Use Search by product or Scan my website now. You can add products later for ongoing recommendations.</p></div>';
    return '<div class="mhxp-choice-grid">'+products.map(item=>item.taxonomy_id?'<label class="mhxp-choice"><input type="checkbox" data-profile-taxonomy="'+Number(item.taxonomy_id)+'" '+(state.profileSelected.has(Number(item.taxonomy_id))?'checked':'')+'><span><b>'+esc(item.product_name)+'</b><small>'+esc(item.canonical_name)+'</small></span></label>':'<div class="mhxp-choice unavailable"><span><b>'+esc(item.product_name)+'</b><small>Choose a canonical category in My Products before using this item.</small></span></div>').join("")+'</div>';
  }
  function adhocModeHtml(){
    const resolution=state.adhocResolution,recommended=resolution?.recommended,suggestions=list(resolution?.suggestions||resolution?.alternatives);
    let result="";
    if(resolution?.resolution==="unmapped")result='<div class="mhxp-resolution" role="status"><span class="mhxp-kicker">No reliable category yet</span><b>We couldn’t confidently map this product to an existing MedicHall category yet.</b><p>MedicHall will search using the product name you entered and verify potential buyers using public product, procurement and company evidence.</p><div class="mhxp-resolution-actions"><button type="button" class="primary" data-action="search-anyway" '+(resolution.search_anyway_allowed===false?'disabled aria-disabled="true"':'')+'>'+(resolution.confirmed?'Searching as entered product ✓':'Search this product anyway')+'</button><button type="button" data-action="change-product">Try a different product name</button></div></div>';
    else if(resolution?.resolution==="high_confidence"&&recommended){
      const item={taxonomy_id:Number(recommended.canonical_taxonomy_id),canonical_name:recommended.canonical_name,slug:recommended.slug||""};
      result='<div class="mhxp-normalized" role="status"><span class="mhxp-kicker">Product matched</span><b>'+esc(item.canonical_name)+'</b><p>'+esc(recommended.reasoning||"Exact canonical name or approved alias.")+'</p><div><span class="mhxp-already">Ready to search ✓</span>'+productSuggestionActions(item,"AD_HOC_PRODUCT")+'</div></div>';
    }else if(recommended){
      const choices=(suggestions.length?suggestions:[recommended]).slice(0,3);
      result='<div class="mhxp-resolution" role="status"><span class="mhxp-kicker">Possible product categories</span><b>'+(choices.length===1?'We found a likely product category:':'We found a few possible matches:')+'</b><p>Choose the category that best describes your product. MedicHall will not change your product or publish a new global alias.</p><div class="mhxp-suggestion-list" role="list">'+choices.map(item=>'<article role="listitem" class="'+(Number(resolution?.recommended?.canonical_taxonomy_id)===Number(item.canonical_taxonomy_id)?'recommended':'')+'"><div><b>'+esc(item.canonical_name)+'</b><small>'+esc(item.confidence_label||"MEDIUM")+' confidence · '+esc(item.reasoning||"Multiple deterministic product-family signals.")+'</small></div><button type="button" class="primary" data-action="confirm-adhoc" data-taxonomy="'+Number(item.canonical_taxonomy_id)+'" data-name="'+esc(item.canonical_name)+'" data-slug="'+esc(item.slug||"")+'">'+(resolution.confirmed&&Number(recommended.canonical_taxonomy_id)===Number(item.canonical_taxonomy_id)?'Category confirmed ✓':'Use this category')+'</button></article>').join("")+'</div><button type="button" data-action="change-product">Choose another category or product name</button></div>';
    }
    return '<form class="mhxp-product-search" data-product-search><label for="mhxpProductQuery">Medical product or category</label><div><input id="mhxpProductQuery" name="product_query" maxlength="160" value="'+esc(state.adhocQuery)+'" placeholder="Enter a medical product, e.g. Ultrasound Probe Cover" aria-describedby="mhxp-product-help"><button class="primary" type="submit">Match product</button></div><p id="mhxp-product-help" class="mhxp-help">Commercial names and approved aliases are normalized to MedicHall’s existing Medical Product Taxonomy. No paid AI is used.</p></form>'+result;
  }
  function websiteModeHtml(){
    const context=state.data.product_context||{},scan=list(state.data.website_scans)[0];
    if(!context.website_available)return '<div class="mhxp-mode-empty"><b>No validated HTTPS company website is available.</b><p>Update the website through the normal company profile flow, or enter a product manually.</p><button type="button" data-action="mode" data-mode="adhoc">Enter a product manually</button></div>';
    if(state.scanning||["QUEUED","RUNNING"].includes(String(scan?.status||""))){
      const stages={reading_website:"Reading your website",finding_product_pages:"Finding product pages",identifying_products:"Identifying medical products",matching_categories:"Matching product categories",ready:"Ready"};
      return '<div class="mhxp-scan-progress" role="status" aria-live="polite"><span class="mhxp-kicker">'+esc(context.website_domain||"Company website")+'</span><b>'+esc(stages[scan?.stage]||"Reading your website")+'</b><p>Only bounded public pages are checked. No scripts, forms, contacts or private pages are used.</p></div>';
    }
    const suggestions=list(scan?.suggestions),mappedSuggestions=suggestions.filter(item=>Number.isSafeInteger(Number(item.taxonomy_id))),unmappedSuggestions=suggestions.filter(item=>!Number.isSafeInteger(Number(item.taxonomy_id))&&item.resolution==="UNMAPPED");
    if(scan&&["FAILED","ROBOTS_DENIED"].includes(String(scan.status)))return '<div class="mhxp-state neutral"><b>We could not scan your website right now.</b><p>'+ (scan.status==="ROBOTS_DENIED"?'The site’s robots rules do not allow this scan.':'You can still enter a product manually.') +'</p><button type="button" data-action="mode" data-mode="adhoc">Enter a product manually</button></div>';
    if(scan&&scan.status==="NO_PRODUCTS")return '<div class="mhxp-state neutral"><b>No clear product categories were found on your website.</b><p>MedicHall did not fabricate suggestions. Enter a product manually instead.</p><button type="button" data-action="mode" data-mode="adhoc">Enter a product manually</button></div>';
    if(!suggestions.length)return '<div class="mhxp-scan-start"><span class="mhxp-kicker">Stored company domain</span><b>'+esc(context.website_domain)+'</b><p>MedicHall safely checks up to 12 relevant public pages, respects robots rules, maps product signals to the existing taxonomy, and stores no raw page content or contacts.</p><button class="primary" type="button" data-action="scan">Scan my website</button></div>';
    const createdAt=Date.parse(scan.created_at||""),rescanAllowed=!Number.isFinite(createdAt)||Date.now()-createdAt>=86400000;
    return '<div class="mhxp-detected"><div class="mhxp-detected-head"><div><span class="mhxp-kicker">Detected from '+esc(context.website_domain)+'</span><b>Confirm the categories you want to use</b><p>High and medium-confidence mapped suggestions are preselected. Unknown phrases remain unselected until you resolve them.</p></div><button type="button" data-action="scan" data-force="true" '+(rescanAllowed?'':'disabled aria-disabled="true" title="Website rescans are available after the 24-hour safety cooldown"')+'>'+(rescanAllowed?'Rescan website':'Rescan available later')+'</button></div><div class="mhxp-choice-grid">'+mappedSuggestions.map(item=>'<article class="mhxp-detected-card '+String(item.confidence).toLowerCase()+'"><label><input type="checkbox" data-website-taxonomy="'+Number(item.taxonomy_id)+'" '+(state.websiteSelected.has(Number(item.taxonomy_id))?'checked':'')+'><span><b>'+esc(item.canonical_name)+'</b><small>'+esc(item.raw_website_label)+' · '+esc(item.confidence)+' confidence</small></span></label><p>Found on '+list(item.source_pages).length+' public page'+(list(item.source_pages).length===1?'':'s')+'.</p>'+productSuggestionActions(item,"WEBSITE_DETECTED_PRODUCT")+'</article>').join("")+unmappedSuggestions.map(item=>'<article class="mhxp-detected-card unmapped"><span class="mhxp-kicker">Possible product — category not yet mapped</span><b>'+esc(item.raw_website_label)+'</b><p>Found on '+list(item.source_pages).length+' public page'+(list(item.source_pages).length===1?'':'s')+'. Review this phrase before using it.</p><button type="button" data-action="resolve-website-phrase" data-phrase="'+esc(item.raw_website_label)+'">Resolve this product</button></article>').join("")+'</div></div>';
  }
  function recentHtml(){
    const runs=list(state.data.runs).slice(0,8);if(!runs.length)return"";
    return '<details class="mhxp-recent"><summary>Recent buyer searches</summary><div>'+runs.map(run=>{const context=runContext(run);return '<button type="button" data-action="open-run" data-run="'+esc(run.id)+'" class="'+(String(currentRun()?.id)===String(run.id)?'active':'')+'"><b>'+esc(context.product)+'</b><span>'+esc(context.markets)+' · '+esc(context.source)+'</span></button>';}).join("")+'</div></details>';
  }
  function readinessHtml(){
    const ready=readiness(),modeContent=state.mode==="profile"?profileModeHtml():state.mode==="website"?websiteModeHtml():adhocModeHtml();
    const action=state.retryRequired?"retry":"discover",busy=state.discovering,label=busy?"Searching Europe…":state.retryRequired?"Retry search":"Discover European buyers";
    return '<section class="mhxp-setup" aria-labelledby="mhxp-setup-title"><div class="mhxp-setup-copy"><span class="mhxp-kicker">Start with the product you want to grow</span><h4 id="mhxp-setup-title">Find your potential European buyers</h4><p>Choose products from your profile, enter one directly, or detect likely categories from your stored public website. Every mode uses the same evidence-backed discovery engine.</p></div><div class="mhxp-modes" role="group" aria-label="Buyer Discovery mode"><button type="button" data-action="mode" data-mode="profile" aria-pressed="'+String(state.mode==="profile")+'"><b>Use my products</b><span>'+ready.products.length+' active product'+(ready.products.length===1?'':'s')+'</span></button><button type="button" data-action="mode" data-mode="adhoc" aria-pressed="'+String(state.mode==="adhoc")+'"><b>Search by product</b><span>No catalogue required</span></button><button type="button" data-action="mode" data-mode="website" aria-pressed="'+String(state.mode==="website")+'" '+(!ready.website?'aria-describedby="mhxp-website-unavailable"':'')+'><b>Scan my website</b><span id="mhxp-website-unavailable">'+(ready.website?esc(state.data.product_context.website_domain):'Add a valid HTTPS website first')+'</span></button></div><div class="mhxp-mode-panel">'+modeContent+'</div>'+countryHtml()+'<div class="mhxp-launch"><button class="primary" type="button" data-action="'+action+'" '+(!ready.ready||busy?'disabled aria-disabled="true"':'')+'>'+label+'</button><p class="mhxp-help">'+(ready.ready?'Searches are bounded, cached and share company-level rate limits.':'Confirm a category or choose bounded Search anyway for a valid unmapped product.')+'</p></div>'+recentHtml()+coverageHtml(null)+'</section>';
  }
  function friendlyRunError(code){
    const value=String(code||"").toUpperCase();
    if(value.includes("CONTEXT")||value.includes("PROFILE"))return"Your company or product context could not be loaded. Review your profile, then try again.";
    if(value.includes("TAXONOMY"))return"Your structured product categories could not be loaded. Review your products, then try again.";
    return"No saved results were removed. Refresh the status, then retry when ready.";
  }
  function friendlyError(error){
    const value=[error?.userMessage,error?.message,error?.backendMessage,error?.backendCode,error?.code,error?.edgeDetails?.backendMessage,error?.edgeDetails?.code].filter(Boolean).join(" ");
    if(/30 minutes|cooldown/i.test(value))return"A recent search is still within the safety cooldown. Your existing results remain available; try again after 30 minutes.";
    if(/daily/i.test(value))return"Today’s safe search limit has been reached. Existing results remain available; try again tomorrow.";
    if(/monthly/i.test(value))return"This month’s search limit has been reached. Existing results remain available.";
    if(/access denied|42501/i.test(value))return"This company workspace is not available to the current account.";
    return"Buyer Discovery could not be completed. Existing saved results are unchanged; please try again.";
  }
  function render(){
    if(state.destroyed)return;
    const prospects=filtered(),run=currentRun(),intentHash=run?.intent_hash,all=list(state.data.prospects).filter(item=>!intentHash||item.intent_hash===intentHash);
    const header='<div class="mhxp-head"><div><span class="mhxp-kicker">European market development</span><h3>European Buyer Discovery</h3><p>Find evidence-backed distributors, importers, wholesalers and institutional buyers beyond the current MedicHall member network.</p></div><div class="mhxp-actions"><button type="button" data-action="reload">Refresh results</button></div></div>';
    const privacy='<div class="mhxp-notice"><b>Public business evidence only.</b> No private contact details are collected, no outreach is sent, and broad activity codes are never presented as proof of exact product availability.</div>';
    const notice=state.notice?'<div class="mhxp-state '+esc(state.notice.tone||"neutral")+'" role="status"><b>'+esc(state.notice.title)+'</b><p>'+esc(state.notice.message)+'</p></div>':"";
    const results=all.length?'<section class="mhxp-results"><div class="mhxp-results-head"><div><span class="mhxp-kicker">Ranked candidates</span><h4>'+all.length+' buyer candidate'+(all.length===1?"":"s")+'</h4><p>Each result passed the configured direct-or-multiple-independent-signal confidence gate for this product intent.</p></div></div>'+filtersHtml()+(prospects.length?'<div class="mhxp-list">'+prospects.map(card).join("")+'</div>':'<div class="mhxp-empty"><b>No buyers match these filters.</b><p>Clear or change a filter to see more saved results.</p></div>')+'</section>':(run&&!statusAllowsEmpty(run)?'<div class="mhxp-empty"><b>No candidates met the evidence threshold for this product intent.</b><p>The search completed normally. Weak single-source matches are intentionally excluded.</p></div>':'');
    options.root.innerHTML='<div class="mhxp">'+header+privacy+notice+readinessHtml()+runHtml(run)+results+'</div>';
    options.root.querySelectorAll(".mhxp-card .mhxp-badges").forEach(badges=>{
      const membership=document.createElement("span");membership.className="mhxp-badge";membership.textContent="Not yet a MedicHall member";
      badges.firstElementChild?.after(membership);
    });
  }
  function statusAllowsEmpty(run){return !run||ACTIVE_STATUSES.has(String(run.status||"").toUpperCase())||String(run.status||"").toUpperCase()==="FAILED";}

  async function discover(explicitRetry=false){
    if(state.discovering||isActive()){
      state.notice={tone:"neutral",title:"A search is already running.",message:"Progress will update here automatically. Starting the same search again would not create a second request."};
      render();syncPolling();return;
    }
    if(state.retryRequired&&!explicitRetry)return;
    const ready=readiness();
    if(!ready.ready){state.notice={tone:"neutral",title:"Confirm or resolve a product first.",message:"Choose a profile product, confirm a suggested category, select a website-detected category, or use bounded Search anyway for a valid unmapped medical product."};render();return;}
    const unmapped=state.mode==="adhoc"&&state.adhocResolution?.useUnmapped===true;
    const taxonomyIds=state.mode==="profile"?[...state.profileSelected]:state.mode==="website"?[...state.websiteSelected]:unmapped?[]:[Number(state.adhocResolution?.recommended?.canonical_taxonomy_id)].filter(Number.isSafeInteger);
    const intentSource=state.mode==="profile"?"PROFILE_PRODUCT":state.mode==="website"?"WEBSITE_DETECTED_PRODUCT":unmapped?"UNMAPPED_PRODUCT":"AD_HOC_PRODUCT";
    state.discovering=true;state.notice=null;render();track("external_prospect_discovery_started");
    const intent={intent_source:intentSource,taxonomy_ids:taxonomyIds.slice(0,8),target_countries:targetCountries()};
    if(state.mode==="adhoc"&&state.adhocResolution?.resolution_event_id)intent.resolution_event_id=state.adhocResolution.resolution_event_id;
    if(unmapped)intent.normalized_product_phrase=state.adhocResolution.normalized_source_text;
    const request=options.edge("external-prospect-discovery",{operation:"discover",company_id:Number(options.companyId),idempotency_key:uuid(),intent});
    schedulePoll(700);
    try{
      const result=await request;
      await load({silent:true});
      state.selectedRunId=result?.run?.run_id||list(state.data.runs)[0]?.id||state.selectedRunId;
      state.retryRequired=false;
      state.notice={tone:"complete",title:result?.cached?"Existing results restored.":"Buyer search finished.",message:result?.cached?"MedicHall reused the matching cached search safely.":"The latest evidence-backed results are ready to review."};
      toast(result?.cached?"Existing Buyer Discovery results loaded.":"European Buyer Discovery completed.");
    }catch(error){
      await load({silent:true});
      state.retryRequired=true;
      state.notice={tone:"failed",title:"Search not started or interrupted.",message:friendlyError(error)};
      toast(friendlyError(error));
    }finally{state.discovering=false;render();syncPolling();}
  }
  function scheduleScanPoll(){
    clearTimeout(state.scanPollTimer);
    if(!state.scanning||state.destroyed)return;
    state.scanPollTimer=setTimeout(async()=>{await load({silent:true});scheduleScanPoll();},1400);
  }
  async function resolveAdhoc(){
    const query=state.adhocQuery.trim();
    if(query.length<3){state.notice={tone:"neutral",title:"Enter a specific medical product.",message:"Use at least three characters and describe a product or medical category."};render();return;}
    state.notice=null;state.adhocResolution=null;render();
    try{
      const result=await options.edge("external-prospect-discovery",{operation:"resolve_product_intent",company_id:Number(options.companyId),idempotency_key:uuid(),product_query:query});
      state.adhocResolution={...result,confirmed:result?.resolution==="high_confidence",useUnmapped:false};
    }catch(error){state.notice={tone:"failed",title:"This product could not be matched.",message:friendlyError(error)};}
    render();
  }
  async function scanWebsite(force=false){
    if(state.scanning)return;
    state.scanning=true;state.notice=null;render();scheduleScanPoll();
    try{
      const result=await options.edge("external-prospect-discovery",{operation:"scan_company_products",company_id:Number(options.companyId),idempotency_key:uuid(),force_rescan:force===true});
      await load({silent:true});
      state.websiteSelected.clear();
      list(result?.scan?.suggestions).filter(item=>Number.isSafeInteger(Number(item.taxonomy_id))&&item.confidence!=="LOW").forEach(item=>state.websiteSelected.add(Number(item.taxonomy_id)));
      if(result?.scan?.status==="NO_PRODUCTS")state.notice={tone:"neutral",title:"No clear product categories were found.",message:"MedicHall did not fabricate suggestions. Enter a product manually instead."};
      else if(result?.scan?.status==="ROBOTS_DENIED")state.notice={tone:"neutral",title:"Website scan is not permitted by the site.",message:"You can enter a product manually and continue immediately."};
      else state.notice={tone:"complete",title:result?.cached?"Saved website suggestions restored.":"Website product suggestions are ready.",message:"Review and confirm the categories before starting Buyer Discovery."};
    }catch(error){state.notice={tone:"failed",title:"We could not scan your website right now.",message:"Enter a product manually to continue. "+friendlyError(error)};}
    finally{state.scanning=false;clearTimeout(state.scanPollTimer);render();}
  }
  function addToProfile(target){
    const suggestion={taxonomy_id:Number(target.dataset.taxonomy),canonical_name:String(target.dataset.name||""),slug:String(target.dataset.slug||""),source:String(target.dataset.source||"")};
    if(!Number.isSafeInteger(suggestion.taxonomy_id)||!suggestion.canonical_name)return;
    if(typeof options.openProductDraft==="function"){options.openProductDraft(suggestion);return;}
    try{sessionStorage.setItem("mh_buyer_discovery_product_draft_v1",JSON.stringify(suggestion));}catch(_){}
    global.location.href=options.productProfileUrl||"portal.html#products";
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
    else if(action==="retry")discover(true);
    else if(action==="reload")load();
    else if(action==="mode"){state.mode=target.dataset.mode;state.notice=null;state.retryRequired=false;render();}
    else if(action==="confirm-adhoc"){
      state.retryRequired=false;
      if(state.adhocResolution)state.adhocResolution={...state.adhocResolution,confirmed:true,useUnmapped:false,recommended:{...(state.adhocResolution.recommended||{}),canonical_taxonomy_id:Number(target.dataset.taxonomy),canonical_name:target.dataset.name,slug:target.dataset.slug||""}};
      render();
    }
    else if(action==="search-anyway"){
      state.retryRequired=false;
      if(state.adhocResolution)state.adhocResolution={...state.adhocResolution,confirmed:true,useUnmapped:true};
      render();
    }
    else if(action==="change-product"){
      state.adhocResolution=null;state.retryRequired=false;render();options.root.querySelector("#mhxpProductQuery")?.focus();
    }
    else if(action==="resolve-website-phrase"){
      state.mode="adhoc";state.adhocQuery=String(target.dataset.phrase||"").slice(0,160);state.adhocResolution=null;state.notice=null;render();resolveAdhoc();
    }
    else if(action==="scan")scanWebsite(target.dataset.force==="true");
    else if(action==="add-profile")addToProfile(target);
    else if(action==="open-run"){state.selectedRunId=target.dataset.run;state.openId=null;render();}
    else if(action==="detail"){state.openId=state.openId===id?null:id;if(state.openId)track("external_prospect_viewed");render();}
    else if(action==="feedback")feedback(id,target.dataset.state,null);
    else if(action==="note"){const note=options.root.querySelector('[data-note="'+id+'"]')?.value||"";feedback(id,"NOTE_ONLY",note);}
    else if(action==="website")track("external_prospect_website_clicked");
  }
  function onChange(event){
    if(event.target.id==="mhxpProductQuery"){state.adhocResolution=null;state.retryRequired=false;render();return;}
    const key=event.target.dataset.filter;if(key){state.filters[key]=event.target.value;render();return;}
    if(event.target.dataset.profileTaxonomy){const id=Number(event.target.dataset.profileTaxonomy);event.target.checked?state.profileSelected.add(id):state.profileSelected.delete(id);state.retryRequired=false;render();return;}
    if(event.target.dataset.websiteTaxonomy){const id=Number(event.target.dataset.websiteTaxonomy);event.target.checked?state.websiteSelected.add(id):state.websiteSelected.delete(id);state.retryRequired=false;render();return;}
    if(event.target.dataset.countryMode){state.countryMode=event.target.dataset.countryMode;state.retryRequired=false;render();return;}
    if(event.target.dataset.countrySelect!==undefined){state.selectedCountries=new Set([...event.target.selectedOptions].map(option=>option.value));state.retryRequired=false;render();}
  }
  function onInput(event){if(event.target.id==="mhxpProductQuery")state.adhocQuery=event.target.value;}
  function onSubmit(event){if(event.target.matches("[data-product-search]")){event.preventDefault();resolveAdhoc();}}
  function onVisibility(){if(!document.hidden&&(isActive()||state.discovering))schedulePoll(100);}
  options.root.addEventListener("click",onClick);
  options.root.addEventListener("change",onChange);
  options.root.addEventListener("input",onInput);
  options.root.addEventListener("submit",onSubmit);
  document.addEventListener("visibilitychange",onVisibility);
  return Object.freeze({
    load,render,
    destroy(){state.destroyed=true;clearTimeout(state.pollTimer);clearTimeout(state.scanPollTimer);options.root.removeEventListener("click",onClick);options.root.removeEventListener("change",onChange);options.root.removeEventListener("input",onInput);options.root.removeEventListener("submit",onSubmit);document.removeEventListener("visibilitychange",onVisibility);}
  });
}

global.MedicHallExternalProspects=Object.freeze({createWorkspace});
})(globalThis);
