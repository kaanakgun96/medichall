(function(global){
  "use strict";
  const text=value=>value==null?"":String(value);
  const array=value=>Array.isArray(value)?value:[];
  const esc=value=>text(value).replace(/[&<>'"]/g,character=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"})[character]);
  const number=value=>Number.isFinite(Number(value))?Number(value):null;

  function createSelector(options){
    const root=typeof options.root==="string"?document.querySelector(options.root):options.root;
    if(!root)throw new Error("Taxonomy selector root is required");
    if(typeof options.search!=="function"||typeof options.resolve!=="function")throw new Error("Taxonomy search and resolver are required");
    const state={
      nodes:[],selected:array(options.initial).map(item=>({...item})),query:"",open:false,
      loading:false,error:"",proposal:null,interestKind:options.interestKind||"interested",
      mode:options.mode==="single"?"single":"multiple",expanded:new Set()
    };
    const uid="mh-taxonomy-"+Math.random().toString(36).slice(2);

    function selectionKey(item){return item.taxonomy_id?"node:"+item.taxonomy_id:"custom:"+text(item.custom_term).toLowerCase();}
    function notify(){if(typeof options.onChange==="function")options.onChange(getValue());}
    function getValue(){return state.selected.map(item=>({
      interest_kind:item.interest_kind||state.interestKind,
      ...(item.taxonomy_id?{taxonomy_id:Number(item.taxonomy_id),canonical_name:item.canonical_name,node_type:item.node_type,slug:item.slug}:{custom_term:item.custom_term})
    }));}
    function selectedIds(){return new Set(state.selected.filter(item=>item.taxonomy_id).map(item=>Number(item.taxonomy_id)));}
    function filteredNodes(){
      const query=state.query.trim().toLowerCase();
      if(!query)return state.nodes;
      return state.nodes.filter(node=>[node.canonical_name,...array(node.aliases)].join(" ").toLowerCase().includes(query));
    }
    function nodeButton(node,selected){return '<button type="button" class="mh-taxonomy-node" data-taxonomy-id="'+Number(node.id)+'" data-level="'+Number(node.hierarchy_level||1)+'" role="option" aria-selected="'+selected.has(Number(node.id))+'"><span><b>'+esc(node.canonical_name)+'</b><small>'+esc(node.description||array(node.aliases).slice(0,3).join(" · "))+'</small></span><span class="mh-taxonomy-level">'+esc(node.node_type||"category")+'</span></button>';}
    function renderResults(){
      const nodes=filteredNodes(),selected=selectedIds();
      if(!nodes.length)return '<div class="mh-taxonomy-empty">No verified category found. Use “Can’t find your product?” to keep a custom description.</div>';
      if(state.query.trim())return nodes.map(node=>nodeButton(node,selected)).join("");
      const all=state.nodes,children=parentId=>all.filter(node=>Number(node.parent_id)===Number(parentId));
      return all.filter(node=>Number(node.hierarchy_level)===1).map(family=>{
        const expanded=state.expanded.has(Number(family.id));
        const categoryHtml=expanded?children(family.id).map(category=>{
          const productTypes=children(category.id),categoryExpanded=state.expanded.has(Number(category.id));
          const disclosure=productTypes.length?'<button type="button" class="mh-taxonomy-disclosure" data-expand="'+Number(category.id)+'" aria-label="'+(categoryExpanded?'Collapse ':'Expand ')+esc(category.canonical_name)+'" aria-expanded="'+categoryExpanded+'">›</button>':'<span class="mh-taxonomy-disclosure-spacer" aria-hidden="true"></span>';
          return '<div class="mh-taxonomy-category"><div class="mh-taxonomy-family-head">'+disclosure+nodeButton(category,selected)+'</div>'+(categoryExpanded?productTypes.map(type=>nodeButton(type,selected)).join(""):"")+'</div>';
        }).join(""):"";
        return '<div class="mh-taxonomy-family"><div class="mh-taxonomy-family-head"><button type="button" class="mh-taxonomy-disclosure" data-expand="'+Number(family.id)+'" aria-label="'+(expanded?'Collapse ':'Expand ')+esc(family.canonical_name)+'" aria-expanded="'+expanded+'">›</button>'+nodeButton(family,selected)+'</div>'+categoryHtml+'</div>';
      }).join("");
    }
    function renderSelected(){
      if(!state.selected.length)return '<div class="mh-taxonomy-empty">No structured product categories selected yet.</div>';
      return '<div class="mh-taxonomy-selected">'+state.selected.map(item=>'<span class="mh-taxonomy-chip"><span>'+esc(item.canonical_name||item.custom_term)+(item.custom_term?' · custom':'')+'</span><button type="button" data-remove="'+esc(selectionKey(item))+'" aria-label="Remove '+esc(item.canonical_name||item.custom_term)+'">×</button></span>').join("")+'</div>';
    }
    function renderProposal(){
      const proposal=state.proposal;if(!proposal)return "";
      const recommendation=proposal.recommended;
      if(!recommendation)return '<div class="mh-taxonomy-proposal"><b>No reliable category found</b><p>Keep this as a custom term for admin review. It will not be treated as confirmed taxonomy evidence.</p><div class="mh-taxonomy-actions"><button type="button" class="mh-taxonomy-btn secondary" data-action="keep-custom">Keep as custom</button><button type="button" class="mh-taxonomy-btn secondary" data-action="choose-another">Choose another</button></div></div>';
      const medium=proposal.resolution==="medium_confidence";
      const alternatives=medium?array(proposal.alternatives).filter(item=>Number(item.canonical_taxonomy_id)!==Number(recommendation.canonical_taxonomy_id)).slice(0,2):[];
      return '<div class="mh-taxonomy-proposal"><b>'+(medium?'Possible':'Likely')+' category: '+esc(recommendation.canonical_name)+'</b><p>'+Math.round(Number(recommendation.confidence||0)*100)+'% deterministic confidence · '+esc(recommendation.reasoning||"Please confirm this mapping.")+'</p>'+(alternatives.length?'<p><b>Other possible categories:</b> '+alternatives.map(item=>esc(item.canonical_name)).join(' · ')+'</p>':'')+'<div class="mh-taxonomy-actions"><button type="button" class="mh-taxonomy-btn" data-action="use-proposal">Use this category</button><button type="button" class="mh-taxonomy-btn secondary" data-action="choose-another">Choose another</button><button type="button" class="mh-taxonomy-btn secondary" data-action="keep-custom">Keep as custom</button></div></div>';
    }
    function render(){
      root.className="mh-taxonomy";
      root.innerHTML='<div class="mh-taxonomy-label"><b>'+esc(options.label||"Medical product categories")+'</b><span>'+esc(options.hint||"Search or choose a broad family")+'</span></div><div class="mh-taxonomy-search-row"><input class="mh-taxonomy-search" id="'+uid+'-search" type="search" autocomplete="off" value="'+esc(state.query)+'" placeholder="'+esc(options.placeholder||"Search medical products…")+'" role="combobox" aria-expanded="'+state.open+'" aria-controls="'+uid+'-results" aria-autocomplete="list"></div><div class="mh-taxonomy-results" id="'+uid+'-results" role="listbox" '+(state.open?'':'hidden')+'>'+renderResults()+'</div>'+renderSelected()+'<button type="button" class="mh-taxonomy-custom-toggle" data-action="toggle-custom" aria-expanded="false">Can’t find your product?</button><div class="mh-taxonomy-custom" hidden><p>Describe the product. MedicHall will check canonical names and approved aliases first. Low-confidence terms remain custom.</p><div class="mh-taxonomy-custom-row"><input type="text" maxlength="240" placeholder="e.g. Sterile ultrasound transducer sleeve" aria-label="Custom product description"><button type="button" class="mh-taxonomy-btn" data-action="resolve-custom">Check category</button></div>'+renderProposal()+'</div><div class="mh-taxonomy-status '+(state.error?'error':'')+'" role="status" aria-live="polite">'+esc(state.error||(state.loading?"Loading medical product taxonomy…":""))+'</div>';
      bind();
    }
    function bind(){
      const searchInput=root.querySelector(".mh-taxonomy-search");
      searchInput.addEventListener("focus",()=>{if(!state.open){state.open=true;render();root.querySelector(".mh-taxonomy-search")?.focus();}});
      searchInput.addEventListener("input",event=>{state.query=event.target.value;state.open=true;render();const next=root.querySelector(".mh-taxonomy-search");next?.focus();next?.setSelectionRange(state.query.length,state.query.length);});
      searchInput.addEventListener("keydown",event=>{
        if(event.key==="ArrowDown"){event.preventDefault();root.querySelector(".mh-taxonomy-node")?.focus();}
        if(event.key==="Escape"){state.open=false;render();}
      });
      root.querySelectorAll(".mh-taxonomy-node").forEach(button=>{
        button.addEventListener("click",()=>selectNode(Number(button.dataset.taxonomyId)));
        button.addEventListener("keydown",event=>{
          const buttons=[...root.querySelectorAll(".mh-taxonomy-node")],index=buttons.indexOf(event.currentTarget);let target=null;
          if(event.key==="ArrowDown")target=buttons[index+1]||buttons[0];
          if(event.key==="ArrowUp")target=buttons[index-1]||buttons[buttons.length-1];
          if(event.key==="Home")target=buttons[0];
          if(event.key==="End")target=buttons[buttons.length-1];
          if(event.key==="Escape"){state.open=false;render();root.querySelector(".mh-taxonomy-search")?.focus();return;}
          if(target){event.preventDefault();target.focus();}
        });
      });
      root.querySelectorAll("[data-expand]").forEach(button=>button.addEventListener("click",()=>{const id=Number(button.dataset.expand);state.expanded.has(id)?state.expanded.delete(id):state.expanded.add(id);render();root.querySelector('[data-expand="'+id+'"]')?.focus();}));
      root.querySelectorAll("[data-remove]").forEach(button=>button.addEventListener("click",()=>{state.selected=state.selected.filter(item=>selectionKey(item)!==button.dataset.remove);render();notify();}));
      root.querySelector('[data-action="toggle-custom"]')?.addEventListener("click",event=>{const panel=root.querySelector(".mh-taxonomy-custom"),expanded=panel.hasAttribute("hidden");panel.toggleAttribute("hidden",!expanded);event.currentTarget.setAttribute("aria-expanded",String(expanded));if(expanded)panel.querySelector("input")?.focus();});
      root.querySelector('[data-action="resolve-custom"]')?.addEventListener("click",resolveCustom);
      root.querySelector('[data-action="use-proposal"]')?.addEventListener("click",useProposal);
      root.querySelector('[data-action="keep-custom"]')?.addEventListener("click",keepCustom);
      root.querySelector('[data-action="choose-another"]')?.addEventListener("click",()=>{state.proposal=null;state.open=true;render();root.querySelector(".mh-taxonomy-search")?.focus();});
    }
    function selectNode(id){
      const node=state.nodes.find(item=>Number(item.id)===id);if(!node)return;
      const item={interest_kind:state.interestKind,taxonomy_id:id,canonical_name:node.canonical_name,node_type:node.node_type,slug:node.slug};
      if(state.mode==="single")state.selected=[item];
      else if(!selectedIds().has(id))state.selected.push(item);
      state.query="";state.open=false;state.proposal=null;render();notify();
    }
    async function resolveCustom(){
      const input=root.querySelector(".mh-taxonomy-custom input"),value=text(input?.value).trim();
      if(value.length<2){state.error="Enter at least two characters.";render();return;}
      state.loading=true;state.error="";render();
      try{state.proposal=await options.resolve(value);state.proposal.custom_term=value;}
      catch(error){state.error=options.errorMessage||"The category check is temporarily unavailable.";}
      state.loading=false;render();root.querySelector(".mh-taxonomy-custom")?.removeAttribute("hidden");
    }
    function useProposal(){
      const item=state.proposal?.recommended;if(!item)return;
      const node=state.nodes.find(candidate=>Number(candidate.id)===Number(item.canonical_taxonomy_id));
      if(!node){state.error="The suggested category is no longer available.";render();return;}
      selectNode(Number(node.id));
    }
    function keepCustom(){
      const custom=text(state.proposal?.custom_term).trim();if(!custom)return;
      const item={interest_kind:state.interestKind,custom_term:custom};
      if(state.mode==="single")state.selected=[item];
      else if(!state.selected.some(existing=>selectionKey(existing)===selectionKey(item)))state.selected.push(item);
      state.proposal=null;state.open=false;render();notify();
    }
    async function load(){
      state.loading=true;render();
      try{state.nodes=array(await options.search(""));state.error="";}
      catch(error){state.error=options.errorMessage||"Medical product categories could not be loaded.";}
      state.loading=false;render();
      return api;
    }
    function setValue(value){state.selected=array(value).map(item=>({...item,interest_kind:item.interest_kind||state.interestKind}));render();}
    function focus(){root.querySelector(".mh-taxonomy-search")?.focus();}
    const api={load,getValue,setValue,focus,destroy(){root.innerHTML="";}};
    load();return api;
  }

  function productEvidenceHtml(evidence){
    const matches=array(evidence&&evidence.matches);if(!matches.length)return "";
    return '<div class="mh-taxonomy-evidence"><div class="mh-taxonomy-evidence-title">Product taxonomy evidence</div>'+matches.map(match=>'<div class="mh-taxonomy-evidence-row"><span>'+esc(match.offered_name||match.product_name||"Product")+' ↔ '+esc(match.interested_name||match.canonical_name||"Category")+' · '+esc(text(match.relationship||match.score+"%"))+'</span></div>').join("")+'</div>';
  }

  global.MedicHallTaxonomy={createSelector,productEvidenceHtml,escape:esc};
})(globalThis);
