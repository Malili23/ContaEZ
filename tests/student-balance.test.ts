import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { repairStudentPractice } from '../src/io/student';
import { readRawWorkbook } from '../src/io/workbook';

async function balanceFixture(options:{opening?:boolean;missingOpening?:boolean;adjusted?:boolean;captured?:boolean;ambiguous?:boolean;cycle?:boolean;codes?:boolean}={}){
  const wb=new ExcelJS.Workbook(),d=wb.addWorksheet('Diario'),b=wb.addWorksheet('Balanza de comprobación');
  if(options.codes){d.addRows([['Código','Cuenta','Debe','Haber'],[101,'Bancos',100,25]]);b.addRows([['Código','Cuenta','Movimientos',null,'Saldos'],[null,null,'Deudor','Acreedor','Deudor','Acreedor'],[101,'Nombre distinto']]);}
  else{d.addRows([['Cuenta','Debe','Haber'],['Bancos',options.cycle?{formula:"'Balanza de comprobación'!B3",result:0}:100,25]]);
    if(options.opening)b.addRows([['Cuenta','Saldos iniciales',null,'Movimientos',null,'Saldos finales'],[null,'Deudor','Acreedor','Deudor','Acreedor','Deudor','Acreedor'],['Bancos',options.missingOpening?null:500,options.missingOpening?null:0,100,25]]);
    else b.addRows([['Cuenta',options.ambiguous?null:'Movimientos',null,options.ambiguous?null:'Saldos'],[null,'Deudor','Acreedor','Deudor','Acreedor'],['Bancos',options.captured?100:null,options.captured?25:null]]);
  }
  if(options.adjusted)b.getCell('I3').value='Con ajustes';return new Uint8Array(await wb.xlsx.writeBuffer());
}
describe('Columnas y fuentes de la balanza de una práctica',()=>{
  it('conserva aperturas capturadas y las incorpora al saldo final; no inventa aperturas ausentes',async()=>{
    const complete=readRawWorkbook((await repairStudentPractice(await balanceFixture({opening:true}),'Apertura.xlsx')).data).sheets[1];
    expect(complete.cells.get('B3')?.value).toBe('500');expect(complete.cells.get('C3')?.value).toBe('0');expect(complete.cells.get('F3')?.formula).toBe('MAX(0,(B3-C3)+(D3-E3))');expect(complete.cells.get('G3')?.formula).toBe('MAX(0,-(B3-C3)-(D3-E3))');
    const missing=await repairStudentPractice(await balanceFixture({opening:true,missingOpening:true}),'Sin apertura.xlsx'),sheet=readRawWorkbook(missing.data).sheets[1];expect(sheet.cells.get('B3')?.formula).toBeUndefined();expect(sheet.cells.get('C3')?.formula).toBeUndefined();expect(sheet.cells.get('F3')?.formula).toBeUndefined();expect(missing.pending.some(p=>p.cell==='F3')).toBe(true);
  });
  it('no mezcla todos los movimientos en bloques con ajustes y sí deriva saldos de movimientos capturados',async()=>{
    const ambiguous=await repairStudentPractice(await balanceFixture({adjusted:true}),'Ajustes.xlsx'),sheet=readRawWorkbook(ambiguous.data).sheets[1];expect(sheet.cells.get('B3')?.formula).toBeUndefined();expect(sheet.cells.get('D3')?.formula).toBeUndefined();expect(ambiguous.pending.some(p=>p.suggestion.includes('ajustes'))).toBe(true);
    const captured=readRawWorkbook((await repairStudentPractice(await balanceFixture({adjusted:true,captured:true}),'Ajustes capturados.xlsx')).data).sheets[1];expect(captured.cells.get('B3')?.value).toBe('100');expect(captured.cells.get('D3')?.formula).toBe('MAX(0,B3-C3)');
  });
  it('deja pendientes cabeceras repetidas sin función clara y reconoce códigos de la fila superior',async()=>{
    const ambiguous=await repairStudentPractice(await balanceFixture({ambiguous:true}),'Columnas.xlsx');expect(ambiguous.changes).toHaveLength(0);expect(ambiguous.pending.some(p=>p.code==='STUDENT_ACCOUNT_LAYOUT')).toBe(true);
    const coded=readRawWorkbook((await repairStudentPractice(await balanceFixture({codes:true}),'Códigos.xlsx')).data).sheets[1];expect(coded.cells.get('C3')?.formula).toContain('"101"');expect(coded.cells.get('C3')?.formula).toContain("'Diario'!$A$2:$A$2");
  });
  it('no crea un ciclo Diario→Balanza→Diario ni convierte las fuentes pendientes en saldo cero',async()=>{
    const result=await repairStudentPractice(await balanceFixture({cycle:true}),'Fuente circular.xlsx'),sheet=readRawWorkbook(result.data).sheets[1];expect(sheet.cells.get('B3')?.formula).toBeUndefined();expect(sheet.cells.get('D3')?.formula).toBeUndefined();expect(result.after.findings.some(p=>p.code==='CIRCULAR_REFERENCE')).toBe(false);expect(result.pending.some(p=>p.cell==='B3')).toBe(true);
  });
});
