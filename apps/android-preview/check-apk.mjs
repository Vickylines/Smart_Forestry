import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../client/package.json',import.meta.url));
const Zip=require('adm-zip');
const apk=process.argv[2];
if(!apk)throw new Error('Usage: node check-apk.mjs PATH_TO_APK');
const zip=new Zip(readFileSync(apk));
assert.equal(zip.test(),true);
const names=zip.getEntries().map(e=>e.entryName);
assert.ok(names.includes('assets/www/index.html') && names.includes('classes.dex'));
assert.ok(!names.some(n=>/\.map$|\.keystore$|\.jks$|\.env|shared_prefs|node_modules|leaf-[012]\.svg/.test(n)));
for(const entry of zip.getEntries()){
 if(entry.isDirectory)continue;
 const text=entry.getData().toString('utf8');
 assert.ok(!/QA-ONLY-(?:API|SECRET)|bce-v3\/[A-Za-z0-9_-]{8,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text),'Potential credential in '+entry.entryName);
 if(entry.entryName.startsWith('assets/www/'))assert.ok(!text.includes('无需电脑在线'));
}
console.log(JSON.stringify({passed:true,checks:['readable APK','bundled HTML and DEX','no sample illustrations','no private keys/env/preferences/source maps/node_modules','no test credentials or bearer credentials','removed obsolete UI copy'],entries:names.length}));
