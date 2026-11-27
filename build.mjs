import { execFileSync } from 'node:child_process';
execFileSync(process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3'), ['unpack-photos.py'], { stdio: 'inherit' });
import { cpSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
mkdirSync('dist/.openai', { recursive: true });
mkdirSync('dist/server', { recursive: true });
cpSync('.openai/hosting.json', 'dist/.openai/hosting.json');
cpSync('public', 'dist/client', { recursive: true });
for(const name of ['stock-example','archive-stock']) rmSync('dist/client/data/'+name+'.json',{force:true});
writeFileSync('dist/server/index.js', 'const OWNER_SNAPSHOT='+readFileSync('public/data/stock-example.json','utf8')+';\n'+readFileSync('worker.mjs','utf8'));
