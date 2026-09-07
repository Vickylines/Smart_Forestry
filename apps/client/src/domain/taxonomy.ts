import type { Candidate, ForestState } from './forest';

export type TaxonomyOperation = 'inat-search' | 'inat-taxa' | 'gbif-match' | 'wiki-search' | 'wiki-entities';
export type TaxonomyRequest = (operation: TaxonomyOperation, query: string) => Promise<any>;
export type TaxonomyResult = Pick<Candidate, 'family' | 'genus' | 'taxonomySource' | 'taxonomyEvidence' | 'taxonomySourceUrl' | 'taxonomyStatus' | 'taxonomyCheckedAt' | 'familyScientificName' | 'genusScientificName' | 'taxonomyScientificName'>;
const COL = '7ddf754f-d193-4cc9-b351-99906754a03b';
const normalize = (s: string) => s.normalize('NFKC').trim().replace(/[‘’]/g, "'").replace(/\s*×\s*/g,'×').replace(/\s+/g, ' ').toLowerCase();
const text = (s: unknown) => typeof s === 'string' ? s.trim().slice(0, 180) : '';
export const taxonomyKey = (name: string, scientificName = '') => normalize(name) + '|' + normalize(scientificName);

// Kept equivalent to TaxonomyHttp.endpoint. The native bridge accepts operations,
// never arbitrary URLs, and never has access to the Baidu credential store.
export function taxonomyUrl(operation: TaxonomyOperation, query: string): string {
  if (!query || query.length > (['inat-taxa','wiki-entities'].includes(operation) ? 400 : 180)) throw new Error('分类查询名称不正确');
  const q = encodeURIComponent(query);
  switch (operation) {
    case 'inat-search': return `https://api.inaturalist.org/v1/taxa/autocomplete?q=${q}&taxon_id=47126&locale=zh-CN&per_page=30`;
    case 'inat-taxa':
      if (!/^\d+(,\d+){0,29}$/.test(query)) throw new Error('分类编号不正确');
      return `https://api.inaturalist.org/v1/taxa/${query}?locale=zh-CN`;
    case 'gbif-match': return `https://api.gbif.org/v2/species/match?scientificName=${q}&kingdom=Plantae&checklistKey=${COL}`;
    case 'wiki-search': return `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${q}&language=zh&format=json&limit=10&origin=*&maxlag=5`;
    case 'wiki-entities':
      if (!/^Q\d+(\|Q\d+){0,9}$/.test(query)) throw new Error('分类编号不正确');
      return `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${q}&props=claims%7Caliases%7Clabels&languages=zh%7Czh-cn%7Czh-hans%7Czh-tw%7Cen&format=json&origin=*&maxlag=5`;
    default: throw new Error('不支持的分类查询');
  }
}
interface Taxon { family: string; genus: string; familyLatin: string; genusLatin: string; name: string; source: string; url: string; }
function inatTaxon(t: any): Taxon | undefined {
  if (!t?.is_active || t.iconic_taxon_name !== 'Plantae') return;
  const lineage = [...(Array.isArray(t.ancestors) ? t.ancestors : []), t];
  const family = lineage.find(a => a.rank === 'family'), genus = lineage.find(a => ['genus','genushybrid'].includes(a.rank));
  if (!family?.name || !genus?.name) return;
  const localized = (rank: any, suffix: string) => text(rank.preferred_common_name).endsWith(suffix) ? text(rank.preferred_common_name) : text(rank.name);
  return { family: localized(family, '科'), genus: localized(genus, '属'), familyLatin: text(family.name), genusLatin: text(genus.name), name: text(t.name), source: 'iNaturalist 分类库', url: `https://www.inaturalist.org/taxa/${t.id}` };
}
function gbifTaxon(data: any, query: string): Taxon | undefined {
  // The provider's confidence number is a name-match score, not accuracy or coverage.
  if (data?.diagnostics?.matchType !== 'EXACT' || !Array.isArray(data.classification)) return;
  const ranks = data.classification;
  if (!ranks.some((r: any) => r.rank === 'KINGDOM' && r.name === 'Plantae')) return;
  const family = ranks.find((r: any) => r.rank === 'FAMILY'), genus = ranks.find((r: any) => r.rank === 'GENUS');
  if (!family?.name || !genus?.name || !data.usage?.canonicalName) return;
  // Exact synonyms can resolve to a different accepted name; fuzzy matches cannot.
  if (!data.synonym && normalize(data.usage.canonicalName).replace(/×/g,'') !== normalize(query).replace(/×/g,'')) return;
  return { family: text(family.name), genus: text(genus.name), familyLatin: text(family.name), genusLatin: text(genus.name), name: text(data.usage.canonicalName), source: 'GBIF · Catalogue of Life', url: taxonomyUrl('gbif-match', query) };
}
function consensus(taxa: Taxon[], scope: 'matched' | 'genus' = 'matched'): TaxonomyResult {
  const first = taxa[0];
  const family = taxa.every(t => normalize(t.familyLatin) === normalize(first.familyLatin));
  const genus = family && taxa.every(t => normalize(t.genusLatin) === normalize(first.genusLatin));
  return { family: family ? first.family : '', genus: genus ? first.genus : '', familyScientificName: family ? first.familyLatin : '', genusScientificName: genus ? first.genusLatin : '',
    taxonomyStatus: genus ? scope : 'ambiguous', taxonomySource: [...new Set(taxa.map(t => t.source))].join(' / '), taxonomySourceUrl: first.url,
    taxonomyScientificName: taxa.length === 1 && scope === 'matched' ? first.name : '',
    taxonomyEvidence: (scope === 'genus' ? '仅匹配到基础种或属，未核实园艺品种。' : taxa.length > 1 ? '同名记录只采用共同的科属：' : '名称匹配：') + taxa.map(t => t.name).join('；').slice(0, 500) };
}
// Only Latin botanical syntax permits a base/genus fallback. Never remove Chinese
// colour/shape words from cultivar trade names, or turn cross-genus formulas into
// their first parent. Named nothogenera (e.g. × Fatshedera) remain a single genus.
export function botanicalFallbacks(input: string): string[] {
  const s = input.normalize('NFKC').trim().replace(/\s+/g, ' ');
  if (/(?:×|\bx)\s*[A-Z]/.test(s.replace(/^×\s*/, ''))) return [];
  const match = s.match(/^(×\s*)?([A-Z][a-z-]{2,})(?:\s+(×\s*)?([a-z][a-z-]{1,}))?(?=$|\s|['‘’])/);
  if (!match) return [];
  const genus = (match[1] ? '× ' : '') + match[2];
  const base = match[4] && !['cv', 'var', 'subsp', 'ssp', 'sp'].includes(match[4]) ? genus + ' ' + (match[3] ? '× ' : '') + match[4] : '';
  return [...new Set([base, genus].filter(n => n && normalize(n) !== normalize(s)))];
}
export async function resolveTaxonomy(name: string, scientificName: string, request: TaxonomyRequest): Promise<TaxonomyResult> {
  let failed = false;
  const started = Date.now(), unavailable = new Set<string>();
  const call: TaxonomyRequest = async (op, query) => {
    const source = op.split('-')[0];
    if (unavailable.has(source) || Date.now() - started > 45000) { failed = true; return undefined; }
    try { const data = await request(op, query); if (!data || data.error) throw new Error('分类库暂不可用'); return data; }
    catch { failed = true; unavailable.add(source); return undefined; }
  };
  const inat = async (query: string): Promise<TaxonomyResult | undefined> => {
    const data = await call('inat-search', query);
    if (!data) return;
    if (!Array.isArray(data.results)) { failed = true; return; }
    const matches = data.results.filter((t: any) => t.is_active && t.iconic_taxon_name === 'Plantae' && [t.name, t.matched_term, t.preferred_common_name].some(n => typeof n === 'string' && normalize(n) === normalize(query)));
    if (!matches.length) return;
    // total_results counts prefix matches (e.g. 玫瑰茄 for 玫瑰), not exact
    // homonyms. Only exact-name records participate in the consensus.
    const ids = [...new Set(matches.map((t: any) => String(t.id)))];
    const detail = await call('inat-taxa', ids.join(','));
    if (!detail?.results) { failed = true; return; }
    const taxa = ids.map(id => inatTaxon(detail.results.find((t: any) => String(t.id) === id)));
    if (taxa.some(t => !t)) return;
    return consensus(taxa as Taxon[]);
  };
  const gbif = async (query: string) => gbifTaxon(await call('gbif-match', query), query);
  const lookup = async (): Promise<TaxonomyResult> => {
    const primary = scientificName.trim() || name.trim();
    if (!primary || primary.length > 180) return {taxonomyStatus:'not-found'};
    const direct = await inat(primary);
    if (direct) return direct;
    const latin = /^[×A-Za-z][A-Za-z× .'‘’()-]+$/.test(primary);
    if (latin) {
      const exact = await gbif(primary);
      if (exact) return consensus([exact]);
      for (const base of botanicalFallbacks(primary)) {
        const taxonomy = await inat(base);
        if (taxonomy?.genus) return {...taxonomy, taxonomyStatus:'genus',taxonomyScientificName:'',taxonomyEvidence:`按基础名称 ${base} 补全科属；未核实园艺品种。`};
        const t = await gbif(base);
        if (t) return consensus([t], 'genus');
      }
    }
    // An explicit scientific name must not silently fall back to a conflicting
    // common name. Without one, Wikidata supplies exact vernacular aliases only.
    if (!scientificName.trim()) {
      const data = await call('wiki-search', primary);
      const hits = data?.search?.filter((h: any) => /^Q\d+$/.test(h.id)).slice(0,10);
      if (hits?.length) {
        const entities = await call('wiki-entities', hits.map((h: any) => h.id).join('|'));
        const exact = hits.filter((h: any) => {
          const entity = entities?.entities?.[h.id];
          const names = [h.label,h.match?.text,...Object.values(entity?.labels || {}).map((label: any) => label.value),...Object.values(entity?.aliases || {}).flatMap((aliases: any) => aliases.map((alias: any) => alias.value))];
          return names.some(n => typeof n === 'string' && normalize(n) === normalize(primary));
        });
        const names = [...new Set<string>(exact.flatMap((h: any) => (entities?.entities?.[h.id]?.claims?.P225 || []).filter((c: any) => c.rank !== 'deprecated').map((c: any) => text(c.mainsnak?.datavalue?.value))).filter(Boolean))];
        if (names.length && names.length <= 6) {
          const taxa: Taxon[] = [];
          let reduced = false;
          for (const n of names) {
            let t = await gbif(n);
            if (!t) for (const base of botanicalFallbacks(n)) { t = await gbif(base); if (t) { reduced = true; break; } }
            if (/['‘’]|\bcv\./.test(n)) reduced = true;
            if (t) taxa.push({...t,source:'Wikidata 名称 / ' + t.source});
          }
          if (taxa.length === names.length) return consensus(taxa,reduced ? 'genus' : 'matched');
        }
      }
    }
    return {taxonomyStatus:failed ? 'unavailable' : 'not-found'};
  };
  let result: TaxonomyResult;
  try { result = await lookup(); } catch { result = {taxonomyStatus:'unavailable'}; }
  if (result.taxonomyStatus === 'matched' && /['‘’]|\bcv\.|\bGroup\b/.test(scientificName || name)) {
    result = {...result,taxonomyStatus:'genus',taxonomyScientificName:'',taxonomyEvidence:'科属按基础分类补全，未核实园艺品种。' + (result.taxonomyEvidence || '')};
  }
  return {...result,taxonomyCheckedAt:new Date().toISOString()};
}

export function applyCandidateTaxonomy(state: ForestState, observationId: string, key: string, result: TaxonomyResult): ForestState {
  const enrich = (c: Candidate) => taxonomyKey(c.name, c.scientificName) === key ? {...c, ...result} : c;
  return {...state,observations:state.observations.map(o => o.id !== observationId ? o : {...o,
    candidates:o.candidates.map(enrich),
    ...(o.recognitionPhotos ? {recognitionPhotos:Object.fromEntries(Object.entries(o.recognitionPhotos).map(([id,entry]) => [id,{...entry,candidates:entry.candidates.map(enrich)}]))} : {})
    // Confirmed fields, review history and revision are intentionally untouched.
  })};
}
export function taxonomyMessage(candidate: TaxonomyResult): string {
  switch (candidate.taxonomyStatus) {
    case 'genus': return '已匹配基础种或属，园艺品种待核对';
    case 'ambiguous': return '名称有歧义，请补充学名后重查';
    case 'not-found': return '未查到科属，可补充学名或手填';
    case 'unavailable': return '分类库暂不可用，可稍后重试';
    default: return '';
  }
}

export function createTaxonomyCache(resolve: (name: string, scientificName: string, refresh?: boolean) => Promise<TaxonomyResult>, storage?: {read: () => unknown; write: (value: unknown) => void}, now = Date.now) {
  type Entry = { key: string; until: number; result: TaxonomyResult };
  const cache = new Map<string, Entry>(), pending = new Map<string, Promise<TaxonomyResult>>();
  try {
    const saved = storage?.read();
    if (Array.isArray(saved)) saved.slice(-500).forEach(e => {
      if (typeof e?.key === 'string' && e.key.length <= 400 && e.until > now() && e.until <= now() + 31 * 86400000 && ['matched','genus','ambiguous','not-found','unavailable'].includes(e.result?.taxonomyStatus)) cache.set(e.key,e);
    });
  } catch { /* Cache failure must not block a lookup. */ }
  return (name: string, scientificName = '', refresh = false): Promise<TaxonomyResult> => {
    const key = taxonomyKey(name,scientificName), existing = pending.get(key), saved = cache.get(key);
    if (existing) return existing;
    if (!refresh && saved && saved.until > now()) return Promise.resolve(saved.result);
    const work = resolve(name,scientificName,refresh).then(result => {
      const ttl = result.taxonomyStatus === 'unavailable' ? 60000 : ['matched','genus'].includes(result.taxonomyStatus || '') ? 30 * 86400000 : 10 * 60000;
      cache.delete(key); cache.set(key,{key,until:now() + ttl,result});
      while (cache.size > 500) cache.delete(cache.keys().next().value!);
      try { storage?.write([...cache.values()].filter(e => e.until > now())); } catch { /* Public-name cache is expendable. */ }
      return result;
    }).finally(() => pending.delete(key));
    pending.set(key,work); return work;
  };
}
