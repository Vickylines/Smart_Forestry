import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyState, removeExamples, deleteProject, makeProject, addBatch, saveReview, projectStats, exportProjectCsv} from '../src/domain/forest.ts';
import {serviceUrl,parseRecognition,applyPhotoResult,migrateTasks} from '../src/domain/recognition.ts';
import {makeZip} from '../src/domain/zip.ts';
import {createRequire} from 'node:module';
const Zip=createRequire(import.meta.url)('adm-zip');

const photo = (id, demo = false) => ({id, uri: demo ? '/static/leaf-1.svg' : 'idb:' + id, name:id + '.jpg', bytes:100});
function project() { return makeProject(emptyState(), '测试调查', '测试场地'); }
function fixture() {
  const state=project(); state.projects[0].id='fixture-project';
  const batch=addBatch(state,'fixture-project',[photo('a'),photo('b')],false);
  batch.observations[0].id='fixture-observation-0';batch.observations[1].id='fixture-observation-1';
  return batch;
}

test('多张同株照片只创建一条观察；分株照片分别创建', () => {
  const state = project();
  const grouped = addBatch(state, state.projects[0].id, [photo('a'),photo('b')], true, false);
  assert.equal(grouped.observations.length,1);
  assert.equal(projectStats(grouped).photos,2);
  const separate = addBatch(state, state.projects[0].id, [photo('a'),photo('b')], false, false);
  assert.equal(separate.observations.length,2);
  assert.equal(state.observations.length,0);
});
test('用户照片绝不会得到伪造的示例候选', () => {
  const state = project();
  const batch = addBatch(state,state.projects[0].id,[photo('user')],false,false);
  const done = batch;
  assert.equal(done.jobs[0].status,'queued');
  assert.equal(done.observations[0].recognitionStatus,'pending');
  assert.deepEqual(done.observations[0].candidates,[]);
  assert.equal(done.observations[0].reviewStatus,'pending');
});
test('逐图识别持久化，同株照片全部完成才完成观察；不覆盖人工结论',()=>{
  let state=project();state=addBatch(state,state.projects[0].id,[photo('a'),photo('b')],true,false,'外业备注');
  const job=state.jobs[0],item=state.observations[0];
  state=saveReview(state,item.id,0,{decision:'confirmed',name:'人工结果',scientificName:'',note:'保留备注'});
  const result=parseRecognition({provider:'test fixture',candidates:[{name:'候选一',score:.7}]});
  state=applyPhotoResult(state,job.id,item.id,'a',result);
  assert.equal(state.jobs[0].processed,0);assert.equal(state.observations[0].confirmedName,'人工结果');
  assert.equal(state.observations[0].reviews.length,1);
  assert.equal(applyPhotoResult(state,job.id,item.id,'a',result),state);
  state=applyPhotoResult(state,job.id,item.id,'b',parseRecognition({provider:'test fixture',candidates:[]}));
  assert.equal(state.jobs[0].status,'completed');assert.equal(state.jobs[0].processed,1);
  assert.equal(state.observations[0].recognitionStatus,'succeeded');
  assert.throws(()=>applyPhotoResult(state,job.id,item.id,'wrong',result),/不匹配/);
});
test('服务配置与返回值严格校验，空候选是有效结果',()=>{
  assert.equal(serviceUrl(' https://example.org/api/ '),'https://example.org/api');
  for(const value of ['http://example.org','https://a:b@example.org','https://example.org?a=b','broken'])assert.throws(()=>serviceUrl(value));
  for(const score of [null,'0.8',NaN,Infinity,-1,1.2])assert.throws(()=>parseRecognition({provider:'test',candidates:[{name:'测试',score}]}));
  assert.throws(()=>parseRecognition({provider:'test',candidates:[{name:'',score:.8}]}));
  assert.deepEqual(parseRecognition({provider:'test',candidates:[]}).candidates,[]);
  assert.deepEqual(parseRecognition({provider:'baidu-plant',candidates:[{name:'非植物',score:.8}]}).candidates,[]);
});
test('旧用户任务迁移，运行中重启后暂停并保留已完成照片',()=>{
  let state=project();state=addBatch(state,state.projects[0].id,[photo('a')],false,false);
  state.jobs[0].engine='demo';state.jobs[0].status='completed';
  state=migrateTasks(state);assert.equal(state.jobs[0].engine,'service');assert.equal(state.jobs[0].status,'queued');
  state.jobs[0].status='running';assert.equal(migrateTasks(state).jobs[0].status,'paused');
});
test('资料包可以用独立ZIP读取器解压，中文名与照片字节不变',async()=>{
  const bytes=Buffer.from([0,255,37,21,8,0,132]);
  const blob=await makeZip([{name:'观察记录.csv',blob:new Blob(['中文,测试\r\n'])},{name:'photos/a.png',blob:new Blob([bytes])}]);
  const zip=new Zip(Buffer.from(await blob.arrayBuffer()));
  assert.equal(zip.readAsText('观察记录.csv'),'中文,测试\r\n');assert.deepEqual(zip.readFile('photos/a.png'),bytes);
  assert.equal(zip.test(),true);await assert.rejects(()=>makeZip([{name:'../escape',blob:new Blob(['a'])}]));
});
test('复核更新保留历史，过时修订会被拒绝', () => {
  const state = fixture();
  const item = state.observations[1];
  const reviewed = saveReview(state,item.id,0,{decision:'confirmed',name:'人工核对名称',scientificName:'Example taxon',note:'人工复核'});
  assert.equal(reviewed.observations[1].confirmedName,'人工核对名称');
  assert.equal(reviewed.observations[1].reviews.length,1);
  assert.throws(() => saveReview(reviewed,item.id,0,{decision:'confirmed',name:'覆盖',scientificName:'',note:''}), /记录已更新/);
  const unknown = saveReview(reviewed,item.id,1,{decision:'undetermined',name:'应清空',scientificName:'应清空',note:'需补拍'});
  assert.equal(unknown.observations[1].confirmedName,'');
  assert.equal(unknown.observations[1].reviews.length,2);
});
test('未确定的观察不进入已确认名称统计', () => {
  const state = fixture();
  const revised = saveReview(state,'fixture-observation-0',0,{decision:'undetermined',name:'',scientificName:'',note:''});
  assert.equal(projectStats(revised).species,0);
});
test('CSV保留复核状态并防止公式注入', () => {
  const state = fixture();
  const revised = saveReview(state,'fixture-observation-1',0,{decision:'confirmed',name:'=HYPERLINK("example")',scientificName:'',note:'两行\n带逗号,与引号"'});
  const csv = exportProjectCsv(revised,'fixture-project');
  assert.ok(csv.includes('用户照片'));
  assert.ok(csv.includes('已确认'));
  assert.ok(csv.includes("'=HYPERLINK"));
  assert.ok(csv.includes('两行\n带逗号,与引号""'));
});
test('无效项目、空批次、空确认名称均被拒绝', () => {
  const state = fixture();
  assert.throws(() => makeProject(state,'  ',''),/项目名称/);
  assert.throws(() => addBatch(state,'missing',[photo('a')],false,false),/项目不存在/);
  assert.throws(() => addBatch(state,'fixture-project',[],false,false),/选择照片/);
  assert.throws(() => saveReview(state,'fixture-observation-1',0,{decision:'confirmed',name:' ',scientificName:'',note:''}),/填写或选择名称/);
});

