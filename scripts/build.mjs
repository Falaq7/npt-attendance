import fs from 'node:fs/promises';
const server=await fs.readFile('src/server.js','utf8');const app=await fs.readFile('src/app.js','utf8');const page=(await fs.readFile('src/page.html','utf8')).replace('APP_SCRIPT',app);
await fs.writeFile('worker/index.js',server+'\nconst HTML='+JSON.stringify(page)+';\n');
await fs.mkdir('dist/server',{recursive:true});await fs.mkdir('dist/.openai',{recursive:true});await fs.copyFile('worker/index.js','dist/server/index.js');await fs.copyFile('.openai/hosting.json','dist/.openai/hosting.json');
