// Opt-in network coverage measurement, not a statistical global-accuracy claim.
// Fixed names are declared before requests; failures stay in the denominator.
import {resolveTaxonomy,taxonomyUrl} from '../src/domain/taxonomy.ts';
import {writeFile,mkdir,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const groups = {
  chinese: ['银杏','洋桔梗','君子兰','月季','玫瑰','牡丹','芍药','杜鹃','绣球','蝴蝶兰','龟背竹','绿萝','发财树','幸福树','琴叶榕','橡皮树','虎尾兰','吊兰','文竹','长寿花','蟹爪兰','三角梅','桂花','栀子','茉莉','兰花','百合','郁金香','大丽花','风信子'],
  global: ['Ginkgo biloba','Eustoma grandiflorum','Sequoia sempervirens','Adansonia digitata','Welwitschia mirabilis','Araucaria heterophylla','Eucalyptus globulus','Quercus robur','Pinus sylvestris','Taxus baccata','Acer saccharum','Betula pendula','Acacia dealbata','Jacaranda mimosifolia','Delonix regia','Coffea arabica','Theobroma cacao','Olea europaea','Mangifera indica','Persea americana','Oryza sativa','Zea mays','Solanum lycopersicum','Manihot esculenta','Musa acuminata','Papaver somniferum','Nelumbo nucifera','Nymphaea alba','Drosera capensis','Nepenthes rajah','Sarracenia purpurea','Dionaea muscipula','Dicksonia antarctica','Platycerium bifurcatum','Equisetum arvense','Sphagnum palustre','Marchantia polymorpha','Cycas revoluta','Ephedra sinica','Gnetum gnemon'],
  horticultural: ["Acer palmatum 'Atropurpureum'","Rosa 'Peace'","Rosa 'Iceberg'","Hydrangea macrophylla 'Nikko Blue'","Hosta 'Patriot'","Tulipa 'Queen of Night'","Lavandula angustifolia 'Hidcote'","Buddleja davidii 'Black Knight'","Picea pungens 'Glauca Globosa'","Ginkgo biloba 'Mariken'","Eustoma grandiflorum 'Echo Blue'","Clematis 'Nelly Moser'","Camellia japonica 'Nuccio’s Gem'","Magnolia grandiflora 'Little Gem'","Malus domestica 'Gala'","Vitis vinifera 'Cabernet Sauvignon'","Solanum lycopersicum 'Sungold'","Brassica oleracea var. botrytis","Phalaenopsis 'Sogo Yukidian'","Dendrobium nobile 'Spring Dream'","Petunia × atkinsiana","Pelargonium × hortorum","Fragaria × ananassa","× Fatshedera lizei","Salvia × sylvestris 'Mainacht'",'金边虎尾兰','红掌','多肉植物','无尽夏绣球','网纹草']
};
const sourceSha256=createHash('sha256').update(await readFile(new URL('../src/domain/taxonomy.ts',import.meta.url))).digest('hex');
let next=0,requests=0;
const cache=new Map();
const request=async(op,query)=>{
  const key=op+'|'+query;
  if(cache.has(key))return cache.get(key);
  await new Promise(r=>setTimeout(r,Math.max(0,next-Date.now())));next=Date.now()+1050;requests++;
  const response=await fetch(taxonomyUrl(op,query),{headers:{'User-Agent':'Smart-Forestry/0.3 (+https://github.com/Vickylines/Smart_Forestry)'},signal:AbortSignal.timeout(18000),redirect:'error'});
  if(!response.ok)throw new Error(String(response.status));
  const json=await response.json();cache.set(key,json);return json;
};
const rows=[];
const names=Object.entries(groups).flatMap(([group,names])=>names.map(name=>({group,name})));
const limit=Number(process.env.TAXONOMY_LIMIT||names.length);
for(const row of names.slice(0,limit)){
  const started=Date.now();const result=await resolveTaxonomy(row.name,'',request);
  rows.push({...row,...result,elapsedMs:Date.now()-started});
  console.log(JSON.stringify({n:rows.length,name:row.name,family:result.family,genus:result.genus,status:result.taxonomyStatus}));
}
const report={at:new Date().toISOString(),sourceSha256,total:rows.length,complete:rows.filter(r=>r.family&&r.genus).length,requests,scope:'Fixed convenience sample; field completeness only, not global coverage or correct photo identification.',rows};
const dir=fileURLToPath(new URL('../../../.preview/beta4/',import.meta.url));await mkdir(dir,{recursive:true});
await writeFile(dir+'taxonomy-live.json',JSON.stringify(report,null,2));
console.log(JSON.stringify({total:report.total,complete:report.complete,requests}));
