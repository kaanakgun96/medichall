(function(){
"use strict";

const SUPABASE_URL="https://azdmuarzntzqdyirysux.supabase.co";
const SUPABASE_ANON_KEY="sb_publishable_RaV2ekM6rJTfdfBFUYIbVA_XSJBZ3Z-";
const AUTH_SESSION=globalThis.MedicHallSession.configure({url:SUPABASE_URL,key:SUPABASE_ANON_KEY});
const UI=globalThis.MedicHallUI;
const utils=globalThis.MedicHallMatchmakingDomain;
let TOKEN=AUTH_SESSION.accessToken();
let USER=null,COMPANY=null,BUYER=null;
let state={
  data:null,detail:null,view:"matches",filters:{q:"",role:"",country:"",min:"0"},
  loading:false,loaded:false,workspaceTimer:null,detailTimer:null,handledHash:null,
  scheduler:{mode:"propose",connectionId:null,meetingId:null,slots:[],step:"pick"},
  notifications:{data:{notifications:[],unread_count:0,action_required_count:0,badge_count:0},filter:"all",loading:false,timer:null},
  modalFocus:[]
};

const esc=value=>String(value??"").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
const uuid=()=>crypto.randomUUID();
const timezone=()=>Intl.DateTimeFormat().resolvedOptions().timeZone||"UTC";

function toast(message){
  const element=document.getElementById("toast");
  element.textContent=message;element.style.display="block";
  clearTimeout(globalThis.__mmToast);globalThis.__mmToast=setTimeout(()=>element.style.display="none",3600);
}

function parseError(error){
  if(error?.userMessage)return String(error.userMessage).slice(0,240);
  return UI.safeError("matchmaking.workspace",error,"The matchmaking request failed. Please try again.");
}

async function request(path,options={}){
  const response=await AUTH_SESSION.request(path,{
    ...options,
    headers:{
      "Content-Type":"application/json",
      ...(options.headers||{})
    }
  });
  TOKEN=AUTH_SESSION.accessToken();
  const text=await response.text();
  let data=null;
  try{data=text?JSON.parse(text):null;}catch(_){data=text;}
  if(!response.ok){
    const error=UI.httpError(response,data);
    if(response.status===401)error.code="AUTH_SESSION_EXPIRED";
    throw error;
  }
  return data;
}

const db=(path,options={})=>request("/rest/v1/"+path,options);
const rpc=(name,body={})=>db("rpc/"+name,{method:"POST",body:JSON.stringify(body)});
const videoRequest=(action,meetingId)=>request("/functions/v1/meeting-video",{method:"POST",body:JSON.stringify({action,meeting_id:Number(meetingId)})});

function setBusy(button,busy,label){
  if(!button)return;
  if(busy){button.dataset.label=button.textContent;button.disabled=true;button.textContent=label||"Working…";}
  else{button.disabled=false;button.textContent=button.dataset.label||button.textContent;}
}

function openModal(id,preferredFocus){
  const modal=document.getElementById(id);
  if(!modal)return;
  if(!modal.classList.contains("open"))state.modalFocus.push({id,returnTo:document.activeElement instanceof HTMLElement?document.activeElement:null});
  modal.classList.add("open");
  setTimeout(()=>{
    const target=(preferredFocus&&modal.querySelector(preferredFocus))||modal.querySelector("button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href]");
    if(target instanceof HTMLElement)target.focus();
  },0);
}

function closeModal(id){
  const modal=document.getElementById(id);
  if(modal)modal.classList.remove("open");
  const index=state.modalFocus.map(item=>item.id).lastIndexOf(id);
  const focus=index>=0?state.modalFocus.splice(index,1)[0]:null;
  setTimeout(()=>{if(focus?.returnTo instanceof HTMLElement&&document.contains(focus.returnTo))focus.returnTo.focus();},0);
}

function topModal(){
  for(let index=state.modalFocus.length-1;index>=0;index--){
    const modal=document.getElementById(state.modalFocus[index].id);
    if(modal?.classList.contains("open"))return modal;
  }
  return null;
}

function trapFocus(event){
  if(event.key!=="Tab")return;
  const modal=topModal();
  if(!modal)return;
  const focusable=[...modal.querySelectorAll("a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),iframe")]
    .filter(item=>item instanceof HTMLElement&&item.offsetParent!==null);
  if(!focusable.length){event.preventDefault();return;}
  const first=focusable[0],last=focusable.at(-1);
  if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
  else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
}

function companyInitials(profile){
  return String(profile?.display_name||"MH").split(/\s+/).slice(0,2).map(word=>word[0]).join("").toUpperCase();
}

function logo(profile){
  const url=utils.safeHttpUrl(profile?.logo_url);
  return '<span class="company-logo">'+(url?'<img src="'+esc(url)+'" alt="">':esc(companyInitials(profile)))+'</span>';
}

function metric(label,value){
  return '<div class="metric"><small>'+esc(label)+'</small><strong>'+Number(value||0)+'</strong></div>';
}

function tab(view,label,count){
  return '<button class="workspace-tab '+(state.view===view?"active":"")+'" onclick="showView(\''+view+'\')">'+esc(label)+(count?'<span class="tab-count"> · '+Number(count)+'</span>':"")+'</button>';
}

function updateHeader(){
  const profile=state.data?.profile;
  document.getElementById("heroRole").textContent=profile?utils.statusLabel(profile.role)+" · "+(profile.display_name||"Profile"):"Profile incomplete";
  document.getElementById("profileTrigger").textContent=(profile?.display_name||USER?.email||"Account")+" ▾";
}

function renderTabs(){
  const data=state.data;
  if(!data)return;
  const profile=data.profile;
  const groups=utils.categorizeMeetings(data.meetings);
  const pendingConnections=utils.array(data.connections).filter(item=>item.status==="pending").length;
  document.getElementById("workspaceTabs").innerHTML=
    tab("matches","Discover Matches",utils.array(data.matches).length)+
    tab("requests","Requests",groups.requests.length+pendingConnections)+
    tab("connections","Connections",utils.array(data.connections).length)+
    tab("upcoming","Upcoming Meetings",groups.upcoming.length)+
    tab("past","Past Meetings",groups.past.length)+
    tab("profile","Match Profile",profile?0:null);
}

function showView(view){
  state.view=view;
  renderTabs();renderWorkspace();
}

function renderWorkspace(){
  const root=document.getElementById("workspaceRoot"),data=state.data;
  if(!root||!data)return;
  const profile=data.profile;
  if(!profile||state.view==="profile"){root.innerHTML=profileForm(profile);return;}
  if(state.view==="requests"){root.innerHTML=requestsView();return;}
  if(state.view==="connections"){root.innerHTML=connectionsView();return;}
  if(state.view==="upcoming"){root.innerHTML=meetingsView("upcoming");return;}
  if(state.view==="past"){root.innerHTML=meetingsView("past");return;}
  root.innerHTML=matchesView();
}

function profileForm(profile){
  const own=profile||{};
  const defaults={
    role:COMPANY?"manufacturer":"buyer",
    display_name:COMPANY?.name||BUYER?.company_name||BUYER?.full_name||"",
    country:COMPANY?.country||BUYER?.country||"",
    website:COMPANY?.website||"",description:COMPANY?.description||"",
    certifications:COMPANY?.certifications||[]
  };
  const value=key=>{
    const result=own[key]!=null?own[key]:defaults[key];
    return Array.isArray(result)?result.join(", "):result||"";
  };
  return '<section class="card pad"><div class="panel-head"><div><h2>'+(profile?"Your two-sided match profile":"Set up partner matchmaking")+'</h2><p class="sub">This structured profile powers the recommendations and explanations in this dedicated workspace.</p></div></div>'+
    '<div class="grid3"><div><label for="pRole">Business role</label><select id="pRole"><option value="manufacturer" '+(value("role")==="manufacturer"?"selected":"")+'>Manufacturer</option><option value="distributor" '+(value("role")==="distributor"?"selected":"")+'>Distributor</option><option value="buyer" '+(value("role")==="buyer"?"selected":"")+'>Buyer / Procurement</option></select></div><div><label for="pName">Display name *</label><input id="pName" maxlength="160" value="'+esc(value("display_name"))+'"></div><div><label for="pCountry">Country</label><input id="pCountry" value="'+esc(value("country"))+'"></div></div>'+
    '<div class="grid2"><div><label for="pWebsite">Website</label><input id="pWebsite" value="'+esc(value("website"))+'" placeholder="https://"></div><div><label for="pSize">Company size</label><input id="pSize" value="'+esc(value("company_size"))+'"></div></div>'+
    '<label for="pDescription">Company and partnership summary</label><textarea id="pDescription" rows="3">'+esc(value("description"))+'</textarea>'+
    '<div class="grid2"><div><label for="pOffered">Products offered</label><textarea id="pOffered" rows="3">'+esc(value("offered_products"))+'</textarea></div><div><label for="pInterested">Products sought</label><textarea id="pInterested" rows="3">'+esc(value("interested_products"))+'</textarea></div>'+
    '<div><label for="pCategories">Product categories</label><input id="pCategories" value="'+esc(value("product_categories"))+'"></div><div><label for="pPartners">Partner types sought</label><input id="pPartners" value="'+esc(value("partner_types_sought")||(COMPANY?"distributor, buyer":"manufacturer, distributor"))+'"></div>'+
    '<div><label for="pTarget">Target countries</label><input id="pTarget" value="'+esc(value("target_countries"))+'"></div><div><label for="pServed">Countries served</label><input id="pServed" value="'+esc(value("served_countries"))+'"></div>'+
    '<div><label for="pCerts">Certifications held</label><input id="pCerts" value="'+esc(value("certifications"))+'"></div><div><label for="pRequired">Required certifications</label><input id="pRequired" value="'+esc(value("required_certifications"))+'"></div>'+
    '<div><label for="pChannels">Sales channels</label><input id="pChannels" value="'+esc(value("sales_channels"))+'"></div></div>'+
    '<div class="actions"><button class="btn btn-ghost" onclick="showView(\'matches\')">Cancel</button><button class="btn btn-primary" id="profileSave" onclick="saveProfile()">Save match profile</button></div></section>';
}

function profileCompleteness(payload){
  const values=[payload.display_name,payload.country,payload.description,payload.offered_products.length||payload.interested_products.length,payload.product_categories.length,payload.partner_types_sought.length,payload.target_countries.length||payload.served_countries.length,payload.sales_channels.length,payload.certifications.length||payload.required_certifications.length];
  return Math.round(values.filter(Boolean).length/values.length*100);
}

async function saveProfile(){
  const button=document.getElementById("profileSave"),get=id=>(document.getElementById(id).value||"").trim();
  const payload={
    user_id:USER.id,company_id:COMPANY?.id||null,role:get("pRole"),display_name:get("pName"),
    country:get("pCountry")||null,website:utils.safeHttpUrl(get("pWebsite")),description:get("pDescription")||null,
    company_size:get("pSize")||null,offered_products:utils.csv(get("pOffered")),interested_products:utils.csv(get("pInterested")),
    product_categories:utils.csv(get("pCategories")),partner_types_sought:utils.csv(get("pPartners")).map(item=>item.toLowerCase()),
    target_countries:utils.csv(get("pTarget")),served_countries:utils.csv(get("pServed")),certifications:utils.csv(get("pCerts")),
    required_certifications:utils.csv(get("pRequired")),sales_channels:utils.csv(get("pChannels")),is_active:true
  };
  if(!payload.display_name){toast("Display name is required.");return;}
  payload.profile_completeness=profileCompleteness(payload);setBusy(button,true,"Saving…");
  try{
    await db("matchmaking_profiles?on_conflict=user_id",{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=representation"},body:JSON.stringify(payload)});
    state.view="matches";await loadWorkspace(true);toast("Match profile saved ✓");
  }catch(error){toast(parseError(error));}
  finally{setBusy(button,false);}
}

function matchesView(){
  const data=state.data,profile=data.profile,rows=utils.array(data.matches);
  const countries=[...new Set(rows.map(match=>match.target?.country).filter(Boolean))].sort();
  const filtered=rows.filter(match=>{
    const target=match.target||{};
    const hay=[target.display_name,target.country,target.description,...utils.array(target.offered_products),...utils.array(target.interested_products)].join(" ").toLowerCase();
    return(!state.filters.q||hay.includes(state.filters.q.toLowerCase()))&&(!state.filters.role||target.role===state.filters.role)&&(!state.filters.country||target.country===state.filters.country)&&Number(match.match_score)>=Number(state.filters.min||0)&&match.status!=="dismissed";
  });
  const high=rows.filter(match=>Number(match.match_score)>=80).length;
  const connected=utils.array(data.connections).filter(item=>item.status==="accepted").length;
  const groups=utils.categorizeMeetings(data.meetings);
  const attention=groups.requests.filter(meeting=>utils.meetingPermissions(meeting,profile.id).canAccept).length+utils.array(data.connections).filter(item=>item.status==="pending"&&item.recipient_profile_id===profile.id).length;
  const good=Number(profile.profile_completeness)>=70;
  return '<div class="metric-grid">'+metric("Partner matches",rows.length)+metric("High matches",high)+metric("Saved",rows.filter(match=>match.status==="saved").length)+metric("Connections",connected)+metric("Needs attention",attention)+'</div>'+
    '<div class="health '+(good?"":"warn")+'"><div><b>'+Number(profile.profile_completeness||0)+'% profile completeness</b><p>'+(good?"Your structured profile supports higher-confidence explanations.":"Add products, markets and certification needs to improve match quality.")+'</p></div><button class="btn btn-ghost btn-sm" onclick="showView(\'profile\')">Review profile</button></div>'+
    '<div class="panel-head"><div><h2>Recommended business partners</h2><p class="sub">Scores explain the strongest fit signals and the evidence that still needs verification.</p></div><button class="btn btn-primary" onclick="refreshMatches(this)">Refresh matches</button></div>'+
    '<div class="filters"><input aria-label="Search matches" placeholder="Search company, product or country…" value="'+esc(state.filters.q)+'" oninput="setFilter(\'q\',this.value)"><select aria-label="Business role" onchange="setFilter(\'role\',this.value)"><option value="">All roles</option>'+["manufacturer","distributor","buyer"].map(role=>'<option value="'+role+'" '+(state.filters.role===role?"selected":"")+'>'+utils.statusLabel(role)+'</option>').join("")+'</select><select aria-label="Country" onchange="setFilter(\'country\',this.value)"><option value="">All countries</option>'+countries.map(country=>'<option '+(state.filters.country===country?"selected":"")+'>'+esc(country)+'</option>').join("")+'</select><select aria-label="Minimum match score" onchange="setFilter(\'min\',this.value)"><option value="0">All scores</option><option value="50" '+(state.filters.min==="50"?"selected":"")+'>50%+</option><option value="70" '+(state.filters.min==="70"?"selected":"")+'>70%+</option><option value="85" '+(state.filters.min==="85"?"selected":"")+'>85%+</option></select></div>'+
    '<div class="match-list">'+(filtered.length?filtered.map(matchCard).join(""):'<div class="empty"><b>No matches in this view</b>Adjust your filters or improve the structured match profile.</div>')+'</div>';
}

function setFilter(key,value){state.filters[key]=value;renderWorkspace();}

function matchCard(match){
  const target=match.target||{},explanation=match.explanation||{},drivers=utils.array(explanation.top_reasons);
  const risks=Object.values(explanation.risk_signals||{}).filter(Boolean),connection=match.connection,status=connection?.status||match.status;
  const website=utils.safeHttpUrl(target.website);
  let primary="";
  if(connection?.status==="accepted")primary='<button class="btn btn-solid btn-sm" onclick="openRelationship('+Number(connection.id)+')">Open relationship</button><button class="btn btn-primary btn-sm" onclick="openScheduler('+Number(connection.id)+')">Propose meeting</button>';
  else if(connection)primary='<button class="btn btn-solid btn-sm" onclick="showView(\'requests\')">View request</button>';
  else primary='<button class="btn btn-primary btn-sm" onclick="openConnectionRequest(\''+esc(target.id)+'\')">Request connection</button>';
  return '<article class="match-card"><div class="match-top"><div class="company-ident">'+logo(target)+'<div><div class="match-role">'+esc(target.role||"partner")+'</div><div class="match-title">'+esc(target.display_name||"Unnamed company")+(target.verified?'<span class="verified"> · Verified</span>':"")+'</div><div class="match-meta">'+esc(target.country||"Country not specified")+(target.company_size?" · "+esc(target.company_size):"")+' · <span class="status '+esc(status)+'">'+esc(utils.statusLabel(status))+'</span></div></div></div><div class="score" style="--score:'+Number(match.match_score||0)+'"><b>'+Number(match.match_score||0)+'%</b></div></div>'+
    '<p class="sub" style="margin-top:12px">'+esc(explanation.summary||"Review the structured compatibility evidence below.")+'</p>'+
    '<div class="driver-grid">'+drivers.slice(0,3).map(driver=>'<div class="driver"><b><span>'+esc(driver.label)+'</span><span>'+Number(driver.score||0)+'%</span></b><p>'+esc(driver.reason)+' · '+Number(driver.weight_percent||0)+'% weight</p></div>').join("")+'</div>'+
    (risks.length?'<div class="chips">'+risks.map(risk=>'<span class="chip risk">Check: '+esc(risk)+'</span>').join("")+'</div>':"")+
    '<p class="sub" style="border-left:3px solid var(--mint);padding-left:9px">'+esc(explanation.confidence_note||match.confidence_level+" confidence based on available profile data.")+'</p>'+
    '<div class="actions">'+primary+(match.status!=="saved"&&!connection?'<button class="btn btn-ghost btn-sm" onclick="setMatchStatus('+Number(match.id)+',\'saved\')">Save</button>':"")+(match.status==="saved"?'<button class="btn btn-ghost btn-sm" onclick="setMatchStatus('+Number(match.id)+',\'viewed\')">Unsave</button>':"")+(!connection?'<button class="btn btn-ghost btn-sm" onclick="setMatchStatus('+Number(match.id)+',\'dismissed\')">Not interested</button>':"")+(website?'<a class="btn btn-ghost btn-sm" href="'+esc(website)+'" target="_blank" rel="noopener noreferrer">Website ↗</a>':"")+'</div></article>';
}

async function refreshMatches(button){
  if(!state.data?.profile)return;
  setBusy(button,true,"Matching…");
  try{await rpc("refresh_matchmaking_matches",{p_profile_id:state.data.profile.id});await loadWorkspace(true);toast("Partner matches refreshed ✓");}
  catch(error){toast(parseError(error));}
  finally{setBusy(button,false);}
}

async function setMatchStatus(matchId,status){
  try{await rpc("set_matchmaking_match_status",{p_match_id:Number(matchId),p_status:status,p_idempotency_key:uuid()});await loadWorkspace(true);toast(status==="dismissed"?"Partner hidden":"Match updated ✓");}
  catch(error){toast(parseError(error));}
}

function openConnectionRequest(targetId){
  const match=utils.array(state.data.matches).find(item=>item.target?.id===targetId);
  if(!match)return;
  document.getElementById("actionTitle").textContent="Request business connection";
  document.getElementById("actionSub").textContent="Introduce your company to "+(match.target.display_name||"this partner")+".";
  document.getElementById("actionBody").innerHTML='<label for="introMessage">Introduction message</label><textarea id="introMessage" rows="5" maxlength="2000">Hello, our companies appear to be a strong match on MedicHall. I would like to explore a potential cooperation.</textarea>';
  document.getElementById("actionButtons").innerHTML='<button class="btn btn-ghost" onclick="closeModal(\'actionModal\')">Cancel</button><button class="btn btn-primary" id="actionConfirm" onclick="sendConnection(\''+esc(targetId)+'\')">Send request</button>';
  openModal("actionModal","#introMessage");
}

async function sendConnection(targetId){
  const button=document.getElementById("actionConfirm"),message=document.getElementById("introMessage").value.trim();
  setBusy(button,true,"Sending…");
  try{
    await rpc("request_business_connection_v2",{p_recipient_profile_id:targetId,p_message:message||null,p_idempotency_key:uuid()});
    closeModal("actionModal");state.view="requests";await Promise.all([loadWorkspace(true),loadNotifications(true)]);toast("Connection request sent ✓");
  }catch(error){toast(parseError(error));}
  finally{setBusy(button,false);}
}

function requestsView(){
  const profile=state.data.profile;
  const connections=utils.array(state.data.connections).filter(item=>item.status==="pending").map(connection=>{
    const other=connection.other_profile||{},incoming=connection.recipient_profile_id===profile.id;
    return '<article class="request-card"><div class="card-top"><div class="company-ident">'+logo(other)+'<div><div class="kicker">'+(incoming?"Connection request from":"Connection request sent to")+'</div><div class="company-name">'+esc(other.display_name||"Company")+'</div><div class="meta">'+esc(other.country||"")+'</div></div></div><span class="status pending">'+(incoming?"Action required":"Awaiting response")+'</span></div>'+(connection.introduction_message?'<p class="sub">'+esc(connection.introduction_message)+'</p>':"")+'<div class="actions">'+(incoming?'<button class="btn btn-primary btn-sm" onclick="respondConnection('+Number(connection.id)+',\'accepted\','+Number(connection.state_version)+')">Accept</button><button class="btn btn-danger btn-sm" onclick="respondConnection('+Number(connection.id)+',\'declined\','+Number(connection.state_version)+')">Decline</button>':'<button class="btn btn-ghost btn-sm" onclick="openRelationship('+Number(connection.id)+')">View request</button>')+'</div></article>';
  }).join("");
  const meetings=utils.categorizeMeetings(state.data.meetings).requests.map(meeting=>meetingCard(meeting,false)).join("");
  return '<div class="panel-head"><div><h2>Requests</h2><p class="sub">Role-aware labels make it clear who needs to act next.</p></div></div><div class="stack">'+(connections||meetings?connections+meetings:'<div class="empty"><b>No open requests</b>New connection requests and three-option meeting proposals appear here.</div>')+'</div>';
}

function connectionsView(){
  const profile=state.data.profile,rows=utils.array(state.data.connections);
  return '<div class="panel-head"><div><h2>Business connections</h2><p class="sub">Open a relationship to message, review its timeline, keep private notes, or arrange a meeting.</p></div></div><div class="stack">'+(rows.length?rows.map(connection=>{
    const other=connection.other_profile||{},incoming=connection.recipient_profile_id===profile.id;
    return '<article class="connection-card"><div class="card-top"><div class="company-ident">'+logo(other)+'<div><div class="kicker">'+esc(other.role||"partner")+'</div><div class="company-name">'+esc(other.display_name||"Company")+(other.verified?'<span class="verified"> · Verified</span>':"")+'</div><div class="meta">'+esc(other.country||"")+'</div></div></div><span class="status '+esc(connection.status)+'">'+esc(utils.statusLabel(connection.status))+'</span></div>'+(connection.introduction_message?'<p class="sub">'+esc(connection.introduction_message)+'</p>':"")+'<div class="actions">'+(incoming&&connection.status==="pending"?'<button class="btn btn-primary btn-sm" onclick="respondConnection('+Number(connection.id)+',\'accepted\','+Number(connection.state_version)+')">Accept</button><button class="btn btn-danger btn-sm" onclick="respondConnection('+Number(connection.id)+',\'declined\','+Number(connection.state_version)+')">Decline</button>':"")+(connection.status==="accepted"?'<button class="btn btn-solid btn-sm" onclick="openRelationship('+Number(connection.id)+')">Open workspace</button><button class="btn btn-primary btn-sm" onclick="openScheduler('+Number(connection.id)+')">Propose meeting</button>':'<button class="btn btn-ghost btn-sm" onclick="openRelationship('+Number(connection.id)+')">View timeline</button>')+'</div></article>';
  }).join(""):'<div class="empty"><b>No connections yet</b>Request a connection from a strong partner match.</div>')+'</div>';
}

async function respondConnection(id,status,version){
  try{
    await rpc("respond_business_connection_v2",{p_connection_id:Number(id),p_status:status,p_expected_version:Number(version),p_idempotency_key:uuid()});
    await Promise.all([loadWorkspace(true),loadNotifications(true)]);toast(status==="accepted"?"Connection accepted ✓":"Connection declined");
  }catch(error){toast(parseError(error));}
}

function meetingsView(kind){
  const groups=utils.categorizeMeetings(state.data.meetings),rows=kind==="past"?groups.past:groups.upcoming;
  const note=kind==="past"?"Completed, cancelled and declined meetings remain available for follow-up.":"Confirmed meetings include calendar and secure video controls.";
  return '<div class="panel-head"><div><h2>'+(kind==="past"?"Past Meetings":"Upcoming Meetings")+'</h2><p class="sub">'+note+'</p></div></div><div class="stack">'+(rows.length?rows.map(meeting=>meetingCard(meeting,false)).join(""):'<div class="empty"><b>No '+(kind==="past"?"past":"upcoming")+' meetings</b>'+note+'</div>')+'</div>';
}

function meetingCard(meeting,detailed){
  const other=meeting.other_profile||state.detail?.other_profile||{},currentId=state.data.profile.id;
  const proposals=utils.array(meeting.proposals).filter(item=>Number(item.proposal_round)===Number(meeting.proposal_round));
  const permissions=utils.meetingPermissions(meeting,currentId),canRespond=permissions.canAccept;
  const shownTime=meeting.confirmed_start||meeting.proposed_start,status=utils.meetingStatusLabel(meeting,currentId);
  let actions="";
  if(meeting.status==="draft"&&meeting.requester_profile_id===currentId)actions+='<button class="btn btn-ghost btn-sm" onclick="openScheduler('+meeting.connection_id+','+meeting.id+',\'edit_draft\')">Edit draft</button><button class="btn btn-primary btn-sm" onclick="runMeetingAction('+meeting.id+',\'submit\')">Send draft</button>';
  if(permissions.canEdit&&meeting.status!=="draft")actions+='<button class="btn btn-solid btn-sm" onclick="openScheduler('+meeting.connection_id+','+meeting.id+',\'edit_proposal\')">Edit request</button>';
  if(permissions.canWithdraw)actions+='<button class="btn btn-ghost btn-sm" onclick="openMeetingReason('+meeting.id+',\'withdraw\')">Withdraw</button>';
  if(canRespond)actions+='<button class="btn btn-ghost btn-sm" onclick="openScheduler('+meeting.connection_id+','+meeting.id+',\'counter\')">Propose different times</button><button class="btn btn-danger btn-sm" onclick="openMeetingReason('+meeting.id+',\'decline\')">Decline</button>';
  if(meeting.status==="accepted")actions+='<button class="btn btn-primary btn-sm" onclick="prepareVideo('+meeting.id+',this)">Finish confirmation</button>';
  if(meeting.status==="confirmed"){
    if(meeting.video_status==="ready")actions+='<button class="btn btn-primary btn-sm" onclick="joinVideo('+meeting.id+',this)">Join secure video</button>';
    actions+=calendarButtons(meeting);
    if(new Date(meeting.confirmed_start).getTime()<=Date.now())actions+='<button class="btn btn-solid btn-sm" onclick="runMeetingAction('+meeting.id+',\'complete\')">Mark completed</button><button class="btn btn-ghost btn-sm" onclick="openMeetingReason('+meeting.id+',\'no_show\')">No-show</button>';
  }
  if(["accepted","confirmed"].includes(meeting.status))actions+='<button class="btn btn-ghost btn-sm" onclick="openScheduler('+meeting.connection_id+','+meeting.id+',\'reschedule\')">Reschedule</button><button class="btn btn-danger btn-sm" onclick="openMeetingReason('+meeting.id+',\'cancel\')">Cancel</button>';
  if(!detailed)actions+='<button class="btn btn-ghost btn-sm" onclick="openMeetingDetails('+meeting.id+')">Meeting details</button>';
  const video=meeting.status==="confirmed"?'<div class="video-state '+esc(meeting.video_status)+'">'+videoStateText(meeting)+'</div>':"";
  return '<article class="meeting-card" id="meeting-card-'+meeting.id+'"><div class="card-top"><div><div class="kicker">'+(canRespond?"Meeting request from ":"Meeting with ")+esc(other.display_name||"partner")+'</div><div class="company-name">'+esc(meeting.title||"Matchmaking meeting")+'</div><div class="meta">'+(shownTime?esc(utils.dateTime(shownTime,timezone()))+" · "+esc(timezone())+" · "+Number(meeting.duration_minutes||30)+" min":"Choose from the three proposed times · "+Number(meeting.duration_minutes||30)+" min")+'</div></div><span class="status '+esc(meeting.status)+'">'+esc(status)+'</span></div>'+
    (meeting.agenda?'<p class="sub">'+esc(meeting.agenda)+'</p>':"")+proposalList(meeting,proposals,canRespond)+video+(meeting.cancellation_reason?'<div class="chips"><span class="chip risk">'+esc(meeting.cancellation_reason)+'</span></div>':"")+'<div class="actions">'+actions+'</div>'+(detailed?meetingDetailSections(meeting):"")+'</article>';
}

function proposalList(meeting,proposals,canRespond){
  if(!proposals.length)return "";
  return '<div class="proposal-list">'+proposals.map(proposal=>'<div class="proposal '+esc(proposal.status)+'"><div><time>'+esc(utils.dateTime(proposal.start_at,timezone()))+'</time><small>'+esc(utils.statusLabel(proposal.status))+' · '+Math.round((new Date(proposal.end_at)-new Date(proposal.start_at))/60000)+' min · '+esc(proposal.source_timezone)+'</small></div>'+(canRespond&&proposal.status==="active"?'<button class="btn btn-solid btn-sm" onclick="runMeetingAction('+meeting.id+',\'accept\','+proposal.id+')">Accept this time</button>':"")+'</div>').join("")+'</div>';
}

function videoStateText(meeting){
  if(meeting.video_status==="ready")return "Secure video is ready. Join access is issued only to authenticated participants.";
  if(meeting.video_status==="unconfigured")return "Video meetings are not configured yet.";
  if(meeting.video_status==="failed")return "Video setup failed safely. Retry confirmation; no public room or permanent token was created.";
  if(meeting.video_status==="revoked")return "The secure video room has been revoked.";
  return "Secure video is being prepared.";
}

function calendarButtons(meeting){
  return '<button class="btn btn-ghost btn-sm" onclick="downloadIcs('+meeting.id+')">Download ICS</button><button class="btn btn-ghost btn-sm" onclick="openCalendar('+meeting.id+',\'google\')">Google Calendar</button><button class="btn btn-ghost btn-sm" onclick="openCalendar('+meeting.id+',\'outlook\')">Outlook</button>';
}

function findMeeting(id){
  return utils.array(state.data?.meetings).find(item=>Number(item.id)===Number(id))||utils.array(state.detail?.meetings).find(item=>Number(item.id)===Number(id));
}

function downloadIcs(id){
  const event=utils.calendarEvent(findMeeting(id),location.origin,location.pathname);
  if(!event){toast("Confirmed meeting time unavailable.");return;}
  const url=URL.createObjectURL(new Blob([event.ics],{type:"text/calendar;charset=utf-8"}));
  const link=document.createElement("a");link.href=url;link.download=event.filename;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}

function openCalendar(id,provider){
  const event=utils.calendarEvent(findMeeting(id),location.origin,location.pathname);
  if(!event){toast("Confirmed meeting time unavailable.");return;}
  window.open(provider==="outlook"?event.outlook:event.google,"_blank","noopener,noreferrer");
}

async function runMeetingAction(id,action,proposalId=null,reason=null){
  const meeting=findMeeting(id);if(!meeting)return;
  try{
    await rpc("respond_matchmaking_meeting",{p_meeting_id:Number(id),p_action:action,p_expected_version:Number(meeting.state_version),p_idempotency_key:uuid(),p_proposal_id:proposalId,p_slots:null,p_timezone:null,p_reason:reason});
    let retry=false;
    if(action==="accept"){try{await prepareVideo(id,null,true);}catch(_){retry=true;}state.view="upcoming";}
    await Promise.all([loadWorkspace(true),loadNotifications(true)]);
    if(state.detail&&Number(state.detail.connection.id)===Number(meeting.connection_id))await loadRelationship(meeting.connection_id,true);
    toast(action==="accept"?(retry?"Meeting time accepted. Video confirmation needs a retry.":"Meeting time accepted ✓"):"Meeting updated ✓");
  }catch(error){toast(parseError(error));}
}

function openMeetingReason(id,action){
  const labels={decline:"Decline meeting proposal",withdraw:"Withdraw meeting request",cancel:"Cancel meeting",no_show:"Mark meeting as no-show"};
  document.getElementById("actionTitle").textContent=labels[action]||"Update meeting";
  document.getElementById("actionSub").textContent="This change is recorded in the shared meeting timeline.";
  document.getElementById("actionBody").innerHTML='<label for="meetingReason">Reason or note</label><textarea id="meetingReason" rows="4" maxlength="1000" placeholder="Add useful context for the other participant"></textarea>';
  document.getElementById("actionButtons").innerHTML='<button class="btn btn-ghost" onclick="closeModal(\'actionModal\')">Back</button><button class="btn '+(action==="cancel"?"btn-danger":"btn-primary")+'" onclick="confirmMeetingReason('+Number(id)+',\''+action+'\')">Confirm</button>';
  openModal("actionModal","#meetingReason");
}

async function confirmMeetingReason(id,action){
  const reason=document.getElementById("meetingReason").value.trim();closeModal("actionModal");
  const rpcAction=action==="withdraw"?"cancel":action;await runMeetingAction(id,rpcAction,null,reason||null);
  if(rpcAction==="cancel"){try{await videoRequest("revoke",id);}catch(_){}}
}

async function prepareVideo(id,button,silent=false){
  setBusy(button,true,"Preparing…");
  try{
    const result=await videoRequest("prepare",id);await loadWorkspace(true);
    if(!silent)toast(result.video_status==="ready"?"Secure video ready ✓":"Meeting confirmed; video is not configured.");
    return result;
  }catch(error){if(!silent)toast(parseError(error));throw error;}
  finally{setBusy(button,false);}
}

async function joinVideo(id,button){
  setBusy(button,true,"Authorizing…");
  try{
    const result=await videoRequest("join",id),room=utils.safeHttpUrl(result.room_url),parsed=room?new URL(room):null;
    if(!parsed||!parsed.hostname.endsWith(".daily.co")||!result.token){const error=new Error("Invalid provider response");error.status=502;throw error;}
    parsed.searchParams.set("t",result.token);document.getElementById("videoFrame").src=parsed.toString();openModal("videoModal","#videoFrame");
  }catch(error){toast(parseError(error));}
  finally{setBusy(button,false);}
}

function closeVideo(){document.getElementById("videoFrame").src="about:blank";closeModal("videoModal");}

function populateTimezones(selected){
  const fallback=["UTC","Europe/Istanbul","Europe/London","Europe/Berlin","America/New_York","America/Los_Angeles","Asia/Dubai","Asia/Singapore","Asia/Tokyo"];
  const supported=typeof Intl.supportedValuesOf==="function"?Intl.supportedValuesOf("timeZone"):fallback;
  const zones=[...new Set([selected,timezone(),...supported])].filter(Boolean);
  document.getElementById("meetingTimezone").innerHTML=zones.map(zone=>'<option value="'+esc(zone)+'" '+(zone===selected?"selected":"")+'>'+esc(zone.replace(/_/g," "))+'</option>').join("");
}

function zonedParts(value,zone){
  const formatter=new Intl.DateTimeFormat("en-CA",{timeZone:zone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"});
  const parts=Object.fromEntries(formatter.formatToParts(new Date(value)).filter(part=>part.type!=="literal").map(part=>[part.type,part.value]));
  return {date:parts.year+"-"+parts.month+"-"+parts.day,time:parts.hour+":"+parts.minute};
}

function openScheduler(connectionId,meetingId=null,mode="propose"){
  const connection=utils.array(state.data.connections).find(item=>Number(item.id)===Number(connectionId));
  const meeting=meetingId?findMeeting(meetingId):null;
  state.scheduler={mode,connectionId:Number(connectionId),meetingId:meetingId?Number(meetingId):null,slots:[],step:"pick"};
  const labels={counter:"Propose different times",reschedule:"Reschedule meeting",edit_proposal:"Edit meeting request",edit_draft:"Edit meeting draft",propose:"Propose a meeting"};
  document.getElementById("schedulerTitle").textContent=labels[mode]||labels.propose;
  document.getElementById("schedulerPartner").textContent="With "+(connection?.other_profile?.display_name||meeting?.other_profile?.display_name||"your business connection");
  document.getElementById("meetingTopic").value=meeting?.title||"Product portfolio and cooperation";
  document.getElementById("meetingAgenda").value=meeting?.agenda||"Product portfolio, commercial fit and next steps.";
  document.getElementById("meetingLanguage").value=meeting?.language||"English";
  document.getElementById("meetingDuration").value=String(meeting?.duration_minutes||30);
  const zone=meeting?.timezone||timezone();populateTimezones(zone);
  const current=utils.array(meeting?.proposals).filter(item=>Number(item.proposal_round)===Number(meeting?.proposal_round)&&item.status==="active").slice(0,3);
  state.scheduler.slots=current.map(item=>zonedParts(item.start_at,zone));
  const tomorrow=new Date(Date.now()+86400000);document.getElementById("meetingDate").min=new Date().toISOString().slice(0,10);
  document.getElementById("meetingDate").value=state.scheduler.slots[0]?.date||tomorrow.toISOString().slice(0,10);
  document.getElementById("saveDraftButton").style.display=mode==="propose"?"inline-flex":"none";
  showSchedulerStep("pick");renderTimeChoices();renderSelectedSlots();openModal("schedulerModal","#meetingTopic");
}

function showSchedulerStep(step){
  state.scheduler.step=step;
  document.getElementById("schedulerPick").style.display=step==="pick"?"block":"none";
  document.getElementById("schedulerReview").style.display=step==="review"?"block":"none";
  document.getElementById("schedulerSuccess").style.display=step==="success"?"block":"none";
  ["schedulerStep1","schedulerStep2","schedulerStep3"].forEach((id,index)=>{
    const order=["pick","review","success"].indexOf(step),element=document.getElementById(id);
    element.classList.toggle("active",index===order);element.classList.toggle("done",index<order);
  });
}

function timeValues(){
  const values=[];
  for(let hour=8;hour<=19;hour++)for(const minute of [0,30])if(hour<19||minute===0)values.push(String(hour).padStart(2,"0")+":"+String(minute).padStart(2,"0"));
  return values;
}

function renderTimeChoices(){
  const date=document.getElementById("meetingDate").value,slots=state.scheduler.slots;
  document.getElementById("timezoneLabel").textContent=document.getElementById("meetingTimezone").value||timezone();
  document.getElementById("timeChoices").innerHTML=timeValues().map(time=>{
    const selected=slots.some(slot=>slot.date===date&&slot.time===time),full=slots.length>=3&&!selected;
    return '<button class="time-choice '+(selected?"selected":"")+'" '+(full?"disabled":"")+' onclick="toggleSlot(\''+time+'\')">'+time+'</button>';
  }).join("");
}

function toggleSlot(time){
  const date=document.getElementById("meetingDate").value;if(!date){showSchedulerError("Choose a date first.");return;}
  const index=state.scheduler.slots.findIndex(slot=>slot.date===date&&slot.time===time);
  if(index>=0)state.scheduler.slots.splice(index,1);else if(state.scheduler.slots.length<3)state.scheduler.slots.push({date,time});
  state.scheduler.slots.sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time));renderTimeChoices();renderSelectedSlots();
}

function removeSlot(index){state.scheduler.slots.splice(index,1);renderTimeChoices();renderSelectedSlots();}

function renderSelectedSlots(){
  const slots=state.scheduler.slots,zone=document.getElementById("meetingTimezone").value||timezone(),duration=Number(document.getElementById("meetingDuration").value||30);
  document.getElementById("slotCount").textContent=slots.length+" / 3 selected";
  document.getElementById("selectedSlots").innerHTML=slots.length?slots.map((slot,index)=>{
    let label=slot.date+" · "+slot.time;
    try{label=utils.dateTime(utils.wallTimeToIso(slot.date,slot.time,zone),zone);}catch(_){}
    return '<div class="selected-slot"><div><b>Option '+(index+1)+' · '+esc(label)+'</b><small>'+duration+' minutes · '+esc(zone)+'</small></div><button aria-label="Remove option '+(index+1)+'" onclick="removeSlot('+index+')">Remove</button></div>';
  }).join(""):'<div class="selected-empty">Choose exactly three different date and time options.</div>';
}

function schedulerTimezoneChanged(){renderTimeChoices();renderSelectedSlots();}
function showSchedulerError(message,id="schedulerError"){const element=document.getElementById(id);element.textContent=message;element.style.display="block";}

function schedulerPayload(){
  const zone=document.getElementById("meetingTimezone").value||timezone();
  const slots=utils.proposalSlots(state.scheduler.slots,document.getElementById("meetingDuration").value,zone);
  const topic=document.getElementById("meetingTopic").value.trim();
  if(!topic){const error=new Error("Validation failed");error.userMessage="Add a meeting topic.";throw error;}
  return {slots,zone,topic,agenda:document.getElementById("meetingAgenda").value.trim()||null,language:document.getElementById("meetingLanguage").value.trim()||null};
}

function reviewMeeting(){
  document.getElementById("schedulerError").style.display="none";
  try{
    const payload=schedulerPayload();
    document.getElementById("reviewCard").innerHTML='<div class="kicker">Meeting request</div><h4 style="margin:5px 0">'+esc(payload.topic)+'</h4><p class="sub">'+esc(payload.agenda||"No agenda provided.")+'</p><p class="meta">'+Number(document.getElementById("meetingDuration").value)+' minutes · '+esc(payload.language||"Language not specified")+' · '+esc(payload.zone)+'</p><div class="review-slots">'+payload.slots.map((slot,index)=>'<div class="review-slot"><b>Option '+(index+1)+'</b><br>'+esc(utils.dateTime(slot.start_at,payload.zone))+'</div>').join("")+'</div>';
    showSchedulerStep("review");
  }catch(error){showSchedulerError(parseError(error));}
}

function editMeeting(){showSchedulerStep("pick");}

async function sendMeeting(saveDraft){
  const button=saveDraft?document.getElementById("saveDraftButton"):document.getElementById("sendMeetingButton");
  try{
    const payload=schedulerPayload(),meeting=state.scheduler.meetingId?findMeeting(state.scheduler.meetingId):null,mode=state.scheduler.mode;
    setBusy(button,true,saveDraft?"Saving…":"Sending…");
    if(mode==="counter")await rpc("respond_matchmaking_meeting",{p_meeting_id:state.scheduler.meetingId,p_action:"counter",p_expected_version:Number(meeting.state_version),p_idempotency_key:uuid(),p_proposal_id:null,p_slots:payload.slots,p_timezone:payload.zone,p_reason:null});
    else if(mode==="reschedule"){
      await rpc("reschedule_matchmaking_meeting",{p_meeting_id:state.scheduler.meetingId,p_expected_version:Number(meeting.state_version),p_title:payload.topic,p_agenda:payload.agenda,p_timezone:payload.zone,p_language:payload.language,p_slots:payload.slots,p_idempotency_key:uuid()});
      try{await videoRequest("revoke",state.scheduler.meetingId);}catch(_){}
    }else if(mode==="edit_proposal")await rpc("revise_matchmaking_meeting_proposal",{p_meeting_id:state.scheduler.meetingId,p_expected_version:Number(meeting.state_version),p_title:payload.topic,p_agenda:payload.agenda,p_timezone:payload.zone,p_language:payload.language,p_slots:payload.slots,p_idempotency_key:uuid()});
    else if(mode==="edit_draft")await rpc("update_matchmaking_meeting_draft",{p_meeting_id:state.scheduler.meetingId,p_expected_version:Number(meeting.state_version),p_title:payload.topic,p_agenda:payload.agenda,p_timezone:payload.zone,p_language:payload.language,p_slots:payload.slots,p_idempotency_key:uuid()});
    else await rpc("propose_matchmaking_meeting",{p_connection_id:state.scheduler.connectionId,p_title:payload.topic,p_agenda:payload.agenda,p_timezone:payload.zone,p_language:payload.language,p_slots:payload.slots,p_save_as_draft:Boolean(saveDraft),p_idempotency_key:uuid()});
    state.view="requests";await Promise.all([loadWorkspace(true),loadNotifications(true)]);
    if(saveDraft){closeScheduler();toast("Meeting draft saved ✓");}
    else showSchedulerStep("success");
  }catch(error){showSchedulerError(parseError(error),saveDraft?"schedulerError":"reviewError");}
  finally{setBusy(button,false);}
}

function closeScheduler(){closeModal("schedulerModal");}
function finishScheduler(){closeScheduler();showView("requests");}

async function openRelationship(connectionId,focusMeetingId=null){
  state.detail={};openModal("detailModal",".modal-close");document.getElementById("detailBody").innerHTML='<div class="loading">Loading relationship…</div>';
  await loadRelationship(connectionId,false,focusMeetingId);
  clearInterval(state.detailTimer);state.detailTimer=setInterval(()=>{if(!document.hidden&&document.getElementById("detailModal").classList.contains("open"))loadRelationship(connectionId,true,focusMeetingId);},10000);
}

async function openMeetingDetails(meetingId){
  const meeting=findMeeting(meetingId);if(!meeting)return;
  openModal("detailModal",".modal-close");document.getElementById("detailTitle").textContent="Meeting Details";document.getElementById("detailBody").innerHTML='<div class="loading">Loading meeting details…</div>';
  await loadRelationship(meeting.connection_id,false,meetingId);
  clearInterval(state.detailTimer);state.detailTimer=setInterval(()=>{if(!document.hidden&&document.getElementById("detailModal").classList.contains("open"))loadRelationship(meeting.connection_id,true,meetingId);},10000);
}

async function loadRelationship(connectionId,silent,meetingId=null){
  return UI.singleFlight("matchmaking.relationship:"+Number(connectionId),async()=>{
    try{
      state.detail=await rpc("get_matchmaking_relationship",{p_connection_id:Number(connectionId)});
      if(meetingId)renderMeetingDetail(meetingId);else renderRelationshipDetail();
    }catch(error){if(!silent)document.getElementById("detailBody").innerHTML='<div class="empty"><b>Relationship unavailable</b>'+esc(parseError(error))+'</div>';}
  });
}

function renderMeetingDetail(meetingId){
  const meeting=utils.array(state.detail?.meetings).find(item=>Number(item.id)===Number(meetingId));
  if(!meeting){document.getElementById("detailBody").innerHTML='<div class="empty"><b>Meeting unavailable</b>This meeting is no longer in the workspace.</div>';return;}
  const other=state.detail.other_profile||{},participants=utils.array(meeting.participants),names=participants.length?participants.map(item=>item.display_name||item.profile?.display_name||item.role||"Participant"):[state.data.profile.display_name,other.display_name].filter(Boolean);
  document.getElementById("detailTitle").textContent="Meeting Details";
  document.getElementById("detailBody").innerHTML='<div class="card-top"><div><div class="kicker">Meeting with '+esc(other.display_name||"partner")+'</div><div class="company-name">'+esc(meeting.title||"Matchmaking meeting")+'</div><div class="meta">'+esc(meeting.confirmed_start?utils.dateTime(meeting.confirmed_start,timezone()):"Not confirmed")+' · '+Number(meeting.duration_minutes||30)+' min</div></div><span class="status '+esc(meeting.status)+'">'+esc(utils.meetingStatusLabel(meeting,state.data.profile.id))+'</span></div><div class="detail-grid"><div><section class="section"><h4>Participants</h4><div class="chips">'+names.map(name=>'<span class="chip">'+esc(name)+'</span>').join("")+'</div><h4 style="margin-top:14px">Agenda</h4><p class="sub">'+esc(meeting.agenda||"No agenda provided.")+'</p></section>'+meetingCard(meeting,true)+'</div><aside><section class="section"><h4>Meeting controls</h4><p class="meta">'+esc(utils.meetingStatusLabel(meeting,state.data.profile.id))+'</p>'+(meeting.status==="confirmed"?'<div class="video-state '+esc(meeting.video_status)+'">'+videoStateText(meeting)+'</div><div class="actions">'+(meeting.video_status==="ready"?'<button class="btn btn-primary btn-sm" onclick="joinVideo('+meeting.id+',this)">Join secure video</button>':"")+calendarButtons(meeting)+'</div>':'<p class="meta">Calendar and secure join controls appear after confirmation.</p>')+'</section></aside></div>';
}

function renderRelationshipDetail(){
  const connection=state.detail.connection,other=state.detail.other_profile||{},messages=utils.array(state.detail.messages),meetings=utils.array(state.detail.meetings);
  const note=utils.array(state.detail.private_notes).find(item=>!item.meeting_id);
  document.getElementById("detailTitle").textContent=other.display_name||"Relationship workspace";
  document.getElementById("detailBody").innerHTML='<div class="card-top"><div class="company-ident">'+logo(other)+'<div><div class="kicker">'+esc(other.role||"partner")+'</div><div class="company-name">'+esc(other.display_name||"Company")+'</div><div class="meta">'+esc(other.country||"")+'</div></div></div><span class="status '+esc(connection.status)+'">'+esc(utils.statusLabel(connection.status))+'</span></div>'+
    '<div class="detail-grid"><div><section class="section"><h4>Relationship conversation</h4><div class="message-list">'+(messages.length?messages.map(message=>'<div class="message '+(message.message_type==="system"?"system":message.sender_profile_id===state.data.profile.id?"mine":"")+'">'+esc(message.body)+'<time>'+esc(message.sender_name||"MedicHall")+' · '+esc(utils.dateTime(message.created_at,timezone()))+'</time></div>').join(""):'<p class="meta">No messages yet.</p>')+'</div>'+(connection.status==="accepted"?'<div class="compose"><input id="relationshipMessage" maxlength="4000" placeholder="Write a relationship message…" onkeydown="if(event.key===\'Enter\')sendRelationshipMessage('+connection.id+')"><button class="btn btn-primary btn-sm" onclick="sendRelationshipMessage('+connection.id+')">Send</button></div>':"")+'</section><div class="panel-head"><h2>Meeting lifecycle</h2>'+(connection.status==="accepted"?'<button class="btn btn-primary btn-sm" onclick="openScheduler('+connection.id+')">Propose meeting</button>':"")+'</div><div class="stack">'+(meetings.length?meetings.map(meeting=>meetingCard(meeting,true)).join(""):'<div class="empty"><b>No meetings yet</b>Propose exactly three options when both companies are ready.</div>')+'</div></div>'+
    '<aside><section class="section"><h4>Private relationship note</h4><p class="meta">Visible only to your profile.</p><textarea id="relationshipNote" rows="6" maxlength="8000">'+esc(note?.note||"")+'</textarea><button class="btn btn-ghost btn-sm" style="margin-top:8px" onclick="savePrivateNote('+connection.id+',null,\'relationshipNote\')">Save private note</button></section><section class="section"><h4>Partner profile</h4><p class="sub">'+esc(other.description||"No company summary provided.")+'</p><div class="chips">'+utils.array(other.offered_products).slice(0,8).map(item=>'<span class="chip">'+esc(item)+'</span>').join("")+'</div></section></aside></div>';
}

async function sendRelationshipMessage(connectionId){
  const input=document.getElementById("relationshipMessage"),body=input?.value.trim();if(!body)return;
  try{await rpc("send_matchmaking_relationship_message",{p_connection_id:Number(connectionId),p_body:body,p_idempotency_key:uuid()});input.value="";await Promise.all([loadRelationship(connectionId,true),loadWorkspace(true)]);}
  catch(error){toast(parseError(error));}
}

async function savePrivateNote(connectionId,meetingId,inputId){
  const note=document.getElementById(inputId).value.trim();if(!note){toast("Write a private note before saving.");return;}
  try{await rpc("upsert_matchmaking_private_note",{p_connection_id:Number(connectionId),p_meeting_id:meetingId?Number(meetingId):null,p_note:note,p_idempotency_key:uuid()});await loadRelationship(connectionId,true,meetingId);toast("Private note saved ✓");}
  catch(error){toast(parseError(error));}
}

function meetingDetailSections(meeting){
  const events=utils.array(meeting.events),outcomes=utils.array(meeting.outcomes),note=utils.array(state.detail?.private_notes).find(item=>Number(item.meeting_id)===Number(meeting.id));
  return '<div class="detail-grid"><section class="section"><h4>Immutable timeline</h4><div class="timeline">'+(events.length?events.map(event=>'<div class="event"><b>'+esc(utils.statusLabel(event.event_type))+'</b><span> · '+esc(event.actor_name||"MedicHall automation")+'</span><time>'+esc(utils.dateTime(event.created_at,timezone()))+'</time></div>').join(""):'<p class="meta">No events recorded.</p>')+'</div></section><div><section class="section"><h4>Private meeting note</h4><textarea id="meetingNote-'+meeting.id+'" rows="4" maxlength="8000">'+esc(note?.note||"")+'</textarea><button class="btn btn-ghost btn-sm" style="margin-top:7px" onclick="savePrivateNote('+meeting.connection_id+','+meeting.id+',\'meetingNote-'+meeting.id+'\')">Save note</button></section>'+((meeting.status==="completed"||meeting.status==="no_show")?outcomeForm(meeting,outcomes):"")+'</div></div>';
}

function outcomeForm(meeting,outcomes){
  const mine=outcomes.find(item=>item.author_profile_id===state.data.profile.id)||{};
  return '<section class="section"><h4>Post-meeting outcome</h4><label for="outcomeStatus-'+meeting.id+'">Outcome</label><select id="outcomeStatus-'+meeting.id+'">'+["positive","neutral","negative","follow_up_needed","no_decision"].map(value=>'<option value="'+value+'" '+(mine.outcome_status===value?"selected":"")+'>'+utils.statusLabel(value)+'</option>').join("")+'</select><label for="outcomeSummary-'+meeting.id+'">Shared summary</label><textarea id="outcomeSummary-'+meeting.id+'" rows="3">'+esc(mine.shared_summary||"")+'</textarea><label for="outcomeNext-'+meeting.id+'">Next step</label><input id="outcomeNext-'+meeting.id+'" value="'+esc(mine.next_step||"")+'"><label for="outcomeFollow-'+meeting.id+'">Follow up at</label><input id="outcomeFollow-'+meeting.id+'" type="datetime-local" value="'+(mine.follow_up_at?localInput(new Date(mine.follow_up_at)):"")+'"><button class="btn btn-primary btn-sm" style="margin-top:9px" onclick="submitOutcome('+meeting.id+')">Save shared outcome</button></section>';
}

function localInput(date){
  const pad=value=>String(value).padStart(2,"0");
  return date.getFullYear()+"-"+pad(date.getMonth()+1)+"-"+pad(date.getDate())+"T"+pad(date.getHours())+":"+pad(date.getMinutes());
}

async function submitOutcome(meetingId){
  const meeting=findMeeting(meetingId),follow=document.getElementById("outcomeFollow-"+meetingId).value;
  try{
    await rpc("submit_matchmaking_meeting_outcome",{p_meeting_id:Number(meetingId),p_outcome_status:document.getElementById("outcomeStatus-"+meetingId).value,p_shared_summary:document.getElementById("outcomeSummary-"+meetingId).value.trim()||null,p_next_step:document.getElementById("outcomeNext-"+meetingId).value.trim()||null,p_follow_up_at:follow?new Date(follow).toISOString():null,p_idempotency_key:uuid()});
    await loadRelationship(meeting.connection_id,true,meetingId);toast("Meeting outcome saved ✓");
  }catch(error){toast(parseError(error));}
}

function closeDetail(){closeModal("detailModal");clearInterval(state.detailTimer);state.detailTimer=null;state.detail=null;}

function notificationRows(){
  const rows=utils.array(state.notifications.data.notifications),filter=state.notifications.filter;
  if(filter==="action")return rows.filter(item=>item.action_required&&!item.resolved_at);
  if(filter==="unread")return rows.filter(item=>!item.read_at);
  if(filter==="read")return rows.filter(item=>item.read_at&&!item.resolved_at);
  if(filter==="resolved")return rows.filter(item=>item.resolved_at);
  return rows;
}

function updateNotificationBadge(){
  const count=Number(state.notifications.data.badge_count||0),badge=document.getElementById("notificationBadge");
  const bell=document.getElementById("notificationBell");
  badge.textContent=utils.badgeLabel(count);badge.style.display=count?"block":"none";badge.setAttribute("aria-hidden","true");
  if(bell)bell.setAttribute("aria-label",count?"Notifications, "+count+" updates":"Notifications");
}

function renderNotifications(){
  const filters=[["all","All"],["action","Action Required"],["unread","Unread"],["read","Read"],["resolved","Resolved"]];
  document.getElementById("notificationFilters").innerHTML=filters.map(([value,label])=>'<button class="'+(state.notifications.filter===value?"active":"")+'" onclick="setNotificationFilter(\''+value+'\')">'+label+'</button>').join("");
  document.getElementById("notificationSummary").textContent=Number(state.notifications.data.action_required_count||0)+" action required · "+Number(state.notifications.data.unread_count||0)+" unread";
  const rows=notificationRows();
  document.getElementById("notificationList").innerHTML=rows.length?utils.groupNotifications(rows).map(group=>'<section class="notification-group"><h4>'+esc(group.label)+'</h4>'+group.items.map(item=>{
    const classes=(item.read_at?"":" unread")+(item.action_required&&!item.resolved_at?" action":"")+(item.resolved_at?" resolved":"");
    return '<article class="notification-card'+classes+'"><div class="card-top"><div><div class="kicker">'+esc(item.source_kind||"system")+(item.action_required&&!item.resolved_at?" · Action required":"")+'</div><div class="company-name">'+esc(item.title)+'</div><p>'+esc(item.body)+'</p><time datetime="'+esc(item.created_at)+'" title="'+esc(utils.dateTime(item.created_at,timezone()))+'">'+esc(utils.relativeTime(item.created_at))+'</time></div>'+(!item.read_at?'<span class="status proposed">New</span>':item.resolved_at?'<span class="status completed">Resolved</span>':"")+'</div><div class="actions"><button class="btn btn-solid btn-sm" onclick="openNotification('+Number(item.id)+')">Open</button></div></article>';
  }).join("")+'</section>').join(""):'<div class="empty"><b>Nothing in this view</b>Your notification state is up to date.</div>';
}

function setNotificationFilter(filter){state.notifications.filter=filter;renderNotifications();}

async function loadNotifications(silent=false){
  if(state.notifications.loading||!TOKEN||!USER)return;
  state.notifications.loading=true;
  try{
    state.notifications.data=await rpc("get_portal_notification_center",{p_limit:100});updateNotificationBadge();
    if(document.getElementById("notificationModal").classList.contains("open"))renderNotifications();
    if(!state.notifications.timer)state.notifications.timer=setInterval(()=>{if(!document.hidden)loadNotifications(true);},10000);
  }catch(error){if(!silent&&document.getElementById("notificationModal").classList.contains("open"))document.getElementById("notificationList").innerHTML='<div class="empty"><b>Notifications unavailable</b>'+esc(parseError(error))+'</div>';}
  finally{state.notifications.loading=false;}
}

async function toggleNotifications(){
  if(document.getElementById("notificationModal").classList.contains("open")){closeNotifications();return;}
  const modal=document.getElementById("notificationModal"),bell=document.getElementById("notificationBell");
  bell.setAttribute("aria-expanded","true");globalThis.MedicHallNavigation?.positionNotificationPanel(modal,bell);document.body.classList.add("mh-notification-open");openModal("notificationModal",".modal-close");renderNotifications();await loadNotifications(true);
}

function closeNotifications(){document.getElementById("notificationBell").setAttribute("aria-expanded","false");closeModal("notificationModal");document.body.classList.remove("mh-notification-open");}

async function openNotification(id){
  const item=utils.array(state.notifications.data.notifications).find(row=>Number(row.id)===Number(id));if(!item)return;
  try{await rpc("mark_portal_notifications_read",{p_notification_ids:[Number(id)]});await loadNotifications(true);}catch(_){}
  closeNotifications();
  const action=String(item.action_url||"");
  if(action.startsWith("#rfq")||action.startsWith("#inbox")){location.href="portal.html"+action;return;}
  const meetingId=item.meeting_id||Number(action.match(/matchmaking-meeting=(\d+)/)?.[1]);
  const connectionId=item.connection_id||Number(action.match(/matchmaking-relationship=(\d+)/)?.[1]);
  if(meetingId){const meeting=findMeeting(meetingId);if(meeting)openMeetingDetails(meetingId);}
  else if(connectionId)openRelationship(connectionId);
}

function toggleProfileMenu(force){
  const menu=document.getElementById("profilePopover"),trigger=document.getElementById("profileTrigger");
  const open=typeof force==="boolean"?force:!menu.classList.contains("open");
  menu.classList.toggle("open",open);trigger.setAttribute("aria-expanded",String(open));
}

function logout(){AUTH_SESSION.clear();document.querySelector("medichall-header")?.setAuthState(false);location.href="portal.html";}

async function loadWorkspace(silent=false){
  if(state.loading||!TOKEN||!USER)return;
  state.loading=true;
  if(!silent&&!state.loaded)document.getElementById("workspaceRoot").innerHTML='<div class="card loading">Loading your Matchmaking Workspace…</div>';
  try{
    state.data=await rpc("get_matchmaking_workspace",{p_limit:100});state.loaded=true;updateHeader();renderTabs();renderWorkspace();applyDeepLink();
    if(!state.workspaceTimer)state.workspaceTimer=setInterval(()=>{if(!document.hidden)loadWorkspace(true);},30000);
  }catch(error){if(!silent)document.getElementById("workspaceRoot").innerHTML='<div class="empty"><b>Workspace unavailable</b>'+esc(parseError(error))+'<br><button class="btn btn-ghost btn-sm" style="margin-top:12px" onclick="loadWorkspace()">Try again</button></div>';}
  finally{state.loading=false;}
}

function applyDeepLink(){
  const hash=location.hash;if(state.handledHash===hash)return;
  const meeting=hash.match(/^#matchmaking-meeting=(\d+)$/),relationship=hash.match(/^#matchmaking-relationship=(\d+)$/);
  if(hash==="#profile"){state.handledHash=hash;showView("profile");}
  else if(meeting&&findMeeting(meeting[1])){state.handledHash=hash;openMeetingDetails(Number(meeting[1]));}
  else if(relationship){state.handledHash=hash;openRelationship(Number(relationship[1]));}
}

async function init(){
  if(!utils)throw new Error("Matchmaking domain helpers failed to load.");
  if(!AUTH_SESSION.hasStoredSession()){document.getElementById("authWarning").style.display="block";document.getElementById("heroRole").textContent="Login required";return;}
  try{
    USER=await AUTH_SESSION.getUser();TOKEN=AUTH_SESSION.accessToken();
    const safe=path=>db(path).catch(()=>[]);
    const [companies,buyers]=await Promise.all([
      safe("companies?select=id,name,country,website,description,certifications&owner_id=eq."+USER.id+"&limit=1"),
      safe("buyer_profiles?select=*&user_id=eq."+USER.id+"&limit=1")
    ]);
    COMPANY=companies?.[0]||null;BUYER=buyers?.[0]||null;
    document.getElementById("app").style.display="block";document.getElementById("navActions").style.display="flex";
    document.querySelector("medichall-header")?.setAuthState(true);
    await Promise.all([loadWorkspace(),loadNotifications(true)]);
  }catch(error){
    UI.report("matchmaking.init",error);document.getElementById("authWarning").style.display="block";document.getElementById("heroRole").textContent="Login required";
  }
}

document.addEventListener("keydown",event=>{
  trapFocus(event);
  if(event.key==="Escape"){
    const modal=topModal();
    if(modal?.id==="videoModal")closeVideo();
    else if(modal?.id==="detailModal")closeDetail();
    else if(modal?.id==="schedulerModal")closeScheduler();
    else if(modal?.id==="notificationModal")closeNotifications();
    else if(modal)closeModal(modal.id);
    else toggleProfileMenu(false);
  }
});
document.addEventListener("click",event=>{if(!event.target.closest(".profile-menu"))toggleProfileMenu(false);});
document.addEventListener("visibilitychange",()=>{if(!document.hidden){loadWorkspace(true);loadNotifications(true);}});
window.addEventListener("hashchange",()=>{state.handledHash=null;applyDeepLink();});
window.addEventListener("resize",()=>{const modal=document.getElementById("notificationModal");if(modal?.classList.contains("open"))globalThis.MedicHallNavigation?.positionNotificationPanel(modal,document.getElementById("notificationBell"));});

Object.assign(globalThis,{
  showView,saveProfile,refreshMatches,setFilter,setMatchStatus,openConnectionRequest,sendConnection,
  respondConnection,openScheduler,removeSlot,toggleSlot,schedulerTimezoneChanged,renderSelectedSlots,
  reviewMeeting,editMeeting,sendMeeting,closeScheduler,finishScheduler,runMeetingAction,openMeetingReason,
  confirmMeetingReason,prepareVideo,joinVideo,closeVideo,downloadIcs,openCalendar,openRelationship,
  openMeetingDetails,sendRelationshipMessage,savePrivateNote,submitOutcome,closeDetail,toggleNotifications,
  closeNotifications,setNotificationFilter,openNotification,toggleProfileMenu,logout,closeModal,loadWorkspace
});

init();
})();
