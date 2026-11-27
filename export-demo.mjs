import { mkdirSync, cpSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const destination = resolve(process.argv[2]);
const repo = resolve(process.argv[3]);
const text = filename => readFileSync(resolve(repo, filename), 'utf8');
mkdirSync(destination, { recursive: true });
cpSync(resolve(repo, 'public'), destination, { recursive: true });
const index = text('public/index.html')
  .replaceAll('href="/', 'href="./')
  .replaceAll('src="/', 'src="./')
  .replace('href="./"', 'href="./index.html"')
  .replace('<script type="module" src="./app.js"></script>', '<script defer src="./offline-data.js"></script>\n  <script defer src="./app.js"></script>');
writeFileSync(resolve(destination, 'index.html'), index);
writeFileSync(resolve(destination, 'offline-data.js'), 'window.PEAK_DEMO_DATA=' + JSON.stringify({
  catalog: JSON.parse(text('public/data/catalog.json')),
  stock: JSON.parse(text('public/data/stock-example.json'))
}) + ';\n');
writeFileSync(resolve(destination, 'ОТКРЫТЬ.txt'), 'Откройте index.html в Chrome или Edge после распаковки ZIP.\r\n\r\nВыберите магазин, затем товар и размер. После отправки тестовой заявки переключитесь вверху на склад «Лиственная», чтобы увидеть её в очереди. Для отметки об обработке укажите тестовый номер перемещения.\r\n\r\nОстатки всех пяти складов взяты из примера «САЙТ.xlsx». Автообновление данных 1С ещё не подключено.\r\n');
const integration = resolve(destination, 'integration');
mkdirSync(integration, { recursive: true });
for (const file of ['worker.mjs','drizzle','1c','README.md','.openai','package.json']) {
  cpSync(resolve(repo, file), resolve(integration,file), { recursive: true });
}
writeFileSync(resolve(integration,'index.hosted.html'),text('public/index.html'));
writeFileSync(resolve(integration,'build.mjs'),`import { cpSync, mkdirSync } from 'node:fs';
mkdirSync('dist/.openai', { recursive: true });
mkdirSync('dist/server', { recursive: true });
mkdirSync('dist/client', { recursive: true });
cpSync('.openai/hosting.json', 'dist/.openai/hosting.json');
cpSync('worker.mjs', 'dist/server/index.js');
cpSync('index.hosted.html', 'dist/client/index.html');
for (const name of ['app.js','app.css','mark.svg','logo.png','data','photo']) {
  cpSync('../' + name, 'dist/client/' + name, { recursive: true });
}
`);
