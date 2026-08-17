import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const moduleSource = readFileSync(new URL("medichall-product-draft.js", root), "utf8");
const portalSource = readFileSync(new URL("portal.html", root), "utf8");

function loadModule(){
  const sandbox = {globalThis:null,setTimeout,clearTimeout,URL,Date};
  sandbox.globalThis=sandbox;
  vm.runInNewContext(moduleSource,sandbox,{filename:"medichall-product-draft.js"});
  return sandbox.MedicHallProductDraft;
}
class MemoryStorage{
  constructor(){this.values=new Map();}
  getItem(key){return this.values.has(key)?this.values.get(key):null;}
  setItem(key,value){this.values.set(key,String(value));}
  removeItem(key){this.values.delete(key);}
}
const fields=["p-name","p-cat","p-img","p-broch","p-specifications"];
const contextA={userId:"user-a",companyId:"company-a"};
const contextB={userId:"user-b",companyId:"company-b"};
const clean={fields:{"p-name":"","p-cat":"Medical Devices","p-img":"","p-broch":"","p-specifications":""},taxonomy:null};
const changed=(overrides={})=>({fields:{...clean.fields,...overrides},taxonomy:null});

function controller(storage=new MemoryStorage()){
  return loadModule().createController({storage,fieldIds:fields,debounceMs:750});
}

test("A: clean product form may close from its backdrop",()=>{
  const draft=controller();
  draft.start({context:contextA,baseline:clean,current:clean});
  assert.equal(draft.dirty,false);
  assert.equal(draft.closeAction("backdrop"),"close");
});

test("B: dirty text plus backdrop stays open and is recoverable",()=>{
  const storage=new MemoryStorage(),draft=controller(storage);
  draft.start({context:contextA,baseline:clean,current:clean});
  draft.update(changed({"p-name":"Sterile surgical drape"}));
  draft.flush();
  assert.equal(draft.closeAction("backdrop"),"stay");
  assert.equal(draft.load(contextA).fields["p-name"],"Sterile surgical drape");
});

test("C and mobile file-picker return: image selection is dirty without losing text",()=>{
  const draft=controller();
  draft.start({context:contextA,baseline:clean,current:changed({"p-name":"Probe cover"})});
  draft.uploadSelected("image",changed({"p-name":"Probe cover"}));
  assert.equal(draft.closeAction("backdrop"),"stay");
  assert.equal(draft.pendingUploads,1);
  draft.uploadSucceeded("image","https://example.test/products/image.png",changed({"p-name":"Probe cover","p-img":"https://example.test/products/image.png"}));
  assert.equal(draft.pendingUploads,0);
  assert.equal(draft.stagedUploads.length,1);
  draft.flush();
  assert.equal(draft.load(contextA).fields["p-name"],"Probe cover");
});

test("D: brochure selection makes the form dirty and backdrop-safe",()=>{
  const draft=controller();
  draft.start({context:contextA,baseline:clean,current:clean});
  draft.uploadSelected("brochure",clean);
  assert.equal(draft.closeAction("backdrop"),"stay");
  assert.deepEqual(Array.from(draft.reselectKinds),["brochure"]);
});

test("E and F: Escape and X require an intentional discard confirmation",()=>{
  const draft=controller();
  draft.start({context:contextA,baseline:clean,current:changed({"p-specifications":"Latex-free"})});
  assert.equal(draft.closeAction("escape"),"confirm");
  assert.equal(draft.closeAction("close"),"confirm");
  assert.equal(draft.closeAction("cancel"),"confirm");
});

test("G: choosing keep editing does not mutate fields or dirty state",()=>{
  const draft=controller();
  const current=changed({"p-name":"Autoclave tape"});
  draft.start({context:contextA,baseline:clean,current});
  draft.closeAction("escape");
  assert.equal(draft.dirty,true);
  draft.flush();
  assert.equal(draft.load(contextA).fields["p-name"],"Autoclave tape");
});

test("H: discard clears only after confirmation and returns staged uploads for cleanup",()=>{
  const storage=new MemoryStorage(),draft=controller(storage);
  const image="https://example.test/products/new.png";
  draft.start({context:contextA,baseline:clean,current:changed({"p-name":"Drape"})});
  draft.uploadSelected("image",changed({"p-name":"Drape"}));
  draft.uploadSucceeded("image",image,changed({"p-name":"Drape","p-img":image}));
  draft.flush();
  assert.ok(draft.load(contextA));
  assert.deepEqual(Array.from(draft.discard()),[image]);
  assert.equal(draft.load(contextA),null);
  assert.equal(draft.dirty,false);
});

test("I: failed save preserves populated draft and dirty state",()=>{
  const storage=new MemoryStorage(),draft=controller(storage);
  const current=changed({"p-name":"Failed save remains","p-specifications":"Non-woven"});
  draft.start({context:contextA,baseline:clean,current});
  assert.equal(draft.saveFailed(current),true);
  assert.equal(draft.load(contextA).fields["p-specifications"],"Non-woven");
  assert.equal(draft.dirty,true);
});

test("J: successful save clears the company-scoped draft",()=>{
  const storage=new MemoryStorage(),draft=controller(storage);
  draft.start({context:contextA,baseline:clean,current:changed({"p-name":"Saved"})});
  draft.flush();
  draft.saveSucceeded();
  assert.equal(draft.load(contextA),null);
  assert.equal(draft.dirty,false);
});

