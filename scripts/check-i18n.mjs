// Fails when a t('…') text in the app has no Telugu, Hindi or Marathi translation.
// Keys are the English text itself (see client/src/i18n/index.js). Texts built at
// run time, like t(label), are not seen here: keep their lists translated by hand.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../client/src');
const keys = new Map();
const call = /\bt\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g;
(function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const file = path.join(dir, name);
    if (fs.statSync(file).isDirectory()) walk(file);
    else if (/\.jsx?$/.test(name)) {
      for (const m of fs.readFileSync(file, 'utf8').matchAll(call)) {
        if (m[1] === '`' && m[2].includes('${')) continue;
        const key = m[2].replace(/\\(['"])/g, '$1');
        if (!keys.has(key)) keys.set(key, path.relative(src, file));
      }
    }
  }
})(src);

let missing = 0;
for (const lang of ['te', 'hi', 'mr']) {
  const done = JSON.parse(fs.readFileSync(path.join(src, 'i18n/locales', `${lang}.json`), 'utf8'));
  for (const [key, file] of keys) {
    if (!(key in done)) {
      missing++;
      console.error(`${lang}: missing "${key}" (${file})`);
    }
  }
}
console.log(`i18n: ${keys.size} texts, ${missing} missing translations`);
process.exit(missing ? 1 : 0);
