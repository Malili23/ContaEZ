import { readdir, readFile, mkdir, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.resolve(process.argv[2]||path.join(root,'..','Distribucion','ContaEZ-fuente.zip'));
const files={};
const blocked=new Set(['node_modules','target','.git','gen','dist','private','test-results']);
async function walk(dir,relative=''){
 for(const entry of await readdir(dir,{withFileTypes:true})){
  if(blocked.has(entry.name)||entry.name.startsWith('.env'))continue;
  const rel=path.posix.join(relative,entry.name);const absolute=path.join(dir,entry.name);
  if(entry.isDirectory())await walk(absolute,rel);
  else if(entry.isFile()&&!/\.(xlsx|xlsm|pdf|contaez|exe|zip|sqlite|db|pfx|p12|key|log)$/i.test(entry.name)&&!rel.endsWith('hosting.json'))files['ContaEZ/'+rel]=new Uint8Array(await readFile(absolute));
 }
}
for(const name of ['src','src-tauri','public','tests','scripts','docs','addin','.github'])try{await walk(path.join(root,name),name)}catch(e){if(e.code!=='ENOENT')throw e;}
for(const name of ['package.json','package-lock.json','tsconfig.json','vite.config.ts','index.html','README.md','LICENSE','THIRD_PARTY_NOTICES.md','.gitignore'])try{files['ContaEZ/'+name]=new Uint8Array(await readFile(path.join(root,name)))}catch(e){if(e.code!=='ENOENT')throw e;}
for(const name of ['index.html','styles.css'])files['ContaEZ/site/'+name]=new Uint8Array(await readFile(path.join(root,'site',name)));
await mkdir(path.dirname(output),{recursive:true});await writeFile(output,zipSync(files,{level:6}));
console.log(JSON.stringify({output,files:Object.keys(files).length,bytes:(await stat(output)).size,privateDataIncluded:false}));
