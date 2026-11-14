import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { applyPracticeContextSuggestion, inspectPracticeContext } from '../src/io/context';
import { readRawWorkbook, updateCellFormula, writeRawWorkbook } from '../src/io/workbook';

interface FixtureOptions { formula?:string; base?:number; total?:number|string|null; header?:string; secondSheet?:boolean; secondTarget?:boolean; }
async function fixture({formula='SUM(#REF!)',base=100,total,header='Total',secondSheet=false,secondTarget=false}:FixtureOptions={}){
  const book=new ExcelJS.Workbook(),sheet=book.addWorksheet('Diario');
  sheet.addRow(['Base','IVA',header]);sheet.getCell('A2').value=base;sheet.getCell('B2').value=16;
  if(total!==undefined)sheet.getCell('C2').value=total;
  else sheet.getCell('C2').value=formula.includes('#REF!')?{formula,result:{error:'#REF!'}}:{formula,result:base+16};
  sheet.getCell('A2').numFmt='$#,##0.00';sheet.getCell('C2').numFmt='$#,##0.00';
  sheet.getCell('A5').value=base===100?'Empresa del estudiante':'Empresa del modelo';
  if(secondSheet)book.addWorksheet('Balanza').getCell('A1').value='Cuenta';
  if(secondTarget){sheet.getCell('D1').value='Diferencia';sheet.getCell('D2').value=formula.includes('#REF!')?{formula:'SUM(#REF!)',result:{error:'#REF!'}}:{formula:'A2-B2',result:base-16};}
  const files=unzipSync(new Uint8Array(await book.xlsx.writeBuffer()));files['custom/attachment.bin']=new Uint8Array([1,255,42]);files['xl/media/preserved.bin']=new Uint8Array([8,7,6]);return zipSync(files);
}
describe('Contexto de una práctica: propuesta de fórmula y confirmación separadas',()=>{
  it('propone la fórmula del modelo sin aplicar y confirma manteniendo cifras y componentes del estudiante',async()=>{
    const practice=await fixture(),model=await fixture({formula:'SUM(A2:B2)',base:999}),original=practice.slice();
    const context=inspectPracticeContext(practice,[{name:'Modelo correcto.xlsx',data:model}],'Diario!C2 no funciona');
    expect(context.focusedCells).toEqual([{sheet:'Diario',cell:'C2'}]);expect(context.suggestions).toHaveLength(1);
    expect(context.suggestions[0]).toMatchObject({source:'Modelo correcto.xlsx',targetSheet:'Diario',targetCell:'C2',formula:'SUM(A2:B2)',originalFormula:'SUM(#REF!)'});
    expect(practice).toEqual(original);expect(readRawWorkbook(practice).sheets[0].cells.get('C2')?.formula).toBe('SUM(#REF!)');
    const output=applyPracticeContextSuggestion(practice,context.suggestions[0]),result=readRawWorkbook(output);
    expect(result.sheets[0].cells.get('A2')?.value).toBe('100');expect(result.sheets[0].cells.get('B2')?.value).toBe('16');expect(result.sheets[0].cells.get('C2')?.formula).toBe('SUM(A2:B2)');
    expect(result.sheets[0].cells.get('A5')?.value).toBe('Empresa del estudiante');
    const review=result.sheets.find(s=>s.name==='Revisión ContaEZ')!;expect([...review.cells.values()].some(c=>c.value==='Contexto confirmado')).toBe(true);expect([...review.cells.values()].some(c=>c.value.includes('Modelo correcto.xlsx'))).toBe(true);
    const before=unzipSync(practice),after=unzipSync(output);for(const part of ['xl/styles.xml','custom/attachment.bin','xl/media/preserved.bin'])expect(after[part]).toEqual(before[part]);
  });
  it('rechaza diseño o etiquetas incompatibles y pide hoja cuando una celda es ambigua',async()=>{
    const practice=await fixture(),different=await fixture({formula:'SUM(A2:B2)',header:'Cuenta de otra estructura'});
    const mismatch=inspectPracticeContext(practice,[{name:'Otro diseño.xlsx',data:different}],'Diario!C2');expect(mismatch.suggestions).toHaveLength(0);expect(mismatch.notes.join(' ')).toContain('no coincide el diseño');
    const multi=await fixture({secondSheet:true}),model=await fixture({formula:'SUM(A2:B2)',secondSheet:true});
    const ambiguous=inspectPracticeContext(multi,[{name:'Modelo.xlsx',data:model}],'C2 no funciona');expect(ambiguous.suggestions).toHaveLength(0);expect(ambiguous.focusedCells).toHaveLength(0);expect(ambiguous.notes.join(' ')).toContain('es ambiguo');
    const explicit=inspectPracticeContext(multi,[{name:'Modelo.xlsx',data:model}],"Revisar 'Diario'!C2");expect(explicit.suggestions).toHaveLength(1);
  });
  it('rechaza vínculos externos, fuentes ausentes, referencias dinámicas y ciclos, incluso un destino vacío',async()=>{
    const practice=await fixture();
    for(const formula of ["'[Otro.xlsx]Diario'!A2",'INDIRECT("A2")',"'Hoja que falta'!A2",'SUM(A2:C2)','SUM(A:A)','SUM(A1:C100000)']){
      const model=await fixture({formula}),context=inspectPracticeContext(practice,[{name:'Modelo.xlsx',data:model}],'Diario!C2');expect(context.suggestions,formula).toHaveLength(0);expect(context.notes.length,formula).toBeGreaterThan(0);
    }
    const blank=await fixture({total:null}),selfModel=await fixture({formula:'SUM(A2:C2)'});expect(inspectPracticeContext(blank,[{name:'Modelo.xlsx',data:selfModel}],'Diario!C2').suggestions).toHaveLength(0);
    // The model itself has the indirect cycle C2 → D2 → C2.
    const source=new ExcelJS.Workbook(),s=source.addWorksheet('Diario');s.addRow(['Base','IVA','Total']);s.getCell('A2').value=999;s.getCell('B2').value=16;s.getCell('C2').value={formula:'D2',result:1};s.getCell('D2').value={formula:'C2',result:1};
    expect(inspectPracticeContext(practice,[{name:'Modelo cíclico.xlsx',data:new Uint8Array(await source.xlsx.writeBuffer())}],'Diario!C2').suggestions).toHaveLength(0);
  });
  it('conserva datos literales y rechaza importes o texto fijo del modelo',async()=>{
    const model=await fixture({formula:'SUM(A2:B2)',base:999});
    for(const total of [116,'Importe confirmado']){const practice=await fixture({total});const context=inspectPracticeContext(practice,[{name:'Modelo.xlsx',data:model}],'Diario!C2');expect(context.suggestions).toHaveLength(0);expect(context.notes.join(' ')).toContain('dato capturado');expect(readRawWorkbook(practice).sheets[0].cells.get('C2')?.value).toBe(String(total));}
    const practice=await fixture();for(const formula of ['SUM(A2:B2)+999','IF(A2>0,"Empresa del modelo","")'])expect(inspectPracticeContext(practice,[{name:'Modelo.xlsx',data:await fixture({formula})}],'Diario!C2').suggestions,formula).toHaveLength(0);
  });
  it('mantiene alternativas conflictivas para elección manual y rechaza una propuesta obsoleta',async()=>{
    const practice=await fixture(),references=[{name:'Modelo suma.xlsx',data:await fixture({formula:'SUM(A2:B2)'})},{name:'Modelo resta.xlsx',data:await fixture({formula:'A2-B2'})}];
    const first=inspectPracticeContext(practice,references,'Diario!C2'),second=inspectPracticeContext(practice,references,'Diario!C2');
    expect(first.suggestions).toHaveLength(2);expect(new Set(first.suggestions.map(s=>s.formula)).size).toBe(2);expect(second.suggestions.map(s=>s.id)).toEqual(first.suggestions.map(s=>s.id));
    expect(first.notes.some(note=>note.includes('Elige una sola alternativa'))).toBe(true);
    const output=applyPracticeContextSuggestion(practice,first.suggestions[0]);expect(()=>applyPracticeContextSuggestion(output,first.suggestions[1])).toThrow(/cambió desde la propuesta/);
    const changed=readRawWorkbook(practice);updateCellFormula(changed.sheets[0],'C2','A2');expect(()=>applyPracticeContextSuggestion(writeRawWorkbook(changed),first.suggestions[0])).toThrow(/cambió desde la propuesta/);
  });
  it('permite dos destinos confirmados sin una huella global que invalide el segundo',async()=>{
    const practice=await fixture({secondTarget:true}),model=await fixture({formula:'SUM(A2:B2)',base:999,secondTarget:true});
    const context=inspectPracticeContext(practice,[{name:'Modelo.xlsx',data:model}],'Diario!C2 y Diario!D2');expect(context.suggestions).toHaveLength(2);
    let output:Uint8Array=practice;for(const suggestion of context.suggestions)output=applyPracticeContextSuggestion(output,suggestion);
    const result=readRawWorkbook(output);expect(result.sheets[0].cells.get('C2')?.formula).toBe('SUM(A2:B2)');expect(result.sheets[0].cells.get('D2')?.formula).toBe('A2-B2');expect(result.sheets.filter(s=>s.name==='Revisión ContaEZ')).toHaveLength(1);
  });
  it('trata fotos, PDF y CFDI como contexto revisable, sin copiar su contenido ni generar fórmulas',async()=>{
    const context=inspectPracticeContext(await fixture(),[{name:'Póliza.png',data:new Uint8Array([1,2]),text:'Dato privado que no debe aparecer en notas'},{name:'Guía.pdf',data:new Uint8Array([3]),text:'Confirmar el asiento'},{name:'Factura.xml',data:strToU8('<Comprobante Total="9999"/>')}],'Diario!C2 no funciona');
    expect(context.suggestions).toHaveLength(0);expect(context.notes.join(' ')).toContain('Póliza.png');expect(context.notes.join(' ')).toContain('Guía.pdf');expect(context.notes.join(' ')).toContain('Factura.xml');expect(context.notes.join(' ')).not.toContain('Dato privado');expect(context.notes.join(' ')).not.toContain('9999');
  });
  it('no propone propagar un error literal que el modelo no contiene',async()=>{
    const practice=await fixture(),files=unzipSync(practice);files['xl/worksheets/sheet1.xml']=strToU8(new TextDecoder().decode(files['xl/worksheets/sheet1.xml']).replace(/<c\b([^>]*r="A2"[^>]*)>[\s\S]*?<\/c>/,'<c r="A2" t="e"><v>#VALUE!</v></c>'));
    const result=inspectPracticeContext(zipSync(files),[{name:'Modelo.xlsx',data:await fixture({formula:'SUM(A2:B2)',base:999})}],'Diario!C2');expect(result.suggestions).toHaveLength(0);expect(result.notes.join(' ')).toContain('error guardado');
  });
});
