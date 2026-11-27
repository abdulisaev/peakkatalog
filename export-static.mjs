// Статическая версия для Vercel / Netlify / любого хостинга: данные в data.js, фото отдельными файлами.
// node export-static.mjs <остатки.json> <папка-выхода> <папка-с-фото> [webp|jpg]
// Заявки в этой версии сохраняются только в браузере (как в демо). Боевой режим с 1С — worker.mjs.
import { readFileSync, writeFileSync, mkdirSync, cpSync, readdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const [stockPath, out, photoDir, format = 'webp'] = process.argv.slice(2);
if (!stockPath || !out || !photoDir) throw new Error('node export-static.mjs <остатки.json> <папка> <фото> [webp|jpg]');
const dir = resolve(out);
rmSync(dir, { recursive: true, force: true });
mkdirSync(resolve(dir, 'photo'), { recursive: true });
for (const f of ['app.js', 'app.css', 'logo.png', 'mark.svg']) cpSync(resolve('public', f), resolve(dir, f));
let photos = 0;
for (const f of readdirSync(photoDir)) if (/^(thumb|detail)-\d+\.(webp|jpe?g)$/i.test(f)) { cpSync(resolve(photoDir, f), resolve(dir, 'photo', f)); photos++; }
const data = { catalog: JSON.parse(readFileSync('public/data/catalog.json', 'utf8')), stock: JSON.parse(readFileSync(stockPath, 'utf8')) };
writeFileSync(resolve(dir, 'data.js'), `window.PEAK_PHOTO_FORMAT=${JSON.stringify(format)};window.PEAK_DEMO_DATA=${JSON.stringify(data).replaceAll('<', '\\u003c')};\n`);
writeFileSync(resolve(dir, 'index.html'), readFileSync('public/index.html', 'utf8')
  .replace('<script type="module" src="/app.js"></script>', '<script src="/data.js"></script>\n  <script type="module" src="/app.js"></script>'));
writeFileSync(resolve(dir, 'vercel.json'), JSON.stringify({
  headers: [
    { source: '/photo/(.*)', headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }] },
    { source: '/(.*)', headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }, { key: 'X-Content-Type-Options', value: 'nosniff' }] }
  ]
}, null, 2));
console.log({ out: dir, photos });
