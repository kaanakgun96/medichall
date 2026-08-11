(function(global){
  "use strict";
  const state={data:null,loading:false,query:"",productSelector:null};
  const text=value=>value==null?"":String(value);
  const array=value=>Array.isArray(value)?value:[];
  const escape=value=>global.MedicHallTaxonomy.escape(value);
  const rpc=(name,body={})=>db("rpc/"+name,{method:"POST",body:JSON.stringify(body)});
  const search=(query="")=>rpc("search_medical_product_taxonomy_v1",{p_query:query||null,p_limit:100});
  const resolve=term=>rpc("resolve_medical_product_term_v1",{p_term:term,p_limit:5});
  const activeNodes=()=>array(state.data&&state.data.nodes).filter(node=>node.is_active!==false);
  const options=(selected,parentTypes)=>activeNodes().filter(node=>!parentTypes||parentTypes.includes(node.node_type)).map(node=>'<option value="'+Number(node.id)+'" '+(Number(selected)===Number(node.id)?'selected':'')+'>'+escape(node.canonical_name)+' · '+escape(node.node_type)+'</option>').join("");

  async function loadMedicalTaxonomyAdmin(force=false){
    if(state.loading||state.data&&!force)return;
    state.loading=true;
    const root=document.getElementById("taxonomyAdminRoot");
    if(root)root.innerHTML='<div class="loading">Loading medical product taxonomy…</div>';
    try{state.data=await rpc("get_admin_medical_taxonomy_v1",{p_query:state.query||null,p_limit:500});render();}
    catch(error){if(root)root.innerHTML='<div class="empty"><b>Taxonomy unavailable</b>'+escape(friendlyError(error))+'</div>';}
    finally{state.loading=false;}
  }

  function nodeRows(){
    const nodes=array(state.data&&state.data.nodes);
    if(!nodes.length)return '<div class="empty"><b>No taxonomy nodes match this search</b></div>';
    return nodes.map(node=>'<article class="mh-taxonomy-admin-item"><div class="panel-head"><div><b>'+escape(node.canonical_name)+'</b><small>'+escape(node.node_type)+' · '+escape(node.slug)+' · '+Number(node.product_count||0)+' products · '+Number(node.interest_count||0)+' interests · '+Number(node.alias_count||0)+' aliases</small></div><span class="pill '+(node.is_active?'on':'off')+'">'+(node.is_active?'Active':'Inactive')+'</span></div><button type="button" class="btn btn-ghost btn-sm" onclick="editMedicalTaxonomyNode('+Number(node.id)+')">Edit</button></article>').join("");
  }
  function reviewRows(){
    const reviews=array(state.data&&state.data.review_queue);
    if(!reviews.length)return '<div class="empty"><b>No unmapped terms awaiting review</b></div>';
    return reviews.map(review=>'<article class="mh-taxonomy-admin-item"><b>'+escape(review.sample_term)+'</b><small>'+Number(review.occurrence_count||1)+' occurrence'+(Number(review.occurrence_count)===1?'':'s')+' · '+escape(review.source_context)+'</small><label for="taxonomyReview-'+Number(review.id)+'">Suggested canonical category</label><select id="taxonomyReview-'+Number(review.id)+'"><option value="">Choose category…</option>'+options(review.suggested_taxonomy_id)+'</select><div class="row-actions" style="margin-top:8px"><button class="btn btn-solid btn-sm" onclick="reviewMedicalTaxonomyTerm('+Number(review.id)+',\'approved\',true)">Approve + alias</button><button class="btn btn-ghost btn-sm" onclick="reviewMedicalTaxonomyTerm('+Number(review.id)+',\'keep_custom\',false)">Keep custom</button><button class="btn-danger" onclick="reviewMedicalTaxonomyTerm('+Number(review.id)+',\'rejected\',false)">Reject</button></div></article>').join("");
  }
  function aliasRows(){
    const aliases=array(state.data&&state.data.aliases);
    if(!aliases.length)return '<div class="empty"><b>No aliases match this search</b></div>';
    return aliases.slice(0,100).map(alias=>{
      const node=activeNodes().find(item=>Number(item.id)===Number(alias.taxonomy_id));
      return '<article class="mh-taxonomy-admin-item"><b>'+escape(alias.alias_text)+'</b><small>→ '+escape(node&&node.canonical_name||"Inactive node")+' · '+Math.round(Number(alias.confidence||0)*100)+'%</small><button class="btn btn-ghost btn-sm" onclick="editMedicalProductAlias('+Number(alias.id)+')">Edit</button></article>';
    }).join("");
  }
  function render(){
    const root=document.getElementById("taxonomyAdminRoot");if(!root)return;
    root.innerHTML='<div class="panel-head"><div><h2>Medical Product Taxonomy</h2><span class="hint">Canonical categories, approved aliases, and controlled learning review.</span></div><input id="taxonomyAdminSearch" type="search" value="'+escape(state.query)+'" placeholder="Search nodes and aliases…" style="max-width:300px"></div><div class="mh-taxonomy-admin-grid"><section class="growth-section"><h3>Hierarchy</h3><p class="growth-section-sub">Commercial product names remain separate from canonical categories.</p><div class="mh-taxonomy-admin-list">'+nodeRows()+'</div></section><section class="growth-section"><h3>Create or edit node</h3><input type="hidden" id="taxonomyNodeId"><label for="taxonomyNodeType">Type</label><select id="taxonomyNodeType" onchange="syncMedicalTaxonomyParent()"><option value="family">Family</option><option value="category">Category</option><option value="product_type">Product type</option></select><label for="taxonomyNodeParent">Parent</label><select id="taxonomyNodeParent"><option value="">No parent</option>'+options(null,["family","category"])+'</select><label for="taxonomyNodeName">Canonical name</label><input id="taxonomyNodeName" maxlength="160"><label for="taxonomyNodeSlug">Slug</label><input id="taxonomyNodeSlug" maxlength="180" placeholder="lowercase-hyphenated"><label for="taxonomyNodeDescription">Description</label><textarea id="taxonomyNodeDescription" rows="3" maxlength="1200"></textarea><label><input id="taxonomyNodeActive" type="checkbox" checked style="width:auto"> Active</label><button class="btn btn-solid" style="margin-top:10px" onclick="saveMedicalTaxonomyNode()">Save node</button></section></div><div class="mh-taxonomy-admin-grid" style="margin-top:14px"><section class="growth-section"><h3>Aliases</h3><div class="mh-taxonomy-admin-list">'+aliasRows()+'</div></section><section class="growth-section"><h3>Create or edit alias</h3><input type="hidden" id="taxonomyAliasId"><label for="taxonomyAliasNode">Canonical category</label><select id="taxonomyAliasNode"><option value="">Choose category…</option>'+options()+'</select><label for="taxonomyAliasText">Alias</label><input id="taxonomyAliasText" maxlength="240"><label for="taxonomyAliasLanguage">Language</label><input id="taxonomyAliasLanguage" value="en" maxlength="8"><label for="taxonomyAliasConfidence">Confidence</label><input id="taxonomyAliasConfidence" type="number" min="0" max="1" step="0.01" value="1"><label><input id="taxonomyAliasActive" type="checkbox" checked style="width:auto"> Active</label><button class="btn btn-solid" style="margin-top:10px" onclick="saveMedicalProductAlias()">Save alias</button></section></div><section class="growth-section" style="margin-top:14px"><h3>Unmapped and suggested terms</h3><p class="growth-section-sub">Nothing becomes a canonical alias until an administrator approves it.</p><div class="mh-taxonomy-admin-list">'+reviewRows()+'</div></section>';
    let timer;document.getElementById("taxonomyAdminSearch")?.addEventListener("input",event=>{clearTimeout(timer);timer=setTimeout(()=>{state.query=event.target.value.trim();state.data=null;loadMedicalTaxonomyAdmin(true);},250);});
    syncMedicalTaxonomyParent();
  }

  function syncMedicalTaxonomyParent(){
    const type=document.getElementById("taxonomyNodeType")?.value,parent=document.getElementById("taxonomyNodeParent");if(!parent)return;
    const current=parent.value,allowed=type==="category"?["family"]:type==="product_type"?["category"]:[];
    parent.innerHTML='<option value="">'+(allowed.length?'Choose parent…':'No parent')+'</option>'+options(current,allowed);parent.disabled=!allowed.length;
  }
  function editMedicalTaxonomyNode(id){
    const node=activeNodes().concat(array(state.data.nodes).filter(item=>item.is_active===false)).find(item=>Number(item.id)===Number(id));if(!node)return;
    document.getElementById("taxonomyNodeId").value=node.id;document.getElementById("taxonomyNodeType").value=node.node_type;syncMedicalTaxonomyParent();document.getElementById("taxonomyNodeParent").value=node.parent_id||"";document.getElementById("taxonomyNodeName").value=node.canonical_name||"";document.getElementById("taxonomyNodeSlug").value=node.slug||"";document.getElementById("taxonomyNodeDescription").value=node.description||"";document.getElementById("taxonomyNodeActive").checked=node.is_active!==false;document.getElementById("taxonomyNodeName").focus();
  }
  async function saveMedicalTaxonomyNode(){
    const body={p_id:Number(document.getElementById("taxonomyNodeId").value)||null,p_parent_id:Number(document.getElementById("taxonomyNodeParent").value)||null,p_node_type:document.getElementById("taxonomyNodeType").value,p_canonical_name:document.getElementById("taxonomyNodeName").value.trim(),p_slug:document.getElementById("taxonomyNodeSlug").value.trim(),p_description:document.getElementById("taxonomyNodeDescription").value.trim()||null,p_is_active:document.getElementById("taxonomyNodeActive").checked,p_sort_order:0};
    if(!body.p_canonical_name||!body.p_slug){toast("Canonical name and slug are required");return;}
    try{await rpc("admin_upsert_medical_taxonomy_node_v1",body);toast("Taxonomy node saved ✓");state.data=null;await loadMedicalTaxonomyAdmin(true);}catch(error){toast(friendlyError(error));}
  }
  function editMedicalProductAlias(id){
    const alias=array(state.data.aliases).find(item=>Number(item.id)===Number(id));if(!alias)return;
    document.getElementById("taxonomyAliasId").value=alias.id;document.getElementById("taxonomyAliasNode").value=alias.taxonomy_id;document.getElementById("taxonomyAliasText").value=alias.alias_text||"";document.getElementById("taxonomyAliasLanguage").value=alias.language_code||"en";document.getElementById("taxonomyAliasConfidence").value=alias.confidence||1;document.getElementById("taxonomyAliasActive").checked=alias.is_active!==false;document.getElementById("taxonomyAliasText").focus();
  }
  async function saveMedicalProductAlias(){
    const body={p_id:Number(document.getElementById("taxonomyAliasId").value)||null,p_taxonomy_id:Number(document.getElementById("taxonomyAliasNode").value)||null,p_alias_text:document.getElementById("taxonomyAliasText").value.trim(),p_language_code:document.getElementById("taxonomyAliasLanguage").value.trim()||"en",p_confidence:Number(document.getElementById("taxonomyAliasConfidence").value),p_is_active:document.getElementById("taxonomyAliasActive").checked};
    if(!body.p_taxonomy_id||!body.p_alias_text){toast("Choose a category and enter an alias");return;}
    try{await rpc("admin_upsert_medical_product_alias_v1",body);toast("Alias saved ✓");state.data=null;await loadMedicalTaxonomyAdmin(true);}catch(error){toast(friendlyError(error));}
  }
  async function reviewMedicalTaxonomyTerm(id,decision,createAlias){
    const taxonomyId=Number(document.getElementById("taxonomyReview-"+id)?.value)||null;
    if(decision==="approved"&&!taxonomyId){toast("Choose a canonical category first");return;}
    try{await rpc("admin_review_medical_product_term_v1",{p_review_id:Number(id),p_decision:decision,p_taxonomy_id:taxonomyId,p_create_alias:Boolean(createAlias)});toast("Review saved ✓");state.data=null;await loadMedicalTaxonomyAdmin(true);}catch(error){toast(friendlyError(error));}
  }

  async function initAdminProductTaxonomySelector(productId){
    state.productSelector?.destroy();let initial=[];
    if(productId){
      try{const rows=await db("product_taxonomy_mappings?select=taxonomy_id,medical_product_taxonomy(canonical_name,node_type,slug)&product_id=eq."+Number(productId)+"&is_primary=eq.true&status=eq.approved&limit=1");const row=rows&&rows[0],node=row&&row.medical_product_taxonomy;if(row&&node)initial=[{interest_kind:"offered",taxonomy_id:Number(row.taxonomy_id),canonical_name:node.canonical_name,node_type:node.node_type,slug:node.slug}];}catch(error){UI.report("admin.product_taxonomy_load",error);}
    }
    state.productSelector=global.MedicHallTaxonomy.createSelector({root:"#adminProductTaxonomySelector",mode:"single",interestKind:"offered",label:"Canonical medical category",hint:"Commercial product name stays unchanged",search,resolve,initial});
  }
  async function saveAdminProductTaxonomySelection(productId,productName){
    const selected=state.productSelector?.getValue()[0];
    if(selected&&selected.taxonomy_id)return await rpc("set_product_taxonomy_mapping_v1",{p_product_id:Number(productId),p_taxonomy_id:Number(selected.taxonomy_id),p_source_text:productName});
    if(selected&&selected.custom_term){await rpc("clear_product_taxonomy_mapping_v1",{p_product_id:Number(productId)}).catch(()=>false);return await rpc("queue_product_taxonomy_review_v1",{p_product_id:Number(productId),p_term:selected.custom_term});}
    return await rpc("clear_product_taxonomy_mapping_v1",{p_product_id:Number(productId)}).catch(()=>false);
  }

  Object.assign(global,{loadMedicalTaxonomyAdmin,editMedicalTaxonomyNode,syncMedicalTaxonomyParent,saveMedicalTaxonomyNode,editMedicalProductAlias,saveMedicalProductAlias,reviewMedicalTaxonomyTerm,initAdminProductTaxonomySelector,saveAdminProductTaxonomySelection});
})(globalThis);