test("editing an existing product never deletes a separate unfinished new-product draft",()=>{
  const storage=new MemoryStorage(),newProduct=controller(storage);
  newProduct.start({context:contextA,baseline:clean,current:changed({"p-name":"Unfinished new product"})});
  newProduct.flush();
  const editProduct=controller(storage);
  editProduct.start({context:contextA,mode:"edit",baseline:clean,current:changed({"p-name":"Existing product edit"})});
  editProduct.saveSucceeded();
  assert.equal(newProduct.load(contextA).fields["p-name"],"Unfinished new product");
});

test("K and L: reopening or refreshing restores the bounded text draft",()=>{
  const storage=new MemoryStorage(),first=controller(storage);
  first.start({context:contextA,baseline:clean,current:changed({"p-name":"Recover me"})});
  first.flush();
  const second=controller(storage),saved=second.load(contextA);
  assert.equal(saved.fields["p-name"],"Recover me");
  assert.deepEqual(Object.keys(saved.fields),fields);
});

test("M: company and account keys prevent cross-company draft disclosure",()=>{
  const storage=new MemoryStorage(),draft=controller(storage);
  draft.start({context:contextA,baseline:clean,current:changed({"p-name":"Company A only"})});
  draft.flush();
  assert.equal(draft.load(contextB),null);
  assert.equal(loadModule().keyFor(contextA)===loadModule().keyFor(contextB),false);
});

test("upload failure preserves form values and requests truthful file reselection",()=>{
  const storage=new MemoryStorage(),draft=controller(storage);
  const current=changed({"p-name":"Keep on upload failure"});
  draft.start({context:contextA,baseline:clean,current});
  draft.uploadSelected("image",current);
  draft.uploadFailed("image",current);
  draft.flush();
  const saved=draft.load(contextA);
  assert.equal(saved.fields["p-name"],"Keep on upload failure");
  assert.deepEqual(Array.from(saved.reselect_kinds),["image"]);
});

test("N: portal initializes one product guard and wires every intentional exit safely",()=>{
  assert.equal((portalSource.match(/\ninitProductDraftGuard\(\);/g)||[]).length,1);
  assert.match(portalSource,/id="productModal" onclick="handleProductBackdrop\(event\)"/);
  assert.match(portalSource,/onclick="requestProductClose\('close'\)" aria-label="Close product form"/);
  assert.match(portalSource,/onclick="requestProductClose\('cancel'\)"/);
  assert.match(portalSource,/requestProductClose\("escape"\)/);
  assert.match(portalSource,/window\.addEventListener\("beforeunload"/);
  assert.doesNotMatch(portalSource,/id="productModal" onclick="if\(event\.target===this\)closeModals\(\)"/);
});

test("confirmation, save outcomes, focus and responsive contracts remain explicit",()=>{
  assert.match(portalSource,/role="alertdialog"[^>]+aria-modal="true"/);
  assert.match(portalSource,/You have unsaved changes\./);
  assert.match(portalSource,/If you leave now, the product information you've entered will be lost\./);
  assert.match(portalSource,/>Keep editing</);
  assert.match(portalSource,/>Discard changes</);
  assert.match(portalSource,/PRODUCT_DRAFT_GUARD\.saveSucceeded\(\);\s*closeProductModalInternal\(\)/);
  assert.match(portalSource,/catch\(e\)\{\s*PRODUCT_DRAFT_GUARD\.saveFailed\(productDraftSnapshot\(\)\)/);
  assert.match(portalSource,/dialog\.inert=true/);
  assert.match(portalSource,/trapProductModalFocus/);
  assert.match(portalSource,/body\.product-modal-open\{overflow:hidden\}/);
  assert.match(portalSource,/max-height:calc\(100dvh - 40px\)/);
  assert.match(portalSource,/@media\(max-width:560px\)[\s\S]*?max-height:calc\(100dvh - 24px\)/);
});

test("dirty tracking covers every current product value including taxonomy and uploads",()=>{
  for(const id of [
    "p-ref","p-cat","p-name","p-desc","p-normalized-cat","p-subtype","p-material","p-dimensions",
    "p-specifications","p-sterility","p-use-type","p-sterilization-method","p-packaging","p-units",
    "p-certifications","p-regulatory-class","p-capacity","p-capacity-unit","p-capacity-period","p-img","p-broch"
  ]) assert.match(portalSource,new RegExp(`"${id}"`),id);
  assert.match(portalSource,/taxonomy:productDraftTaxonomy\(\)/);
  assert.match(portalSource,/uploadSelected\("image"/);
  assert.match(portalSource,/uploadSelected\("brochure"/);
});

test("the local draft payload cannot include authentication or provider credentials",()=>{
  assert.doesNotMatch(moduleSource,/access_token|refresh_token|service_role|SUPABASE_SERVICE_ROLE_KEY|RESEND_API_KEY|ANTHROPIC_API_KEY|DAILY_API_KEY/i);
  assert.match(moduleSource,/fields:state\.current\.fields/);
  assert.match(moduleSource,/company_id:state\.context\.companyId/);
  assert.match(moduleSource,/user_id:state\.context\.userId/);
});

test("staged upload cleanup is restricted to the active product draft scope",()=>{
  assert.match(portalSource,/uploadFile\(file, "products", "product-draft"\)/);
  assert.match(portalSource,/uploadFile\(file, "brochures", "product-draft"\)/);
  assert.match(portalSource,/const productScope=USER&&COMPANY/);
  assert.match(portalSource,/\^\(\?:products\|brochures\)\//);
  assert.match(portalSource,/method:"DELETE"/);
});
