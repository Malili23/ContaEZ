import { mkdir, copyFile, access, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
const out=path.resolve('public/ocr'); await mkdir(out,{recursive:true});
for(const file of ['tesseract-core-lstm.wasm.js','tesseract-core-simd-lstm.wasm.js','tesseract-core-relaxedsimd-lstm.wasm.js'])await copyFile(path.resolve('node_modules/tesseract.js-core',file),path.join(out,file));
await copyFile(path.resolve('node_modules/tesseract.js/dist/worker.min.js'),path.join(out,'worker.min.js'));
for(const [pkg,name] of [['tesseract.js','LICENSE-worker.txt'],['tesseract.js-core','LICENSE-core.txt']]){try{await copyFile(path.resolve('node_modules',pkg,'LICENSE'),path.join(out,name));}catch{}}
const model=path.join(out,'spa.traineddata.gz'); const source='https://tessdata.projectnaptha.com/4.0.0/spa.traineddata.gz';
const expectedSha='6cd52c545bceeacb2e43fad64fc0703a711c482ba20d1ca4b6915c09de9973e6';
try{await access(model);}catch{const response=await fetch(source);if(!response.ok)throw new Error('No se pudo obtener el modelo OCR de español: '+response.status);const bytes=new Uint8Array(await response.arrayBuffer());if(bytes[0]!==31||bytes[1]!==139||bytes.length<100000)throw new Error('El modelo OCR no es un gzip válido.');await writeFile(model,bytes);}
const bytes=await readFile(model);const sha256=createHash('sha256').update(bytes).digest('hex');
if(sha256!==expectedSha)throw new Error('El modelo OCR no coincide con la versión comprobada. No se incluirá en la aplicación.');
await writeFile(path.join(out,'modelo.json'),JSON.stringify({language:'spa',source,sha256,license:'Apache-2.0'},null,2));
console.log('OCR en español preparado para uso local.');
