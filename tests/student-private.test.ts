import { describe, expect, it } from 'vitest';
import { access, readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { repairStudentPractice } from '../src/io/student';
import { readRawWorkbook } from '../src/io/workbook';

const privateSource=process.env.CONTAEZ_PRIVATE_PRACTICES;
const rgeSource=process.env.CONTAEZ_RGE_REFERENCE;
const hash=(data:Uint8Array)=>createHash('sha256').update(data).digest('hex');
describe.skipIf(!privateSource)('Prácticas privadas opcionales, sin alterar sus originales',()=>{
  it('mantiene entradas y componentes en los ocho libros y conecta la copia de la práctica completa',async()=>{
    const names=(await readdir(privateSource!)).filter(n=>/\.xlsx$/i.test(n)&&!n.startsWith('~$'));expect(names).toHaveLength(8);
    const summaries=[] as unknown[];let connected=false;
    for(const name of names){
      const file=path.join(privateSource!,name),data=await readFile(file),originalHash=hash(data),before=readRawWorkbook(data),result=await repairStudentPractice(data,name),after=readRawWorkbook(result.data);
      expect(hash(await readFile(file))).toBe(originalHash);expect(after.sheets.filter(s=>s.name!=='Revisión ContaEZ').map(s=>s.name)).toEqual(before.sheets.map(s=>s.name));
      for(const sheet of before.sheets)for(const cell of sheet.cells.values())if(cell.formula===undefined&&!result.changes.some(f=>f.sheet===sheet.name&&f.cell===cell.address))expect(after.sheets.find(s=>s.name===sheet.name)?.cells.get(cell.address)?.value).toBe(cell.value);
      const originalParts=unzipSync(data),outputParts=unzipSync(result.data);for(const part of Object.keys(originalParts).filter(p=>/^(?:xl\/(?:media|drawings|theme)\/|xl\/styles\.xml$)/.test(p)))expect(outputParts[part]).toEqual(originalParts[part]);
      const again=await repairStudentPractice(result.data,name);expect(again.changes).toHaveLength(0);expect(readRawWorkbook(again.data).sheets.find(s=>s.name==='Revisión ContaEZ')?.xml).toBe(after.sheets.find(s=>s.name==='Revisión ContaEZ')?.xml);
      if(/mas completa/i.test(name)){
        connected=result.connections.some(c=>c.target.startsWith('Esquemas de mayor!'));summaries.push({name,changes:result.changes.length,connections:result.connections,pending:result.pending.length});
      }
      if(process.env.CONTAEZ_STUDENT_OUTPUT&&(!process.env.CONTAEZ_STUDENT_OUTPUT_TARGET||process.env.CONTAEZ_STUDENT_OUTPUT_TARGET===name)){await mkdir(process.env.CONTAEZ_STUDENT_OUTPUT,{recursive:true});let version=1,destination='';while(true){destination=path.join(process.env.CONTAEZ_STUDENT_OUTPUT,`${name.replace(/\.xlsx$/i,'')}__conectada_v${String(version++).padStart(3,'0')}.xlsx`);try{await access(destination);}catch{break;}}await writeFile(destination,result.data,{flag:'wx'});console.log(`Copia nueva: ${destination}`);}
      console.log(`${name}: ${result.changes.length} cambios; ${result.connections.length} conexiones; ${result.pending.length} pendientes; original intacto.`);
    }
    expect(connected).toBe(true);console.log(JSON.stringify(summaries));
  },120_000);
});
describe.skipIf(!rgeSource)('Plantilla RGE opcional con pólizas completas de ejemplo',()=>{
  it('rellena solo el vacío del mayor y conserva el resto de la plantilla',async()=>{
    const data=await readFile(rgeSource!),originalHash=hash(data),book=readRawWorkbook(data),diary=book.sheets.find(s=>s.name==='Diario')!;
    const dataCells=[['B7','Bancos'],['D7','100'],['E7','0'],['B8','Bancos'],['D8','0'],['E8','25'],['B9','Capital'],['D9','0'],['E9','75']];
    // This is a synthetic copy, never the original school file. Its explicit
    // principal Debe/Haber postings provide an unambiguous accounting fixture.
    for(const [address,value]of dataCells){const re=new RegExp(`<c\\b([^>]*\\br="${address}"[^>]*)(?:\\/>|>[\\s\\S]*?<\\/c>)`);const tag=`<c r="${address}"${address.startsWith('B')?' t="inlineStr"':''}>${address.startsWith('B')?`<is><t>${value}</t></is>`:`<v>${value}</v>`}</c>`;if(re.test(diary.xml))diary.xml=diary.xml.replace(re,tag);else {const row=address.match(/\d+$/)![0],rowRe=new RegExp(`(<row\\b[^>]*\\br="${row}"[^>]*>)([\\s\\S]*?)(<\\/row>)`),emptyRow=new RegExp(`<row\\b([^>]*\\br="${row}"[^>]*)\\/>`);if(emptyRow.test(diary.xml))diary.xml=diary.xml.replace(emptyRow,`<row$1>${tag}</row>`);else if(rowRe.test(diary.xml))diary.xml=diary.xml.replace(rowRe,`$1$2${tag}$3`);else {let inserted=false;diary.xml=diary.xml.replace(/<row\b[^>]*\br="(\d+)"[^>]*(?:\/>|>[\s\S]*?<\/row>)/g,(existing,r:string)=>{if(!inserted&&Number(r)>Number(row)){inserted=true;return `<row r="${row}">${tag}</row>`+existing;}return existing;});if(!inserted)diary.xml=diary.xml.replace('</sheetData>',`<row r="${row}">${tag}</row></sheetData>`);}}}
    book.files[diary.path]=strToU8(diary.xml);const result=await repairStudentPractice(zipSync(book.files),'RGE con pólizas completas.xlsx'),output=readRawWorkbook(result.data);
    expect(output.sheets.find(s=>s.name==='Esquemas de mayor')?.cells.get('F2')?.formula).toContain('SUMIF');expect(result.connections.some(c=>c.target==='Esquemas de mayor!F2')).toBe(true);expect(hash(await readFile(rgeSource!))).toBe(originalHash);
    expect(output.sheets.find(s=>/Balaza/.test(s.name))?.cells.get('A6')?.value??'').toBe('');
  },60_000);
});
