import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { repairStudentPractice } from '../src/io/student';
import { readRawWorkbook, referenceKeys } from '../src/io/workbook';

async function fixture(account='Bancos',debit=100){
  const b=new ExcelJS.Workbook(),diary=b.addWorksheet('Diario');
  diary.addRows([['Cuenta','Debe','Haber'],[account,debit,0],[account,0,25],['Capital',0,debit-25]]);
  diary.getCell('B2').numFmt='$#,##0.00';diary.getCell('B2').fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF123456'}};
  const mayor=b.addWorksheet('Esquemas de mayor');mayor.getCell('B1').value=account;mayor.getCell('B6').value={formula:'SUM(B2:B5)',result:0};mayor.getCell('C6').value={formula:'SUM(C2:C5)',result:0};mayor.getCell('B7').value={formula:'B6-C6',result:0};
  const balance=b.addWorksheet('Balanza de comprobación');balance.addRows([['Cuenta','Movimientos',null,'Saldos'],[null,'Deudor','Acreedor','Deudor','Acreedor'],[account],["Capital"],['Sumas iguales']]);
  const report=b.addWorksheet('Estados de resultados');report.addRows([['Cuenta','Deudor','Acreedor'],[account]]);
  const files=unzipSync(new Uint8Array(await b.xlsx.writeBuffer()));files['custom/private-data.bin']=new Uint8Array([0,0,255,21]);files['xl/media/preserved-image.bin']=new Uint8Array([9,8,7]);
  return zipSync(files);
}
describe('Prácticas dentro del libro que sube el estudiante',()=>{
  it('conecta Diario → Mayor/Balanza → estado conservando entradas, estilos y partes ajenas del ZIP',async()=>{
    const input=await fixture(),original=readRawWorkbook(input),result=await repairStudentPractice(input,'Mi práctica.xlsx'),book=readRawWorkbook(result.data);
    expect(book.sheets.map(s=>s.name)).toEqual(['Diario','Esquemas de mayor','Balanza de comprobación','Estados de resultados','Revisión ContaEZ']);
    const mayor=book.sheets[1];expect(mayor.cells.get('B2')?.formula).toContain('SUMIF');expect(mayor.cells.get('B2')?.formula).toContain("'Diario'!$B$2:$B$4");
    expect(book.sheets[2].cells.get('D3')?.formula).toBe('MAX(0,B3-C3)');expect(book.sheets[3].cells.get('B2')?.formula).toBe("'Balanza de comprobación'!D3");
    expect(book.sheets[0].xml).toBe(original.sheets[0].xml);expect(book.sheets[0].cells.get('B2')?.value).toBe('100');
    const old=unzipSync(input),out=unzipSync(result.data);for(const path of ['xl/styles.xml','xl/media/preserved-image.bin','custom/private-data.bin'])expect(out[path]).toEqual(old[path]);
    expect(result.connections.some(c=>c.target==='Esquemas de mayor!B2')).toBe(true);expect(result.after.nativeRecalculationVerified).toBe(false);
    const again=await repairStudentPractice(result.data,'Mi práctica.xlsx');expect(again.changes).toHaveLength(0);expect(readRawWorkbook(again.data).sheets).toHaveLength(5);expect(readRawWorkbook(again.data).sheets[4].xml).toBe(book.sheets[4].xml);
  });
  it('las fórmulas conservan referencias vivas al archivo y procesar otro libro no contamina el primero',async()=>{
    const first=await repairStudentPractice(await fixture('Bancos',100),'Uno.xlsx');
    const second=await repairStudentPractice(await fixture('Caja',900),'Dos.xlsx');
    const one=readRawWorkbook(first.data),two=readRawWorkbook(second.data),formula=one.sheets[1].cells.get('B2')!.formula!;
    expect(formula).toContain('"Bancos"');expect(formula).not.toContain('Caja');expect(two.sheets[1].cells.get('B2')?.formula).toContain('"Caja"');
    expect(referenceKeys(formula,'Esquemas de mayor',one)).toContain('Diario!B2');expect(one.sheets[0].cells.get('B2')?.value).toBe('100');expect(two.sheets[0].cells.get('B2')?.value).toBe('900');
  });
  it('escribe referencias absolutas de tres dígitos en celdas vacías con estilo sin expandir $1 como reemplazo XML',async()=>{
    const b=new ExcelJS.Workbook(),d=b.addWorksheet('Diario');d.addRow(['Cuenta','Debe','Haber']);d.addRow(['Caja $&',100,0]);d.getCell('A100').value='Caja $&';d.getCell('B100').value=25;
    const m=b.addWorksheet('Esquemas de mayor');m.getCell('B1').value='Caja $&';m.getCell('B2').numFmt='#,##0.00';m.getCell('C2').numFmt='#,##0.00';m.getCell('B6').value={formula:'SUM(B2:B5)',result:0};m.getCell('C6').value={formula:'SUM(C2:C5)',result:0};
    const first=await repairStudentPractice(new Uint8Array(await b.xlsx.writeBuffer()),'Celdas vacías.xlsx'),book=readRawWorkbook(first.data),f=book.sheets[1].cells.get('B2')?.formula;
    expect(f).toBe('SUMIF(\'Diario\'!$A$2:$A$100,"Caja $&",\'Diario\'!$B$2:$B$100)');expect(f).not.toContain(' r=');
    const result=await repairStudentPractice(first.data,'Celdas vacías.xlsx');expect(readRawWorkbook(result.data).sheets[1].cells.get('B2')?.formula).toBe(f);
  });
  it('conserva números y asientos de un mayor ya ocupado, sin rellenar su otro lado por suposición',async()=>{
    const bytes=await fixture(),files=unzipSync(bytes);let xml=strFromU8(files['xl/worksheets/sheet2.xml']);xml=xml.replace('<sheetData>','<sheetData><row r="2"><c r="B2"><v>100</v></c></row>');files['xl/worksheets/sheet2.xml']=strToU8(xml);
    const result=await repairStudentPractice(zipSync(files),'Con captura.xlsx'),major=readRawWorkbook(result.data).sheets[1];expect(major.cells.get('B2')?.value).toBe('100');expect(major.cells.get('C2')?.formula).toBeUndefined();expect(result.changes.some(f=>f.sheet==='Esquemas de mayor')).toBe(false);
  });
  it('pregunta por la referencia perdida y usa la respuesta sin inventarla ni permitir ciclos',async()=>{
    const b=new ExcelJS.Workbook(),s=b.addWorksheet('Datos');s.getCell('A1').value=7;s.getCell('B1').value={formula:'SUM(#REF!)',result:{error:'#REF!'}};s.getCell('C1').value={formula:'B1',result:0};s.getCell('D1').value={formula:'#REF!-#REF!',result:{error:'#REF!'}};
    const input=new Uint8Array(await b.xlsx.writeBuffer()),initial=await repairStudentPractice(input,'Error.xlsx');const question=initial.questions.find(q=>q.id==='BROKEN_REFERENCE:Datos:B1')!;expect(question).toBeDefined();expect(initial.questions.some(q=>q.id==='BROKEN_REFERENCE:Datos:D1')).toBe(false);expect(initial.pending.some(f=>f.cell==='D1'&&f.code==='BROKEN_REFERENCE')).toBe(true);
    const fixed=await repairStudentPractice(initial.data,'Error.xlsx',{[question.id]:'Datos!A1'});expect(readRawWorkbook(fixed.data).sheets[0].cells.get('B1')?.formula).toBe("SUM('Datos'!A1)");
    const rejected=await repairStudentPractice(input,'Error.xlsx',{[question.id]:'Datos!C1'});expect(rejected.pending.some(f=>f.code==='BROKEN_REFERENCE')).toBe(true);
  });
  it('distingue parciales jerárquicos solo mediante dependencias existentes, conservando la columna fuente',async()=>{
    const b=new ExcelJS.Workbook(),d=b.addWorksheet('Diario');d.addRows([['Concepto','Parcial','Deudor','Acreedor'],['Efectivo',null,{formula:'B3+B4',result:125}],['Caja',25],['Bancos',100]]);
    const m=b.addWorksheet('Esquemas de mayor');m.getCell('F1').value='Bancos';m.getCell('F6').value={formula:'SUM(F2:F5)',result:0};m.getCell('G6').value={formula:'SUM(G2:G5)',result:0};
    const result=await repairStudentPractice(new Uint8Array(await b.xlsx.writeBuffer()),'Parciales.xlsx');expect(readRawWorkbook(result.data).sheets[1].cells.get('F2')?.formula).toBe("'Diario'!B4");
    expect(readRawWorkbook(result.data).sheets[0].cells.get('B4')?.value).toBe('100');
    d.getCell('C2').value=125;const ambiguous=await repairStudentPractice(new Uint8Array(await b.xlsx.writeBuffer()),'Parcial sin vínculo.xlsx');expect(readRawWorkbook(ambiguous.data).sheets[1].cells.get('F2')?.formula).toBeUndefined();expect(ambiguous.questions.some(q=>q.id.includes('Esquemas de mayor:F2'))).toBe(true);
    for(const formula of ['B3-B4','B3+B4*0.16','SUM(B3:B4)*2','B3+B4+B4','IF(B4>0,B4,0)']){d.getCell('C2').value={formula,result:125};const unsafe=await repairStudentPractice(new Uint8Array(await b.xlsx.writeBuffer()),'Relación no aditiva.xlsx');expect(readRawWorkbook(unsafe.data).sheets[1].cells.get('F2')?.formula,formula).toBeUndefined();}
    d.getCell('C2').value={formula:'SUM(B3:B4)',result:125};const summed=await repairStudentPractice(new Uint8Array(await b.xlsx.writeBuffer()),'SUM positivo.xlsx');expect(readRawWorkbook(summed.data).sheets[1].cells.get('F2')?.formula).toBe("'Diario'!B4");
  });
  it('confirma el año solo en encabezados y preserva fechas/operaciones capturadas',async()=>{
    const b=new ExcelJS.Workbook(),s=b.addWorksheet('Diario');s.getCell('A1').value='Enero de 2024';s.addRow(['Cuenta','Debe','Haber']);s.addRow(['Pago enero de 2024',100,0]);const report=b.addWorksheet('Balance general');report.getCell('A1').value='Enero de 2025';
    const input=new Uint8Array(await b.xlsx.writeBuffer()),initial=await repairStudentPractice(input,'Periodo.xlsx'),q=initial.questions.find(q=>q.id.startsWith('PERIOD_CONFLICT:'))!;expect(q).toBeDefined();
    const result=await repairStudentPractice(input,'Periodo.xlsx',{[q.id]:'2026'}),book=readRawWorkbook(result.data);expect(book.sheets[0].cells.get('A1')?.value).toBe('Enero de 2026');expect(book.sheets[1].cells.get('A1')?.value).toBe('Enero de 2026');expect(book.sheets[0].cells.get('A3')?.value).toBe('Pago enero de 2024');
  });
});
