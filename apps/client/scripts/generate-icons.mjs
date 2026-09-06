import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Original paths; SVG is used in page content and PNG in the native tab bar.
const paths = {
  leaf:'<path d="M19.5 4.5c-9-1-15 2-15 8a6.5 6.5 0 0 0 11 4.5c3-3 3.5-7 4-12.5Z"/><path d="M4 21c1.5-5 5-9 10.5-12.5M8.5 13.5l-.5-4M11.5 11l4.5.5"/>',
  folder:'<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/><path d="M3 10h18"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  chevron:'<path d="m9 5 7 7-7 7"/>',
  camera:'<path d="m8 6 1.5-2h5L16 6h3a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3Z"/><circle cx="12" cy="13" r="4"/>',
  info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
  close:'<path d="m6 6 12 12M18 6 6 18"/>',
  projects:'<rect x="4" y="3" width="16" height="18" rx="3"/><path d="M8 3v18M12 8h4M12 12h4"/>',
  tasks:'<path d="m3 6 1.5 1.5L7 4M11 6h10M3 13l1.5 1.5L7 11M11 13h10M11 20h10"/><circle cx="5" cy="20" r=".65"/>',
  settings:'<path d="m10 3-.7 2.2-1.7 1L5.3 6l-2 3.5 1.6 1.7v2L3.3 15l2 3.4 2.3-.2 1.7 1L10 21h4l.7-1.8 1.7-1 2.3.2 2-3.4-1.6-1.8v-2l1.6-1.7-2-3.5-2.3.2-1.7-1L14 3h-4Z"/><circle cx="12" cy="12" r="3"/>',
};
const output = fileURLToPath(new URL('../src/static/icons/',import.meta.url));
await mkdir(output,{recursive:true});
function svg(path,color='#236447',weight=1.75) {
  return '<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72" viewBox="0 0 24 24" fill="none" stroke="' + color + '" stroke-width="' + weight + '" stroke-linecap="round" stroke-linejoin="round">' + path + '</svg>';
}
for (const name of ['leaf','folder','plus','chevron','camera','info','close']) {
  await writeFile(output + name + '.svg',svg(paths[name],name === 'plus' ? '#ffffff' : ['chevron','info','close'].includes(name) ? '#626e67' : '#236447'));
}
const browser = await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL || 'chrome'});
try {
  const page = await browser.newPage({viewport:{width:72,height:72},deviceScaleFactor:1});
  for (const name of ['projects','tasks','settings']) {
    for (const active of [false,true]) {
      const artwork = svg(paths[name],active ? '#236447' : '#626e67',active ? 1.95 : 1.65);
      const stem = 'tab-' + name + (active ? '-active' : '');
      await writeFile(output + stem + '.svg',artwork);
      await page.setContent('<style>html,body{margin:0;width:72px;height:72px;background:transparent}svg{display:block}</style>' + artwork);
      await page.screenshot({path:output + stem + '.png',omitBackground:true});
    }
  }
} finally { await browser.close(); }
console.log('Generated original SVG icons and PNG tab icons.');
