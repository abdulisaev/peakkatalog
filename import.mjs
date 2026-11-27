import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const html = readFileSync(process.argv[2], 'utf8');
function extract(name) {
  const marker = 'window.' + name + '=';
  const start = html.indexOf(marker) + marker.length;
  const end = html.indexOf(';', start);
  // The JSON arrays of JPEG data URLs contain semicolons inside strings.
  return JSON.parse(html.slice(start, name === '__DATA' ? end : html.indexOf(']', start) + 1));
}
const { items } = extract('__DATA');
const photos = new Set();
const stock = [];
const products = items.map(({ a, n, s, c, fb, cols }) => {
  if (fb != null) photos.add(fb);
  return { a, n, s, c, photo: fb, variants: cols.map(({ c: color, im, z }) => {
    if (im != null) photos.add(im);
    for (const [size, qty] of z) stock.push([a, color, size, qty]);
    return { color, photo: im, sizes: z.map(([size]) => size) };
  }) };
});
mkdirSync('public/data', { recursive: true });
mkdirSync('../peak-photos', { recursive: true });
writeFileSync('public/data/catalog.json', JSON.stringify(products));
writeFileSync('public/data/archive-stock.json', JSON.stringify(stock));
writeFileSync('../peak-photos/used.txt', [...photos].sort((a, b) => a - b).join('\n'));
extract('__D').forEach((url, i) => writeFileSync('../peak-photos/' + i + '.jpg', Buffer.from(url.split(',')[1], 'base64')));
console.log({ models: products.length, photos: photos.size, stockRows: stock.length });
