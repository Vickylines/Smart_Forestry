import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveTaxonomy,botanicalFallbacks,createTaxonomyCache,applyCandidateTaxonomy,taxonomyKey,taxonomyUrl} from '../src/domain/taxonomy.ts';
import {emptyState,makeProject,addBatch,saveReview} from '../src/domain/forest.ts';
import {parseRecognition,applyPhotoResult,baiduScientificName} from '../src/domain/recognition.ts';

const taxon=(id,name,common,family,familyZh,genus,genusZh)=>({id,name,matched_term:common,preferred_common_name:common,is_active:true,rank:'species',iconic_taxon_name:'Plantae',ancestors:[{rank:'family',name:family,preferred_common_name:familyZh},{rank:'genus',name:genus,preferred_common_name:genusZh}]});
const ginkgo=taxon(64350,'Ginkgo biloba','银杏','Ginkgoaceae','银杏科','Ginkgo','银杏属');
const eustoma=taxon(880921,'Eustoma russellianum','洋桔梗','Gentianaceae','龙胆科','Eustoma','洋桔梗属');
const empty=op=>op==='wiki-search'?{search:[]}:{results:[],total_results:0};
const inat=(taxa)=>(op,q)=>Promise.resolve(op==='inat-search'?{results:taxa,total_results:taxa.length}:op==='inat-taxa'?{results:taxa}:empty(op));
function gbif(name,family,genus,overrides={}) {return {usage:{key:'example',canonicalName:name},classification:[{rank:'KINGDOM',name:'Plantae'},{rank:'FAMILY',name:family},{rank:'GENUS',name:genus}],diagnostics:{matchType:'EXACT',confidence:99},...overrides};}
test('银杏、洋桔梗：精确中文名得到结构化科属和来源，不需要百科摘要',async()=>{
  for(const t of [ginkgo,eustoma]) {
    const r=await resolveTaxonomy(t.matched_term,'',inat([t]));
    assert.equal(r.family,t.ancestors[0].preferred_common_name);assert.equal(r.genus,t.ancestors[1].preferred_common_name);
    assert.equal(r.taxonomyScientificName,t.name);assert.equal(r.taxonomyStatus,'matched');assert.ok(r.taxonomySourceUrl.endsWith('/'+t.id));
  }
});
test('百科明确学名可消解同名植物，不从不相关百科条目借用学名',()=>{
  assert.equal(baiduScientificName('长寿花',{description:'长寿花（学名：Kalanchoe blossfeldiana Poelln.）为景天科植物。'}),'Kalanchoe blossfeldiana');
  assert.equal(baiduScientificName('银杏',{description:'银杏仁（学名：Prunus argentea）为蔷薇科植物。'}),'');
  assert.equal(parseRecognition({provider:'baidu-plant',candidates:[{name:'长寿花',score:0.9,baikeInfo:{description:'长寿花（学名：Kalanchoe blossfeldiana）为景天科植物。'}}]}).candidates[0].scientificName,'Kalanchoe blossfeldiana');
});
test('跨属杂交形成的已命名杂交属仍可由分类库补全',async()=>{
  const hybrid={...ginkgo,id:415501,name:'× Fatshedera lizei',matched_term:'× Fatshedera lizei',ancestors:[{rank:'family',name:'Araliaceae'},{rank:'genushybrid',name:'× Fatshedera'}]};
  const r=await resolveTaxonomy('×Fatshedera lizei','',inat([hybrid]));
  assert.equal(r.family,'Araliaceae');assert.equal(r.genus,'× Fatshedera');
});
test('完整别名可补搜索摘要省略的名称，但不同科属的别名不能强选',async()=>{
  const request=async op=>{
    if(op==='wiki-search')return {search:[{id:'Q1',label:'Gardenia jasminoides',match:{text:'栀子花'}}]};
    if(op==='wiki-entities')return {entities:{Q1:{aliases:{zh:[{value:'栀子'}]},claims:{P225:[{rank:'normal',mainsnak:{datavalue:{value:'Gardenia jasminoides'}}}]}}}};
    if(op==='gbif-match')return gbif('Gardenia jasminoides','Rubiaceae','Gardenia');return empty(op);
  };
  assert.equal((await resolveTaxonomy('栀子','',request)).genus,'Gardenia');
  assert.equal((await resolveTaxonomy('栀子皮','',request)).genus,undefined);
});
test('分类库忽略品种后给出 EXACT 仍不能声称品种已核实',async()=>{
  const r=await resolveTaxonomy("Eustoma grandiflorum 'Echo Blue'",'',async op=>op==='gbif-match'?gbif('Eustoma russellianum','Gentianaceae','Eustoma',{synonym:true}):empty(op));
  assert.equal(r.genus,'Eustoma');assert.equal(r.taxonomyStatus,'genus');assert.equal(r.taxonomyScientificName,'');
});
test('前缀搜索第一条不能代替精确名称；多条同名只取共同科属',async()=>{
  const unrelated=taxon(1,'Prunus argentea','银杏仁','Rosaceae','蔷薇科','Prunus','李属');
  assert.equal((await resolveTaxonomy('银杏','',inat([unrelated,ginkgo]))).genus,'银杏属');
  assert.equal((await resolveTaxonomy('银杏','',inat([unrelated]))).taxonomyStatus,'not-found');
  const same={...ginkgo,id:2,name:'Ginkgo other'};
  const consensus=await resolveTaxonomy('银杏','',inat([ginkgo,same]));
  assert.equal(consensus.genus,'银杏属');assert.equal(consensus.taxonomyScientificName,'');
  const conflict={...unrelated,matched_term:'银杏'};
  const ambiguous=await resolveTaxonomy('银杏','',inat([ginkgo,conflict]));
  assert.equal(ambiguous.taxonomyStatus,'ambiguous');assert.equal(ambiguous.genus,'');assert.equal(ambiguous.family,'');
});
test('园艺栽培名可退回基础种/属，跨属杂交公式不得截取首个亲本',async()=>{
  assert.deepEqual(botanicalFallbacks("Acer palmatum 'Atropurpureum'"),['Acer palmatum','Acer']);
  assert.deepEqual(botanicalFallbacks('Cattleya × Laelia'),[]);
  assert.deepEqual(botanicalFallbacks('红掌'),[]);
  assert.deepEqual(botanicalFallbacks('× Fatshedera lizei'),['× Fatshedera']);
  const maple=taxon(4,'Acer palmatum','鸡爪槭','Sapindaceae','无患子科','Acer','槭属');
  const r=await resolveTaxonomy("Acer palmatum 'Atropurpureum'",'',(op,q)=>op==='inat-search'&&q!=='Acer palmatum'?Promise.resolve(empty(op)):inat([maple])(op,q));
  assert.equal(r.genus,'槭属');assert.equal(r.taxonomyStatus,'genus');assert.equal(r.taxonomyScientificName,'');
});
test('学名异名精确匹配；非植物、模糊匹配和不一致的学名不自动填入',async()=>{
  const synonym={...eustoma,matched_term:'Eustoma grandiflorum'};
  assert.equal((await resolveTaxonomy('洋桔梗','Eustoma grandiflorum',inat([synonym]))).taxonomyScientificName,'Eustoma russellianum');
  for(const data of [gbif('Bad name','F','G',{diagnostics:{matchType:'FUZZY',confidence:99}}),gbif('Bad name','F','G',{classification:[{rank:'KINGDOM',name:'Animalia'}]})]) {
    const r=await resolveTaxonomy('Bad name','Bad name',(op)=>Promise.resolve(op==='gbif-match'?data:empty(op)));
    assert.equal(r.genus,undefined);
  }
});
test('iNaturalist 不可用时用 GBIF，Wikidata 仅接受精确别名并核实植物分类',async()=>{
  const r=await resolveTaxonomy('银杏','Ginkgo biloba',async op=>{if(op.startsWith('inat'))throw new Error('offline');return gbif('Ginkgo biloba','Ginkgoaceae','Ginkgo');});
  assert.equal(r.genus,'Ginkgo');assert.equal(r.taxonomyStatus,'matched');
  const bridge=await resolveTaxonomy('银杏','',async op=>{
    if(op==='wiki-search')return {search:[{id:'Q1',label:'Ginkgo biloba',match:{text:'银杏'}}]};
    if(op==='wiki-entities')return {entities:{Q1:{claims:{P225:[{rank:'normal',mainsnak:{datavalue:{value:'Ginkgo biloba'}}}]}}}};
    if(op==='gbif-match')return gbif('Ginkgo biloba','Ginkgoaceae','Ginkgo');return empty(op);
  });
  assert.equal(bridge.genus,'Ginkgo');assert.ok(bridge.taxonomySource.includes('Wikidata'));
  assert.equal((await resolveTaxonomy('银杏','',async()=>{throw new Error('timeout');})).taxonomyStatus,'unavailable');
});
test('重复名称共用进行中的查询、缓存可恢复；网络错误只短暂缓存，存储满不影响结果',async()=>{
  let calls=0,clock=0,saved;
  const lookup=createTaxonomyCache(async()=>{calls++;return {family:'银杏科',genus:'银杏属',taxonomyStatus:'matched'};},{read:()=>[],write:value=>{saved=value;}},()=>clock);
  await Promise.all([lookup('银杏'),lookup('银杏')]);assert.equal(calls,1);
  await lookup(' 银杏 ');assert.equal(calls,1);
  const restored=createTaxonomyCache(async()=>{throw new Error('should be cached');},{read:()=>saved,write:()=>{}},()=>clock);
  assert.equal((await restored('银杏')).genus,'银杏属');
  await lookup('银杏','',true);assert.equal(calls,2);
  let failures=0;
  const retry=createTaxonomyCache(async()=>{failures++;return {taxonomyStatus:'unavailable'};},{read:()=>[],write:()=>{throw new Error('full');}},()=>clock);
  await retry('洋桔梗');await retry('洋桔梗');assert.equal(failures,1);clock=61000;await retry('洋桔梗');assert.equal(failures,2);
});
test('已有记录补查会持久化每张照片的候选，保留人工结论和有意留空',()=>{
  let state=makeProject(emptyState(),'测试','');state=addBatch(state,state.projects[0].id,[{id:'p1',uri:'idb:p1',name:'1.jpg',bytes:1}],true,false);
  const id=state.observations[0].id,job=state.jobs[0].id;
  state=applyPhotoResult(state,job,id,'p1',parseRecognition({provider:'baidu-plant',candidates:[{name:'银杏',score:0.95}]}));
  state=saveReview(state,id,0,{decision:'confirmed',name:'银杏',scientificName:'',family:'手填科',genus:'',note:'保留'});
  const before=structuredClone(state.observations[0]);
  const after=applyCandidateTaxonomy(state,id,taxonomyKey('银杏'),{family:'银杏科',genus:'银杏属',taxonomyStatus:'matched'}).observations[0];
  assert.equal(after.candidates[0].genus,'银杏属');assert.equal(after.recognitionPhotos.p1.candidates[0].genus,'银杏属');
  assert.equal(after.confirmedFamily,'手填科');assert.equal(after.confirmedGenus,'');assert.equal(after.revision,before.revision);assert.deepEqual(after.reviews,before.reviews);
  assert.deepEqual(state.observations[0],before);
});
test('重新补查未匹配时清除旧候选分类，网络失败保留已知值和人工复核',()=>{
  let state=makeProject(emptyState(),'重查','');
  state=addBatch(state,state.projects[0].id,[{id:'p1',uri:'idb:p1',name:'1.jpg',bytes:1}],true,false);
  const id=state.observations[0].id,job=state.jobs[0].id,key=taxonomyKey('银杏');
  state=applyPhotoResult(state,job,id,'p1',parseRecognition({provider:'baidu-plant',candidates:[{name:'银杏',score:.8}]}));
  state=applyCandidateTaxonomy(state,id,key,{family:'银杏科',genus:'银杏属',taxonomyScientificName:'Ginkgo biloba',taxonomySource:'旧分类库',taxonomyEvidence:'旧结果',taxonomyStatus:'matched',taxonomyCheckedAt:'2026-09-07T00:00:00Z'});
  state=saveReview(state,id,0,{decision:'confirmed',name:'银杏',scientificName:'Ginkgo biloba',family:'人工科',genus:'人工属',note:'已复核'});
  const unavailable=applyCandidateTaxonomy(state,id,key,{taxonomyStatus:'unavailable',taxonomyCheckedAt:'2026-09-09T00:00:00Z'});
  assert.equal(unavailable.observations[0].candidates[0].genus,'银杏属');
  for(const status of ['not-found','ambiguous']) {
    const next=applyCandidateTaxonomy(state,id,key,{taxonomyStatus:status,taxonomyCheckedAt:'2026-09-09T00:00:00Z'}).observations[0];
    for(const c of [next.candidates[0],next.recognitionPhotos.p1.candidates[0]]) {
      assert.equal(c.genus,'','A definitive failed match must not retain a stale genus');
      assert.equal(c.taxonomyScientificName,'');assert.equal(c.taxonomySource,'');
    }
    assert.equal(next.confirmedGenus,'人工属');assert.deepEqual(next.reviews,state.observations[0].reviews);
  }
});

