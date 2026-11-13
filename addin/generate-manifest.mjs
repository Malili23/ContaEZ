import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const directory=path.dirname(fileURLToPath(import.meta.url));
const origin=new URL(process.argv[2]||'https://localhost:3000');
if(origin.protocol!=='https:')throw new Error('Excel requiere un origen HTTPS para el complemento.');
const template=await fs.readFile(path.join(directory,'manifest.template.xml'),'utf8');
await fs.writeFile(path.join(directory,'manifest.xml'),template.replaceAll('__ORIGIN__',origin.origin));
console.log(`Manifiesto generado para ${origin.origin}`);
