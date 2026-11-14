import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { auditWorkbook, repairWorkbook } from '../src/io/audit';
import { importFile } from '../src/io/import';
import { readRawWorkbook, referenceKeys, updateCellFormula, writeRawWorkbook } from '../src/io/workbook';
import { createProject } from '../src/core';

describe('Referencias, preservación y formatos de Excel',()=>{
  it('distingue funciones, nombres y literales de las referencias, también en minúsculas',async()=>{
    const wb=new ExcelJS.Workbook(),s=wb.addWorksheet('Hoja1');s.getCell('A1').value=10;s.getCell('LOG10').value={formula:'LOG10(A1)',result:1};
    const data=new Uint8Array(await wb.xlsx.writeBuffer()),book=readRawWorkbook(data);
    expect(referenceKeys('LOG10(a1)+N("B9")+Mi_A3','Hoja1',book)).toEqual(['Hoja1!A1']);
    expect(referenceKeys("'Hoja1'!a1",'Hoja1',book)).toEqual(['Hoja1!A1']);
    expect((await auditWorkbook(data,'Funciones.xlsx')).findings.some(f=>f.code==='CIRCULAR_REFERENCE')).toBe(false);
  });
  it('detecta ciclos en columnas completas y rangos grandes sin expandir las celdas vacías',async()=>{
    const wb=new ExcelJS.Workbook(),s=wb.addWorksheet('Diario');s.getCell('A1').value={formula:'SUM(A:A)',result:0};s.getCell('B1').value={formula:'SUM(B1:B100000)',result:0};
    const data=new Uint8Array(await wb.xlsx.writeBuffer()),audit=await auditWorkbook(data,'Rangos.xlsx');
    expect(audit.findings.filter(f=>f.code==='CIRCULAR_REFERENCE').map(f=>f.cell).sort()).toEqual(['A1','B1']);
  });
  it('expande fórmulas compartidas sin desplazar nombres de hojas ni alterar $& de criterios',async()=>{
    const wb=new ExcelJS.Workbook(),s=wb.addWorksheet('Mayor');wb.addWorksheet('Hoja1').getCell('A1').value=10;
    s.getCell('A2').numFmt='0.00';s.getCell('B2').value={formula:'SUMA(\'Hoja1\'!A1)+COUNTIF(A1:A1,"$&")',result:10};s.getCell('C2').value={formula:'SUMA(\'Hoja1\'!B1)+COUNTIF(B1:B1,"$&")',result:0};
    const files=unzipSync(new Uint8Array(await wb.xlsx.writeBuffer()));files['xl/worksheets/sheet1.xml']=strToU8(strFromU8(files['xl/worksheets/sheet1.xml']).replace(/<f>SUMA\([\s\S]*?<\/f>/,match=>match.replace('<f>','<f t="shared" ref="B2:C2" si="0">')).replace(/(<c\b[^>]*r="C2"[^>]*>)<f>[\s\S]*?<\/f>/,'$1<f t="shared" si="0"/>'));
    const input=zipSync(files),before=readRawWorkbook(input);expect(before.sheets[0].cells.get('C2')?.formula).toBe('SUMA(\'Hoja1\'!B1)+COUNTIF(B1:B1,"$&")');
    const result=readRawWorkbook((await repairWorkbook(input,'Compartidas.xlsx')).data);
    expect(result.sheets[0].cells.get('B2')?.formula).toBe('SUM(\'Hoja1\'!A1)+COUNTIF(A1:A1,"$&")');expect(result.sheets[0].cells.get('C2')?.formula).toBe('SUM(\'Hoja1\'!B1)+COUNTIF(B1:B1,"$&")');
    expect(result.sheets[0].xml).not.toContain('t="shared"');
  });
  it('reemplaza una etiqueta f vacía una sola vez y conserva las extensiones después de la fórmula',async()=>{
    const wb=new ExcelJS.Workbook(),s=wb.addWorksheet('Datos');s.getCell('A1').value=1;s.getCell('C2').value={formula:'A1',result:1};
    const files=unzipSync(new Uint8Array(await wb.xlsx.writeBuffer()));files['xl/worksheets/sheet1.xml']=strToU8(strFromU8(files['xl/worksheets/sheet1.xml']).replace('<f>A1</f><v>1</v>','<f/><v/><extLst><ext uri="test"/></extLst>'));
    const book=readRawWorkbook(zipSync(files));updateCellFormula(book.sheets[0],'C2','SUM($A$1:$A$100)');const xml=book.sheets[0].xml.match(/<c\b[^>]*r="C2"[^>]*>([\s\S]*?)<\/c>/)![1];
    expect(xml.match(/<f(?:\s|>)/g)).toHaveLength(1);expect(xml.indexOf('<f>')).toBeLessThan(xml.indexOf('<extLst>'));expect(readRawWorkbook(writeRawWorkbook(book)).sheets[0].cells.get('C2')?.formula).toBe('SUM($A$1:$A$100)');
  });
  it('no traduce SUMA ni repara #REF! que sean texto dentro de una fórmula válida',async()=>{
    const wb=new ExcelJS.Workbook(),s=wb.addWorksheet('Datos');s.getCell('A1').value=1;s.getCell('B1').value={formula:'IF(A1=1,"SUMA(A1)","#REF!")',result:'SUMA(A1)'};s.getCell('C1').value={formula:'SUMA(A1)+IF(A1=1,0,"SUMA(")',result:1};
    const result=await repairWorkbook(new Uint8Array(await wb.xlsx.writeBuffer()),'Textos.xlsx'),book=readRawWorkbook(result.data);
    expect(result.changes).toHaveLength(1);expect(result.before.findings.some(f=>f.code==='BROKEN_REFERENCE')).toBe(false);expect(book.sheets[0].cells.get('B1')?.formula).toBe('IF(A1=1,"SUMA(A1)","#REF!")');expect(book.sheets[0].cells.get('C1')?.formula).toBe('SUM(A1)+IF(A1=1,0,"SUMA(")');
  });
  it('respeta el calendario 1904 de libros Mac y rutas relativas de partes del paquete',async()=>{
    const wb=new ExcelJS.Workbook();wb.properties.date1904=true;const s=wb.addWorksheet('Operaciones');s.getCell('A4').value='id';s.getCell('A5').value='op-1';s.getCell('B5').value=new Date('2026-01-15T00:00:00Z');s.getCell('C5').value='sale';s.getCell('D5').value='Ventas';s.getCell('E5').value=100;s.getCell('F5').value=0.16;s.getCell('G5').value='credit';
    const files=unzipSync(new Uint8Array(await wb.xlsx.writeBuffer()));files['xl/_rels/workbook.xml.rels']=strToU8(strFromU8(files['xl/_rels/workbook.xml.rels']).replace('Target="worksheets/sheet1.xml"','Target="../xl/worksheets/sheet1.xml"'));const bytes=zipSync(files);
    expect(readRawWorkbook(bytes).date1904).toBe(true);const result=await importFile(new File([new Uint8Array(bytes).buffer],'Mac.xlsx'),createProject('business'));expect(result.operations[0]?.date).toBe('2026-01-15');expect(readRawWorkbook(writeRawWorkbook(readRawWorkbook(bytes))).date1904).toBe(true);
  });
  it('rechaza importes inválidos y fechas imposibles en CSV en vez de convertirlos a ceros',async()=>{
    const csv='Fecha;Concepto;Cargo;Abono\n2026-02-30;Fecha imposible;10;\n2026-01-10;Cargo ilegible;abc;100\n2026-01-11;Vacío;;\n2026-01-12;Coma decimal;1.234,56;\n2026-01-13;Punto decimal;;2,345.67';
    const result=await importFile(new File([csv],'Banco.csv'),createProject('business'));expect(result.bankTransactions.map(t=>t.amount)).toEqual(['-1234.56','2345.67']);expect(result.issues.some(i=>i.code==='CSV_ROWS_PENDING')).toBe(true);
  });
});