test('同株后续照片得分更高时保留同名候选已补全科属，不串用其他名称',()=>{
  let state=makeProject(emptyState(),'同株','');
  state=addBatch(state,state.projects[0].id,['p1','p2','p3'].map(id=>({id,uri:'idb:'+id,name:id+'.jpg',bytes:1})),true,false);
  const id=state.observations[0].id,job=state.jobs[0].id;
  const result=score=>parseRecognition({provider:'baidu-plant',candidates:[{name:'银杏',score}]});
  state=applyPhotoResult(state,job,id,'p1',result(.7));
  state=applyCandidateTaxonomy(state,id,taxonomyKey('银杏'),{family:'银杏科',genus:'银杏属',taxonomyScientificName:'Ginkgo biloba',taxonomyStatus:'matched',taxonomyCheckedAt:'2026-09-09T00:00:00Z'});
  state=applyPhotoResult(state,job,id,'p2',result(.95));
  assert.equal(state.observations[0].candidates[0].score,.95);
  assert.equal(state.observations[0].candidates[0].photoId,'p2');
  assert.equal(state.observations[0].candidates[0].genus,'银杏属');
  assert.equal(state.observations[0].recognitionPhotos.p2.candidates[0].genus,'银杏属');
  state=applyPhotoResult(state,job,id,'p3',parseRecognition({provider:'baidu-plant',candidates:[{name:'另一植物',score:.99}]}));
  assert.equal(state.observations[0].candidates[0].name,'另一植物');
  assert.equal(state.observations[0].candidates[0].genus,'');
  assert.equal(state.jobs[0].status,'completed');
});

test('分类查询地址限定为固定公共接口，ID 参数不可注入其他路径',()=>{
  assert.throws(()=>taxonomyUrl('inat-taxa','1/../../private'));
  assert.throws(()=>taxonomyUrl('wiki-entities','Q1&token=x'));
  assert.throws(()=>taxonomyUrl('arbitrary-url','https://example.com'));
  const url=new URL(taxonomyUrl('inat-search','银杏&photos=secret'));
  assert.equal(url.hostname,'api.inaturalist.org');assert.equal(url.searchParams.get('q'),'银杏&photos=secret');assert.equal(url.searchParams.get('photos'),null);
});
