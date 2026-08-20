(function(global){
"use strict";
if(global.MedicHallExternalProspects)return;

const esc=value=>String(value??"").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
const list=value=>Array.isArray(value)?value:[];
const uuid=()=>global.crypto.randomUUID();
const safeUrl=value=>{try{const url=new URL(String(value||""));return url.protocol==="https:"&&!url.username&&!url.password?url.href:null;}catch(_){return null;}};
const label=value=>String(value||"").toLowerCase().replace(/(^|[_\s])\w/g,text=>text.toUpperCase()).replace(/_/g," ");

function createWorkspace(options){
  if(!options?.root||typeof options.rpc!=="function"||typeof options.edge!=="function")throw new Error("External prospect workspace configuration is incomplete.");
  const state={data:{runs:[],prospects:[]},loading:false,discovering:false,openId:null,filters:{query:"",country:"",market:"",type:"",evidence:"",score:"",freshness:"",status:"",sort:"score"}};
  const toast=message=>options.toast?.(message);
  const track=event=>options.track?.(event);

  async function load(){
    if(state.loading)return;
    state.loading=true;
    if(!state.data.prospects.length)options.root.innerHTML='<div class="mhxp"><div class="mhxp-empty"><b>Loading external prospects…</b></div></div>';
    try{state.data=await options.rpc("get_external_prospect_workspace_v1",{p_company_id:Number(options.companyId),p_limit:200})||{runs:[],prospects:[]};render();}
    catch(error){options.root.innerHTML='<div class="mhxp"><div class="mhxp-error"><b>External prospects are unavailable.</b><br>'+esc(error?.userMessage||error?.message||"Please try again.")+'</div></div>';}
    finally{state.loading=false;}
  }

  function currentRun(){return list(state.data.runs)[0]||null;}
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
  function runHtml(run){
    if(!run)return"";
    const status=String(run.status||"").toLowerCase();
    return '<div class="mhxp-run"><div><b>Latest discovery · '+esc(label(run.stage||run.status))+'</b><p>'+Number(run.candidates_accepted||0)+' accepted · '+Number(run.sources_checked||0)+' public sources checked · '+Number(run.provider_requests||0)+' paid provider requests</p></div><span class="mhxp-run-state '+esc(status)+'">'+esc(run.status)+'</span></div>';
  }
  function components(item){return[
    ["Product / taxonomy",item.product_taxonomy_score,40],["Geography",item.geography_score,15],["Company type",item.company_type_score,15],
    ["Procurement",item.procurement_signal_score,15],["Evidence",item.evidence_quality_score,10],["Recency",item.recency_score,5]
  ].map(row=>'<div class="mhxp-component"><span>'+esc(row[0])+'</span><b>'+Number(row[1]||0)+' / '+row[2]+'</b></div>').join("");}
  function evidenceHtml(item){
    const evidence=list(item.evidence).map(row=>{const url=safeUrl(row.source_url),kind=row.evidence_kind||"INDIRECT_COMMERCIAL_EVIDENCE";return '<article><span class="mhxp-kind">'+esc(label(kind))+'</span><span class="mhxp-source">'+esc(label(row.source_type))+'</span><b>'+esc(row.source_title||row.source_domain)+'</b><p>'+esc(row.evidence_snippet||"Public source record")+'</p>'+(url?'<a href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">Open public evidence ↗</a>':"")+'</article>';}).join("");
    const activities=list(item.activities).map(row=>'<article class="mhxp-activity"><span class="mhxp-kind">INDIRECT COMMERCIAL EVIDENCE</span><b>'+esc(row.national_activity_code)+' · '+esc(row.normalized_activity_class)+'</b><p>'+esc(row.activity_description)+' · '+esc(row.provider_code)+'</p></article>').join("");
    return evidence+activities||'<article><b>No visible evidence</b></article>';
  }
  function card(item){
    const open=Number(state.openId)===Number(item.match_id),website=safeUrl(item.website_url),status=String(item.workflow_status||"NEW");
    return '<article class="mhxp-card '+(status==="DISMISSED"?"dismissed":"")+'" data-match="'+Number(item.match_id)+'"><div class="mhxp-top"><div><div class="mhxp-badges"><span class="mhxp-badge external">External prospect</span><span class="mhxp-badge">Not yet on MedicHall</span><span class="mhxp-badge">'+esc(item.freshness||"Unknown freshness")+'</span></div><h4>'+esc(item.company_name)+'</h4><div class="mhxp-meta">'+esc(item.company_type||"Unknown type")+(item.country_name||item.country_code?' · '+esc(item.country_name||item.country_code):"")+(item.city_region?' · '+esc(item.city_region):"")+'</div></div><div class="mhxp-score" style="--score:'+Number(item.relevance_score||0)+'"><b>'+Number(item.relevance_score||0)+'</b></div></div><p class="mhxp-reason">'+esc(item.reason_summary)+'</p><div class="mhxp-components">'+components(item)+'</div><div class="mhxp-taxonomy">'+list(item.taxonomy).map(row=>'<span>'+esc(row.canonical_name)+'</span>').join("")+'</div><div class="mhxp-card-actions"><button type="button" data-action="detail" data-id="'+Number(item.match_id)+'" aria-expanded="'+String(open)+'">'+(open?"Hide details":"View evidence")+'</button>'+(website?'<a class="mhxp-button" data-action="website" data-id="'+Number(item.match_id)+'" href="'+esc(website)+'" target="_blank" rel="noopener noreferrer">Website ↗</a>':"")+'<button type="button" data-action="feedback" data-state="SAVED" data-id="'+Number(item.match_id)+'">'+(status==="SAVED"?"Saved ✓":"Save")+'</button><button type="button" data-action="feedback" data-state="INTERESTING" data-id="'+Number(item.match_id)+'">Interesting</button><button type="button" data-action="feedback" data-state="DISMISSED" data-id="'+Number(item.match_id)+'">Dismiss</button></div><div class="mhxp-detail" '+(open?"":"hidden")+'><div class="mhxp-section"><h5>Evidence and provenance</h5><div class="mhxp-evidence">'+evidenceHtml(item)+'</div></div><div class="mhxp-section"><h5>Private company note</h5><textarea class="mhxp-note" maxlength="2000" data-note="'+Number(item.match_id)+'" placeholder="Visible only inside your company workspace">'+esc(item.private_note||"")+'</textarea><p class="mhxp-note-help">No outreach is sent. MedicHall stores this note only for your company.</p><button type="button" data-action="note" data-id="'+Number(item.match_id)+'">Save private note</button></div></div></article>';
  }
  function selectOptions(values,current){return values.map(value=>'<option '+(current===value?'selected':'')+' value="'+esc(value)+'">'+esc(label(value))+'</option>').join("");}
  function filtersHtml(){
    return '<div class="mhxp-filters"><div class="mhxp-search"><label>Search</label><input data-filter="query" value="'+esc(state.filters.query)+'" placeholder="Company, taxonomy or reason"></div>'+[
      '<div><label>Country</label><select data-filter="country"><option value="">All countries</option>'+selectOptions(filterOptions("country_code"),state.filters.country)+'</select></div>',
      '<div><label>Market</label><select data-filter="market"><option value="">All markets</option><option value="target" '+(state.filters.market?'selected':'')+'>Target markets</option></select></div>',
      '<div><label>Company type</label><select data-filter="type"><option value="">All types</option>'+selectOptions(filterOptions("company_type"),state.filters.type)+'</select></div>',
      '<div><label>Minimum score</label><select data-filter="score"><option value="">Any score</option>'+selectOptions(["75","55"],state.filters.score)+'</select></div>',
      '<div><label>Evidence</label><select data-filter="evidence"><option value="">All evidence</option>'+selectOptions(["COMPANY_WEBSITE","PRODUCT_CATALOGUE","TED_AWARD","ASSOCIATION_DIRECTORY","EXHIBITOR_DIRECTORY","PUBLIC_REGISTRY","OTHER_PUBLIC_SOURCE"],state.filters.evidence)+'</select></div>',
      '<div><label>Freshness</label><select data-filter="freshness"><option value="">Any age</option>'+selectOptions(["RECENT","AGING","STALE"],state.filters.freshness)+'</select></div>',
      '<div><label>Workflow</label><select data-filter="status"><option value="">All states</option>'+selectOptions(["NEW","SAVED","INTERESTING","DISMISSED"],state.filters.status)+'</select></div>',
      '<div><label>Sort</label><select data-filter="sort"><option value="score" '+(state.filters.sort==="score"?'selected':'')+'>Highest score</option><option value="recent" '+(state.filters.sort==="recent"?'selected':'')+'>Most recent</option><option value="procurement" '+(state.filters.sort==="procurement"?'selected':'')+'>Procurement signal</option><option value="country" '+(state.filters.sort==="country"?'selected':'')+'>Country</option><option value="name" '+(state.filters.sort==="name"?'selected':'')+'>Company A–Z</option></select></div>'
    ].join("")+'</div>';
  }
  function render(){
    const prospects=filtered(),all=list(state.data.prospects),run=currentRun();
    options.root.innerHTML='<div class="mhxp"><div class="mhxp-head"><div><h3>External Prospects</h3><p>Discover evidence-backed European distributors, importers, wholesalers and buyers that are not yet MedicHall members.</p></div><div class="mhxp-actions"><button class="primary" type="button" data-action="discover" '+(state.discovering?'disabled':'')+'>'+(state.discovering?'Checking public sources…':'Discover prospects')+'</button><button type="button" data-action="reload">Refresh view</button></div></div><div class="mhxp-notice"><b>Public evidence, no outreach.</b> Results may combine direct product evidence with clearly labelled indirect commercial signals from procurement and official registries. A registry activity code never proves exact product availability.</div>'+runHtml(run)+(all.length?filtersHtml():"")+(prospects.length?'<div class="mhxp-list">'+prospects.map(card).join("")+'</div>':'<div class="mhxp-empty"><b>'+(all.length?'No prospects match these filters.':'No external prospects discovered yet.')+'</b><p>'+(all.length?'Clear a filter to see more results.':'Discovery runs only when you choose it. MedicHall checks bounded public sources and caches identical requests.')+'</p>'+(all.length?'':'<button class="primary" type="button" data-action="discover">Discover prospects</button>')+'</div>')+'</div>';
  }

  async function discover(button){
    if(state.discovering)return;
    state.discovering=true;render();track("external_prospect_discovery_started");
    try{const result=await options.edge("external-prospect-discovery",{company_id:Number(options.companyId),idempotency_key:uuid()});await load();track("external_prospect_discovery_completed");toast(result?.cached?"Existing discovery results loaded.":"External prospect discovery completed.");}
    catch(error){toast(error?.userMessage||error?.message||"Prospect discovery failed.");}
    finally{state.discovering=false;render();if(button)button.disabled=false;}
  }
  async function feedback(id,feedbackState,note){
    try{await options.rpc("set_external_prospect_feedback_v1",{p_match_id:Number(id),p_feedback_state:feedbackState,p_private_note:note??null,p_idempotency_key:uuid()});
      if(feedbackState==="SAVED"||feedbackState==="INTERESTING")track("external_prospect_saved");if(feedbackState==="DISMISSED")track("external_prospect_dismissed");await load();toast(feedbackState==="DISMISSED"?"Prospect dismissed.":"Prospect updated.");}
    catch(error){toast(error?.userMessage||error?.message||"Prospect update failed.");}
  }
  function onClick(event){
    const target=event.target.closest("[data-action]");if(!target||!options.root.contains(target))return;
    const action=target.dataset.action,id=Number(target.dataset.id);
    if(action==="discover")discover(target);else if(action==="reload")load();else if(action==="detail"){state.openId=state.openId===id?null:id;if(state.openId)track("external_prospect_viewed");render();}
    else if(action==="feedback")feedback(id,target.dataset.state,null);else if(action==="note"){const note=options.root.querySelector('[data-note="'+id+'"]')?.value||"";feedback(id,"NOTE_ONLY",note);}
    else if(action==="website")track("external_prospect_website_clicked");
  }
  function onChange(event){const key=event.target.dataset.filter;if(!key)return;state.filters[key]=event.target.value;render();}
  options.root.addEventListener("click",onClick);options.root.addEventListener("change",onChange);
  return Object.freeze({load,render,destroy(){options.root.removeEventListener("click",onClick);options.root.removeEventListener("change",onChange);}});
}

global.MedicHallExternalProspects=Object.freeze({createWorkspace});
})(globalThis);
