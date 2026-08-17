(function(root){
  "use strict";

  const VERSION = 1;
  const STORAGE_PREFIX = "mh_product_draft_v1";
  const FILE_KINDS = new Set(["image", "brochure"]);

  const safeString = (value, max=4000) => String(value == null ? "" : value).slice(0, max);
  const safeContext = context => {
    const userId = safeString(context && context.userId, 160);
    const companyId = safeString(context && context.companyId, 160);
    return userId && companyId ? {userId, companyId} : null;
  };
  const keyFor = context => {
    const safe = safeContext(context);
    return safe ? `${STORAGE_PREFIX}:${encodeURIComponent(safe.userId)}:${encodeURIComponent(safe.companyId)}` : null;
  };
  const safeTaxonomy = value => {
    if(!value || typeof value !== "object") return null;
    const taxonomyId = Number(value.taxonomy_id);
    const result = {
      taxonomy_id: Number.isFinite(taxonomyId) ? taxonomyId : null,
      canonical_name: safeString(value.canonical_name, 300),
      node_type: safeString(value.node_type, 80),
      slug: safeString(value.slug, 200),
      custom_term: safeString(value.custom_term, 300)
    };
    return result.taxonomy_id || result.slug || result.custom_term ? result : null;
  };
  const safeKinds = values => [...new Set((Array.isArray(values) ? values : [])
    .map(value=>safeString(value, 40)).filter(value=>FILE_KINDS.has(value)))];
  const safeUploads = values => [...new Set((Array.isArray(values) ? values : [])
    .map(value=>safeString(value, 2048)).filter(Boolean))].slice(0, 6);

  function createController(options={}){
    const storage = options.storage;
    const fieldIds = [...new Set(Array.isArray(options.fieldIds) ? options.fieldIds.map(value=>safeString(value, 100)).filter(Boolean) : [])];
    const debounceMs = Math.max(0, Number(options.debounceMs) || 750);
    const setTimer = options.setTimeoutFn || setTimeout;
    const clearTimerFn = options.clearTimeoutFn || clearTimeout;
    const now = options.now || (()=>Date.now());
    const state = {
      context:null, mode:"create", baseline:null, current:null, dirty:false,
      stagedUploads:new Set(), reselectKinds:new Set(), pendingByKind:new Map(), timer:null
    };

    function normalizeSnapshot(snapshot, reselectKinds=state.reselectKinds){
      const source = snapshot && snapshot.fields && typeof snapshot.fields === "object" ? snapshot.fields : {};
      const fields = {};
      fieldIds.forEach(id=>{ fields[id] = safeString(source[id]); });
      return {fields, taxonomy:safeTaxonomy(snapshot && snapshot.taxonomy), reselect_kinds:safeKinds([...reselectKinds])};
    }
    const comparable = snapshot => JSON.stringify(normalizeSnapshot(snapshot, snapshot && snapshot.reselect_kinds));
    function clearTimer(){
      if(state.timer != null) clearTimerFn(state.timer);
      state.timer = null;
    }
    function removeStored(context=state.context){
      const key = keyFor(context);
      if(!key || !storage) return;
      try{ storage.removeItem(key); }catch(_error){}
    }
    function payload(){
      if(!state.context || !state.current) return null;
      return {
        version:VERSION,
        user_id:state.context.userId,
        company_id:state.context.companyId,
        saved_at:new Date(now()).toISOString(),
        fields:state.current.fields,
        taxonomy:state.current.taxonomy,
        staged_uploads:safeUploads([...state.stagedUploads]),
        reselect_kinds:safeKinds([...state.reselectKinds])
      };
    }
    function flush(){
      clearTimer();
      if(state.mode !== "create" || !state.dirty || !storage) return false;
      const key = keyFor(state.context), value = payload();
      if(!key || !value) return false;
      try{ storage.setItem(key, JSON.stringify(value)); return true; }catch(_error){ return false; }
    }
    function schedule(){
      clearTimer();
      if(state.mode !== "create" || !state.dirty) return;
      state.timer = setTimer(()=>{ state.timer=null; flush(); }, debounceMs);
    }
    function update(snapshot, options={}){
      state.current = normalizeSnapshot(snapshot);
      state.dirty = Boolean(state.baseline && comparable(state.current) !== comparable(state.baseline));
      if(state.mode === "create"){
        if(state.dirty && options.persist !== false) schedule();
        else if(!state.dirty) removeStored();
      }
      return state.dirty;
    }
    function load(context){
      const safe = safeContext(context), key = keyFor(safe);
      if(!safe || !key || !storage) return null;
      try{
        const parsed = JSON.parse(storage.getItem(key) || "null");
        if(!parsed || parsed.version !== VERSION || safeString(parsed.user_id,160) !== safe.userId || safeString(parsed.company_id,160) !== safe.companyId) return null;
        return {
          fields:normalizeSnapshot({fields:parsed.fields,taxonomy:parsed.taxonomy,reselect_kinds:parsed.reselect_kinds}, safeKinds(parsed.reselect_kinds)).fields,
          taxonomy:safeTaxonomy(parsed.taxonomy),
          staged_uploads:safeUploads(parsed.staged_uploads),
          reselect_kinds:safeKinds(parsed.reselect_kinds),
          saved_at:safeString(parsed.saved_at,80)
        };
      }catch(_error){ return null; }
    }
    function start({context, mode="create", baseline, current, loadedDraft=null}){
      clearTimer();
      state.context = safeContext(context);
      state.mode = mode === "edit" ? "edit" : "create";
      state.stagedUploads = new Set(safeUploads(loadedDraft && loadedDraft.staged_uploads));
      state.reselectKinds = new Set(safeKinds(loadedDraft && loadedDraft.reselect_kinds));
      state.pendingByKind = new Map();
      state.baseline = normalizeSnapshot(baseline, []);
      state.current = normalizeSnapshot(current || baseline);
      state.dirty = comparable(state.current) !== comparable(state.baseline);
      if(state.mode === "create" && state.dirty) schedule();
      else if(state.mode === "create") removeStored();
      return state.dirty;
    }
    function uploadSelected(kind, snapshot){
      if(!FILE_KINDS.has(kind)) return state.dirty;
      state.pendingByKind.set(kind, (state.pendingByKind.get(kind) || 0) + 1);
      state.reselectKinds.add(kind);
      return update(snapshot);
    }
    function finishPending(kind){
      const count = Math.max(0, (state.pendingByKind.get(kind) || 0) - 1);
      if(count) state.pendingByKind.set(kind, count);
      else state.pendingByKind.delete(kind);
      return count;
    }
    function uploadSucceeded(kind, url, snapshot){
      if(!FILE_KINDS.has(kind)) return state.dirty;
      if(!finishPending(kind)) state.reselectKinds.delete(kind);
      const safeUrl = safeString(url, 2048);
      if(safeUrl) state.stagedUploads.add(safeUrl);
      return update(snapshot);
    }
    function uploadFailed(kind, snapshot){
      if(!FILE_KINDS.has(kind)) return state.dirty;
      finishPending(kind);
      state.reselectKinds.add(kind);
      return update(snapshot);
    }
    function removeUpload(url, snapshot){
      state.stagedUploads.delete(safeString(url,2048));
      return update(snapshot);
    }
    function closeAction(source){
      if(!state.dirty) return "close";
      return source === "backdrop" ? "stay" : "confirm";
    }
    function discard(){
      const uploads = [...state.stagedUploads];
      clearTimer();
      if(state.mode === "create") removeStored();
      state.dirty = false;
      state.stagedUploads.clear();
      state.reselectKinds.clear();
      state.pendingByKind.clear();
      return uploads;
    }
    function saveSucceeded(){
      clearTimer();
      if(state.mode === "create") removeStored();
      state.dirty = false;
      state.stagedUploads.clear();
      state.reselectKinds.clear();
      state.pendingByKind.clear();
    }
    function saveFailed(snapshot){
      update(snapshot);
      flush();
      return state.dirty;
    }
    function end(){
      clearTimer();
      state.context=null;state.baseline=null;state.current=null;state.dirty=false;
      state.stagedUploads.clear();state.reselectKinds.clear();state.pendingByKind.clear();
    }

    return {
      load,start,update,flush,uploadSelected,uploadSucceeded,uploadFailed,removeUpload,
      closeAction,discard,saveSucceeded,saveFailed,end,
      get dirty(){ return state.dirty; },
      get mode(){ return state.mode; },
      get storageAvailable(){ return Boolean(storage); },
      get pendingUploads(){ return [...state.pendingByKind.values()].reduce((sum,value)=>sum+value,0); },
      get stagedUploads(){ return [...state.stagedUploads]; },
      get reselectKinds(){ return [...state.reselectKinds]; }
    };
  }

  root.MedicHallProductDraft = {VERSION, STORAGE_PREFIX, keyFor, safeTaxonomy, createController};
})(globalThis);
