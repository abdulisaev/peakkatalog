// Собирает офлайн-демо в ОДИН HTML-файл (удобно отправлять в Telegram).
// node export-single.mjs <остатки.json> <выход.html> [папка-с-фото]
// Остатки — формат public/data/stock-example.json. Фото — thumb-N.(jpg|webp) и detail-N.(jpg|webp),
// по умолчанию public/photo (появляется после npm run build).
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, extname } from 'node:path';

const [stockPath = 'public/data/stock-example.json', output = 'PEAK-Catalog.html', photoDir = 'public/photo'] = process.argv.slice(2);
const read = name => readFileSync(resolve(name));
const text = name => read(name).toString('utf8');
const script = value => JSON.stringify(value).replaceAll('<', '\\u003c');
const mime = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.png': 'image/png' };

const photos = {};
if (existsSync(photoDir)) {
  for (const file of readdirSync(photoDir)) {
    const match = /^(thumb|detail)-(\d+)\.(jpe?g|webp)$/i.exec(file);
    if (match) photos[match[1] + '-' + match[2]] = `data:${mime[extname(file).toLowerCase()]};base64,` + read(resolve(photoDir, file)).toString('base64');
  }
}
const data = { catalog: JSON.parse(text('public/data/catalog.json')), stock: JSON.parse(text(stockPath)) };
const logo = 'data:image/png;base64,' + read('public/logo.png').toString('base64');
const mark = 'data:image/svg+xml;base64,' + read('public/mark.svg').toString('base64');

let html = text('public/index.html')
  .replace('<link rel="icon" href="/mark.svg">', `<link rel="icon" href="${mark}">`)
  .replace('<link rel="stylesheet" href="/app.css">', `<style>${text('public/app.css')}</style>`)
  .replace('<script type="module" src="/app.js"></script>', '')
  .replace('src="/logo.png"', `src="${logo}"`)
  .replace('</body>', `<script>window.PEAK_DEMO_DATA=${script(data)};window.PEAK_PHOTOS=${script(photos)};</script>\n<script>${text('public/app.js').replaceAll('</script', '<\\/script')}</script>\n</body>`);
writeFileSync(resolve(output), html);
console.log({ output, photos: Object.keys(photos).length, megabytes: +(Buffer.byteLength(html) / 1e6).toFixed(1) });
