import { readdir, readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { auditWorkbook, repairWorkbook } from '../src/io/audit';
import { exportAuditSummary } from '../src/io/export';
const arg=(name:string,fallback:string)=>{const at=process.argv.indexOf(name);return at<0?fallback:process.argv[at+1]??fallback;};
const source=arg('--source',process.env.CONTAEZ_PRACTICE_SOURCE||path.resolve('private/practicas'));
const output=arg('--output',process.env.CONTAEZ_PRACTICE_OUTPUT||path.resolve('private/revisadas'));
const reportFile=arg('--report',path.resolve('../../work/practice-audit.json'));
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
async function exists(filename:string){try{await access(filename);return true;}catch{return false;}}
await mkdir(output,{recursive:true});await mkdir(path.dirname(reportFile),{recursive:true});
const names=(await readdir(source)).filter(name=>/\.xlsx$/i.test(name)&&!name.startsWith('~$')).sort();
const reports:any[]=[];const summary:any[]=[];let failures=0;
for(const name of names){
  const original=await readFile(path.join(source,name));const originalHash=hash(original);
  try{
    const result=await repairWorkbook(original,name);const verified=await auditWorkbook(result.data,name);const repeat=await repairWorkbook(result.data,name);
    if(repeat.changes.length)throw new Error(`La segunda revisión propone ${repeat.changes.length} cambios adicionales.`);
    let version=1;let destination:string;
    do{destination=path.join(output,`${name.replace(/\.xlsx$/i,'')}__revisada_v${String(version++).padStart(3,'0')}.xlsx`);}while(await exists(destination));
    await writeFile(destination,result.data,{flag:'wx'});
    if(hash(await readFile(path.join(source,name)))!==originalHash)throw new Error('El original cambió durante la revisión; confirmar que nadie lo editó.');
    reports.push({filename:name,originalHash,originalUnchanged:true,output:destination,before:result.before,after:verified,changes:result.changes,pending:result.pending,idempotent:true,nativeRecalculationVerified:false});
    summary.push({filename:name,changes:result.changes.length,errors:verified.stats.errors,warnings:verified.stats.warnings,pending:result.pending.length,output:path.basename(destination)});
    console.log(`${name}: ${result.changes.length} correcciones; ${result.pending.length} pendientes; original conservado.`);
  }catch(error){failures++;const message=error instanceof Error?error.message:String(error);reports.push({filename:name,originalHash,error:message});summary.push({filename:name,changes:0,errors:1,warnings:0,pending:1,output:`No generado: ${message}`});console.error(`${name}: ${message}`);}
}
const summaryName=path.join(output,'Resumen de revisión.xlsx');await writeFile(summaryName,await exportAuditSummary(summary));
await writeFile(reportFile,JSON.stringify({generatedAt:new Date().toISOString(),source,output,scope:'Correcciones demostrables, con originales intactos. No certifica auditoría integral ni recálculo nativo.',files:reports},null,2));
console.log(`Resumen: ${names.length} prácticas; ${failures} fallos de procesamiento. ${summaryName}`);
if(failures)process.exitCode=1;
