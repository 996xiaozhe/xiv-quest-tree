import { readFile } from 'node:fs/promises';

const WIKI = 'https://ff14.huijiwiki.com/wiki/';
const wikiUrl = (name) => WIKI + encodeURIComponent('任务') + ':' + encodeURIComponent(name.trim().replace(/\s+/g, '_'));

const GIVEN = 'https://ff14.huijiwiki.com/wiki/%E4%BB%BB%E5%8A%A1:%E5%A8%81%E5%B0%94%E9%9B%B7%E5%BE%B7%E7%9A%84%E9%82%80%E8%AF%B7';
const NAME = '威尔雷德的邀请';

const mine = wikiUrl(NAME);
console.log('given :', GIVEN);
console.log('mine  :', mine);
console.log('match :', mine === GIVEN ? 'EXACT MATCH' : 'MISMATCH');

const data = JSON.parse(await readFile('public/data/quests.json', 'utf8'));
const q = data.quests.find((x) => x.cn === NAME);
console.log('\nquest in dataset:', q ? `${q.id}  ${q.cn} / ${q.en}` : 'NOT FOUND');
if (q) console.log('link the app will render:', wikiUrl(q.cn));

// sanity: no name can escape the namespace or produce a broken path
let bad = 0;
for (const quest of data.quests) {
  const u = wikiUrl(quest.cn);
  const tail = u.slice(WIKI.length);
  if (!tail.startsWith('%E4%BB%BB%E5%8A%A1:')) bad++;
  if (tail.includes('/') || tail.includes('?') || tail.includes('#')) bad++;
  try {
    decodeURIComponent(tail.split(':').slice(1).join(':'));
  } catch {
    bad++;
  }
}
console.log(`\nunsafe wiki links across all ${data.quests.length} quests: ${bad}`);
for (const id of [69477, 69380, 69218]) {
  const x = data.quests.find((y) => y.id === id);
  console.log('  ', wikiUrl(x.cn));
}