test('首次启动为空，移除旧示例但保留其中的真实资料及复核',()=>{
  assert.deepEqual(emptyState(),{schemaVersion:1,projects:[],observations:[],jobs:[]});
  let state=fixture(); state.projects[0].isDemo=true;
  state=saveReview(state,state.observations[0].id,0,{decision:'confirmed',name:'真实复核',scientificName:'',note:'保留'});
  state.observations[1].isDemo=true;
  state.jobs[0].observationIds=state.observations.map(o=>o.id);
  state.projects.push({id:'pure-example',name:'旧示例',location:'',createdAt:'',isDemo:true});
  const migrated=removeExamples(state);
  assert.equal(migrated.projects.length,1);assert.equal(migrated.projects[0].isDemo,false);
  assert.equal(migrated.observations.length,1);assert.equal(migrated.observations[0].confirmedName,'真实复核');
  assert.equal(migrated.observations[0].reviews.length,1);
  assert.deepEqual(migrated.jobs[0].observationIds,[state.observations[0].id]);
  assert.deepEqual(removeExamples(migrated),migrated);
});
test('删除项目同时移除关联记录与任务，保留其他项目，拒绝运行中的删除',()=>{
  let state=project();const first=state.projects[0].id;
  state=addBatch(state,first,[photo('a')],false);
  state=makeProject(state,'保留项目','');const second=state.projects[0].id;
  state=addBatch(state,second,[photo('b')],false);
  const original=structuredClone(state);const job=state.jobs.find(j=>j.projectId===first);
  assert.throws(()=>deleteProject(state,first,job.id),/识别/);
  job.status='running';assert.throws(()=>deleteProject(state,first),/识别/);job.status='queued';
  const deleted=deleteProject(state,first);
  assert.equal(deleted.projects.length,1);assert.equal(deleted.projects[0].id,second);
  assert.equal(deleted.observations.length,1);assert.equal(deleted.observations[0].photos[0].id,'b');
  assert.equal(deleted.jobs.length,1);assert.equal(deleted.jobs[0].projectId,second);
  assert.deepEqual(state,original);assert.throws(()=>deleteProject(state,'missing'),/不存在/);
});
