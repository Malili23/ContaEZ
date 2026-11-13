import { describe,it,expect } from 'vitest';
import ExcelJS from 'exceljs';
import { zipSync,unzipSync,strToU8,strFromU8 } from 'fflate';
import { auditWorkbook,repairWorkbook } from '../src/io/audit';
import { readRawWorkbook } from '../src/io/workbook';
import { parseCfdi,parseCsv,importFile } from '../src/io/import';
import { exportWorkbook } from '../src/io/export';
import { createProject, makeDemoProject, processProject } from '../src/core/index';
import type { SourceDocument } from '../src/core/types';

async function fixture(){const b=new ExcelJS.Workbook();const s=b.addWorksheet('Diario');s.getCell('B2').value=10;s.getCell('B3').value=20;s.getCell('B4').value={formula:'SUMA(B2:B7)',result:{error:'#NAME?'}};s.getCell('B5').value={formula:'B4-C4',result:30};s.getCell('C4').value=0;s.getCell('D2').value='#REF!';s.getCell('E2').value={formula:'F2',result:0};s.getCell('F2').value={formula:'E2',result:0};return new Uint8Array(await b.xlsx.writeBuffer());}
const source=():SourceDocument=>({id:'doc',name:'factura.xml',mime:'application/xml',hash:'x',importedAt:'2026-01-31T00:00:00Z',status:'pending'});
describe('Revisión conservadora de libros',()=>{
  it('detecta errores de texto, SUMA localizada y ciclos transitivos; compone la reparación y es repetible',async()=>{
    const original=await fixture();const audit=await auditWorkbook(original,'prueba.xlsx');expect(audit.findings.some(f=>f.code==='CACHED_ERROR'&&f.cell==='D2')).toBe(true);expect(audit.findings.some(f=>f.code==='CIRCULAR_REFERENCE'&&f.cell==='E2')).toBe(true);
    const repaired=await repairWorkbook(original,'prueba.xlsx');const book=readRawWorkbook(repaired.data);expect(book.sheets[0].cells.get('B4')?.formula).toBe('SUM(B2:B3)');expect(book.sheets[0].cells.get('D2')?.value).toBe('#REF!');expect((await repairWorkbook(repaired.data,'otra.xlsx')).changes).toHaveLength(0);expect(book.sheets.some(s=>s.name==='Revisión ContaEZ')).toBe(true);
  });
  it('conserva partes ajenas del paquete e informa referencias cuya intención se perdió',async()=>{
    const files=unzipSync(await fixture());files['custom/private-note.txt']=strToU8('dato original');let sheet=strFromU8(files['xl/worksheets/sheet1.xml']);sheet=sheet.replace('F2</f>','F2+#REF!</f>');files['xl/worksheets/sheet1.xml']=strToU8(sheet);const fixed=await repairWorkbook(zipSync(files),'prueba.xlsx');expect(strFromU8(unzipSync(fixed.data)['custom/private-note.txt'])).toBe('dato original');expect(fixed.pending.some(f=>f.code==='BROKEN_REFERENCE')).toBe(true);
  });
  it('no altera registros correctos',async()=>{const b=new ExcelJS.Workbook(),s=b.addWorksheet('Datos');s.addRow(['Base',100]);s.getCell('B2').value={formula:'B1*0.16',result:16};const bytes=new Uint8Array(await b.xlsx.writeBuffer());const r=await repairWorkbook(bytes,'bien.xlsx');expect(r.changes).toHaveLength(0);expect(readRawWorkbook(r.data).sheets[0].cells.get('B2')?.formula).toBe('B1*0.16');});
  it('tolera estilos fuera del rango de una biblioteca, sin depender de Excel para leer datos',async()=>{const bytes=await fixture(),files=unzipSync(bytes);files['xl/styles.xml']=strToU8(strFromU8(files['xl/styles.xml']).replace(/<family val="[^"]*"\/>/,'<family val="18"/>'));const b=readRawWorkbook(zipSync(files));expect(b.sheets[0].cells.get('B2')?.value).toBe('10');});
  it('materializa las copias de una fórmula compartida cuando se repara su maestro',async()=>{
    const book=new ExcelJS.Workbook(),sheet=book.addWorksheet('Mayor');sheet.getCell('A1').value=10;sheet.getCell('B1').value=20;sheet.getCell('A2').value={formula:'SUMA(A1:A1)',result:10};sheet.getCell('B2').value={formula:'SUMA(B1:B1)',result:20};
    const files=unzipSync(new Uint8Array(await book.xlsx.writeBuffer()));let xml=strFromU8(files['xl/worksheets/sheet1.xml']);xml=xml.replace('<f>SUMA(A1:A1)</f>','<f t="shared" ref="A2:B2" si="0">SUMA(A1:A1)</f>').replace('<f>SUMA(B1:B1)</f>','<f t="shared" si="0"/>');files['xl/worksheets/sheet1.xml']=strToU8(xml);
    const result=await repairWorkbook(zipSync(files),'shared.xlsx');const output=readRawWorkbook(result.data);expect(output.sheets[0].cells.get('A2')?.formula).toBe('SUM(A1:A1)');expect(output.sheets[0].cells.get('B2')?.formula).toBe('SUM(B1:B1)');expect(output.sheets[0].xml).not.toContain('t="shared"');
  });
});
describe('Documentos y bases fiscales',()=>{
  it('separa subtotal e IVA y deja la propuesta pendiente, sin gravar de nuevo el total',()=>{
    const p=createProject('business');p.rfc='AAA010101AAA';const xml=`<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" Version="4.0" Fecha="2026-01-10T12:00:00" TipoDeComprobante="I" SubTotal="1000.00" Total="1160.00" MetodoPago="PPD"><cfdi:Emisor Rfc="AAA010101AAA"/><cfdi:Receptor Rfc="BBB010101BBB"/><cfdi:Conceptos><cfdi:Concepto Descripcion="Venta"/></cfdi:Conceptos><cfdi:Impuestos><cfdi:Traslados><cfdi:Traslado Impuesto="002" TasaOCuota="0.160000" Importe="160.00"/></cfdi:Traslados></cfdi:Impuestos></cfdi:Comprobante>`;const result=parseCfdi(xml,p,source());expect(result.operations[0]).toMatchObject({amount:'1000.00',vatRate:'0.160000',confirmed:false,paymentMethod:'credit',type:'sale'});
  });
  it('maneja comillas en CSV y conserva cargos/abonos sin crear ingresos duplicados',async()=>{expect(parseCsv('Fecha;Concepto;Importe\n01/01/2026;"Pago; proveedor";-1160')).toEqual([['Fecha','Concepto','Importe'],['01/01/2026','Pago; proveedor','-1160']]);const f=new File(['Fecha,Concepto,Cargo,Abono\n01/01/2026,Pago,1160,0\n02/01/2026,Cobro,0,2320'],'banco.csv',{type:'text/csv'});const result=await importFile(f,createProject('business'));expect(result.bankTransactions.map(t=>t.amount)).toEqual(['-1160','2320']);expect(result.operations).toHaveLength(0);});
  it('deduplica el mismo contenido antes de proponer registros',async()=>{const f=new File(['Fecha,Concepto,Importe\n01/01/2026,Pago,-10'],'banco.csv');const p=createProject('business');const first=await importFile(f,p);p.documents=first.documents;const duplicate=await importFile(f,p);expect(duplicate.documents[0].status).toBe('duplicate');expect(duplicate.bankTransactions).toHaveLength(0);});
  it('no interpreta importes USD como MXN',()=>{const result=parseCfdi('<Comprobante Version="4.0" TipoDeComprobante="I" Moneda="USD" SubTotal="100" Total="116"><Emisor Rfc="AAA"/><Receptor Rfc="BBB"/></Comprobante>',createProject('business'),source());expect(result.operations).toHaveLength(0);expect(result.issues.some(i=>i.code==='CFDI_CURRENCY')).toBe(true);});
});
describe('Exportación compartida',()=>{
  it('vincula Diario→Mayor→Balanza→Estados, con cachés consistentes y sin errores de referencia',async()=>{
    const p=makeDemoProject('business'),result=processProject(p);const data=await exportWorkbook(p,result);const b=readRawWorkbook(data);expect(b.sheets).toHaveLength(16);const balance=b.sheets.find(s=>s.name==='Balance general')!;expect(balance.cells.get('B5')?.value).toBe(String(Number(result.balanceSheet.assets)));expect(balance.cells.get('B8')?.formula).toContain('Estados de resultados');const mayor=b.sheets.find(s=>s.name==='Esquemas de mayor')!;expect(mayor.cells.get('C5')?.formula).toContain('Diario');const audit=await auditWorkbook(data,'exportado.xlsx');expect(audit.findings.filter(f=>f.code==='BROKEN_REFERENCE'||f.code==='CIRCULAR_REFERENCE')).toHaveLength(0);
    const inventory=b.sheets.find(s=>s.name==='Inventario')!;expect(inventory.cells.get('G5')?.formula).toBe('0+E5-F5');expect(inventory.cells.get('J5')?.formula).toBe('0+IF(E5>0,I5,-I5)');
  });
});
