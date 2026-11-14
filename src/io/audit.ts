import Decimal from 'decimal.js';
import { readRawWorkbook, referenceKeys, cellParts, columnName, cellCanReceiveFormula, updateCellFormula, appendReviewSheet, writeRawWorkbook, normalizeFormulaFunctions, brokenReferenceCount, formulaCode, type RawBook, type RawCell, type RawSheet } from './workbook';
export interface WorkbookFinding { id:string; code:string; severity:'error'|'warning'|'info'; sheet:string; cell:string; message:string; suggestion:string; repairable:boolean; replacement?:string; original?:string; }
export interface WorkbookAudit { filename:string; sheets:{name:string;formulas:number;populated:number}[]; findings:WorkbookFinding[]; formulaCount:number; externalLinks:string[]; hasMacros:boolean; stats:{errors:number;warnings:number;repairable:number;}; nativeRecalculationVerified:false; }
const errors=/^#(?:REF!|NAME\?|DIV\/0!|VALUE!|N\/A|NUM!|NULL!|SPILL!|CALC!)/i;
const normalized=(s:string)=>s.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase();
function reaches(book:RawBook, sheet:RawSheet, start:RawCell, target:string):boolean {
  const seen = new Set<string>();
  const pending = [`${sheet.name}!${start.address}`];
  while (pending.length) {
    const key = pending.pop()!;
    if (key === target) return true;
    if (seen.has(key)) continue;
    seen.add(key);
    const split = key.lastIndexOf('!');
    const source = book.sheets.find(candidate => candidate.name === key.slice(0, split));
    const formula = source?.cells.get(key.slice(split + 1))?.formula;
    if (source && formula) for (const ref of referenceKeys(formula, source.name, book)) pending.push(ref);
  }
  return false;
}
function hasLabel(sheet:RawSheet, cell:RawCell, label:RegExp):boolean {
  const [col,row] = cellParts(cell.address);
  for (let i = Math.max(1, col - 4); i < col; i++) {
    const candidate = sheet.cells.get(`${columnName(i)}${row}`);
    if (candidate && !candidate.formula && label.test(normalized(candidate.value).trim())) return true;
  }
  return false;
}
function numberCell(cell:RawCell|undefined):Decimal|undefined {
  if (!cell || cell.type !== 'n' || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(cell.value)) return;
  return new Decimal(cell.value);
}
function taxRate(formula:string, baseCell:string):Decimal|undefined {
  const expression = formula.replace(/^\+/, '').replace(/[$\s]/g, '').toUpperCase();
  const operands = expression.split('*');
  if (operands.length !== 2 || !operands.includes(baseCell)) return;
  const literal = operands.find(part => part !== baseCell);
  if (!literal || !/^(?:\d+(?:\.\d+)?|\.\d+)%?$/.test(literal)) return;
  return new Decimal(literal.replace(/%$/, '')).div(literal.endsWith('%') ? 100 : 1);
}
export function auditRawWorkbook(book:RawBook,filename:string):WorkbookAudit {
  const findings:WorkbookFinding[]=[];
  const findingIds = new Set<string>();
  const sheetsByName = new Map(book.sheets.map(sheet => [sheet.name,sheet]));
  const add=(finding:Omit<WorkbookFinding,'id'>)=>{
    const id = `${finding.code}:${finding.sheet}:${finding.cell}`;
    if (findingIds.has(id)) return;
    findingIds.add(id);
    const sheet = sheetsByName.get(finding.sheet);
    if (finding.repairable && sheet && !cellCanReceiveFormula(sheet, finding.cell)) {
      findings.push({...finding,id,repairable:false,replacement:undefined,suggestion:'Revisar el rango de celdas combinadas, fórmula matricial o tabla de datos antes de editarlo en Excel.'});
    } else findings.push({...finding,id});
  };
  const formulaCells=new Map<string,{sheet:string;cell:string;formula:string}>();
  for(const sheet of book.sheets.filter(s=>s.name!=='Revisión ContaEZ'))for(const cell of sheet.cells.values()){
    if(cell.formula!==undefined){
      const f=cell.formula;formulaCells.set(`${sheet.name}!${cell.address}`,{sheet:sheet.name,cell:cell.address,formula:f});
      if(normalizeFormulaFunctions(f)!==f)add({code:'LOCALIZED_FORMULA',severity:'error',sheet:sheet.name,cell:cell.address,message:'La función SUMA está guardada con nombre localizado dentro del archivo.',suggestion:'Guardar la función OOXML como SUM; Excel mostrará el nombre de su idioma.',repairable:true,original:f,replacement:normalizeFormulaFunctions(f)});
      if(brokenReferenceCount(f))add({code:'BROKEN_REFERENCE',severity:'error',sheet:sheet.name,cell:cell.address,message:'La fórmula contiene una referencia eliminada.',suggestion:'Indicar la cuenta o celda original; no se puede reconstruir solo a partir de #REF!.',repairable:false,original:f});
      const selfSum=f.match(/^\+?(?:SUM|SUMA)\(\$?([A-Z]+)\$?(\d+):\$?([A-Z]+)\$?(\d+)\)$/i);
      if(selfSum){const [,c1,r1,c2,r2]=selfSum;const [col,row]=cellParts(cell.address);
        if(c1.toUpperCase()===c2.toUpperCase()&&col===cellParts(`${c1}1`)[0]&&row>=Number(r1)&&row<=Number(r2)){
          const above=[...sheet.cells.values()].filter(c=>{const [cc,rr]=cellParts(c.address);return cc===col&&rr>=Number(r1)&&rr<row;});
          const below=[...sheet.cells.values()].filter(c=>{const [cc,rr]=cellParts(c.address);return cc===col&&rr>row&&rr<=Number(r2);});
          const target = `${sheet.name}!${cell.address}`;
          const existingInputs = above.some(c => numberCell(c) !== undefined || !!c.formula);
          const hasDependentInput = above.some(c => !!c.formula && reaches(book, sheet, c, target));
          const independentAmountsBelow = below.some(c => c.formula ? !reaches(book, sheet, c, target) : c.value !== '');
          const match = /^(\+?)(?:SUM|SUMA)\((\$?[A-Z]+\$?\d+):(\$?[A-Z]+\$?)\d+\)$/i.exec(f)!;
          if(existingInputs&&!hasDependentInput&&!independentAmountsBelow&&row>Number(r1))add({code:'SELF_SUM',severity:'error',sheet:sheet.name,cell:cell.address,message:'La suma incluye su propia celda y puede incluir el saldo derivado.',suggestion:'Sumar únicamente los movimientos anteriores al subtotal.',repairable:true,original:f,replacement:`${match[1]}SUM(${match[2]}:${match[3]}${row-1})`});
          else add({code:'SELF_REFERENCE',severity:'error',sheet:sheet.name,cell:cell.address,message:'La suma incluye su propia celda.',suggestion:'Reconstruir el rango con los movimientos fuente; la intención no es inequívoca.',repairable:false,original:f});
        }
      }
    }
    if(errors.test(cell.value.trim()))add({code:'CACHED_ERROR',severity:'error',sheet:sheet.name,cell:cell.address,message:`Resultado guardado ${cell.value}${cell.type==='s'?' como texto':''}.`,suggestion:cell.formula?'Revisar precedentes y recalcular en Excel.':'Verificar el origen: un texto de error no constituye un importe válido.',repairable:false});
    if(!cell.formula&&cell.value==='0'){
      const [c,r]=cellParts(cell.address);const labels=[...sheet.cells.values()].filter(x=>{const [cc,rr]=cellParts(x.address);return rr===r&&cc<c&&cc>=c-4;}).map(x=>normalized(x.value)).join(' ');
      if(/diferencia|comprobacion|comprobación/.test(labels))add({code:'HARDCODED_CHECK',severity:'warning',sheet:sheet.name,cell:cell.address,message:'Una comprobación está escrita como cero, sin fórmula.',suggestion:'Comparar de forma independiente los totales que esta comprobación debe verificar.',repairable:false});
    }
  }
  const graph=new Map<string,string[]>();for(const [key,f]of formulaCells)graph.set(key,referenceKeys(f.formula,f.sheet,book).filter(k=>formulaCells.has(k)));
  const color=new Map<string,number>(), cycles=new Set<string>();
  for(const key of graph.keys()) {
    if (color.has(key)) continue;
    const stack = [{ key, next: 0 }];
    const ancestors = new Map([[key, 0]]);
    color.set(key, 1);
    while (stack.length) {
      const frame = stack[stack.length - 1];
      const ref = graph.get(frame.key)?.[frame.next++];
      if (ref === undefined) {
        color.set(frame.key, 2);ancestors.delete(frame.key);stack.pop();
      } else if (!color.has(ref)) {
        color.set(ref, 1);ancestors.set(ref, stack.length);stack.push({ key: ref, next: 0 });
      } else if (color.get(ref) === 1) {
        for (let i = ancestors.get(ref)!; i < stack.length; i++) cycles.add(stack[i].key);
      }
    }
  }
  for(const key of cycles){const f=formulaCells.get(key)!;add({code:'CIRCULAR_REFERENCE',severity:'error',sheet:f.sheet,cell:f.cell,message:'La fórmula participa en una dependencia circular.',suggestion:'Separar movimientos, subtotal y saldo; después recalcular las dependencias.',repairable:false,original:f.formula});}
  // Detect a total-with-tax referenced as the tax-exclusive sales base.
  for(const sheet of book.sheets)if(normalized(sheet.name)==='ingreso'){
    const source=book.sheets.find(s=>normalized(s.name)==='ingresos');if(!source)continue;
    const headers = [...source.cells.values()].filter(c => {
      const [col] = cellParts(c.address);
      return col === 10 && !c.formula && /^sub\s*total(?:\s|$)/.test(normalized(c.value).trim());
    });
    for(const cell of sheet.cells.values())if(cell.formula){
      const ref=cell.formula.match(/^\+?'?INGRESOS'?!\$?L\$?(\d+)$/i);
      if(!ref || !hasLabel(sheet, cell, /^(?:ventas?|ingresos? por ventas?)(?:\b|$)/))continue;
      const row=ref[1],base=numberCell(source.cells.get(`J${row}`)),vat=numberCell(source.cells.get(`K${row}`)),total=numberCell(source.cells.get(`L${row}`));
      if (!base?.gt(0) || !vat?.gt(0) || !total || base.plus(vat).minus(total).abs().gt('0.01')) continue;
      const correctHeaders = headers.some(header => {
        const [,r] = cellParts(header.address);
        return r < Number(row) && /^iva(?:\b|$)/.test(normalized(source.cells.get(`K${r}`)?.value ?? '').trim()) && /^total(?:\b|$)/.test(normalized(source.cells.get(`L${r}`)?.value ?? '').trim());
      });
      if (!correctHeaders) continue;
      const taxFormula = [...sheet.cells.values()].some(candidate => {
        if (!candidate.formula || !hasLabel(sheet, candidate, /^(?:iva|impuesto)(?:\s+(?:por trasladar|trasladado|cobrado|causado|16\s*%))?$/)) return false;
        const rate = taxRate(formulaCode(candidate.formula), cell.address);
        return rate?.eq('0.16') && base.times(rate).minus(vat).abs().lte('0.01');
      });
      if(taxFormula)add({code:'VAT_ON_GROSS',severity:'error',sheet:sheet.name,cell:cell.address,message:'Se usa el total con IVA como base de ventas y se vuelve a calcular IVA.',suggestion:'Vincular ventas al subtotal J y conservar el IVA del comprobante como impuesto separado.',repairable:true,original:cell.formula,replacement:cell.formula.replace(/L(\$?\d+)$/i,'J$1')});
    }
  }
  const periodMonths=new Map<string,Map<string,string[]>>();
  for(const sheet of book.sheets.filter(s=>s.name!=='Revisión ContaEZ'))for(const cell of sheet.cells.values())if(!cell.formula&&cell.value.length<5000){
    const re=/\b(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\s+(?:de(?:l)?\s+)?(20\d{2})\b/gi;let m:RegExpExecArray|null;
    while((m=re.exec(cell.value))){const month=normalized(m[1]);const years=periodMonths.get(month)??new Map<string,string[]>();years.set(m[2],[...(years.get(m[2])??[]),`${sheet.name}!${cell.address}`]);periodMonths.set(month,years);}
  }
  for(const [month,years]of periodMonths)if(years.size>1){const [year,refs]=[...years].sort((a,b)=>a[0].localeCompare(b[0]))[0];const at=refs[0],pos=at.lastIndexOf('!');add({code:'PERIOD_CONFLICT',severity:'warning',sheet:at.slice(0,pos),cell:at.slice(pos+1),message:`Se menciona ${month} de años distintos (${[...years.keys()].join(', ')}).`,suggestion:`Confirmar el ejercicio; se conserva el encabezado ${year} hasta recibir instrucciones.`,repairable:false});}
  for(const sheet of book.sheets)if(/balan|balance general|estado.*resultado/i.test(normalized(sheet.name))){
    const numeric=[...sheet.cells.values()].filter(c=>c.value!==''&&Number.isFinite(Number(c.value))&&c.type!=='s');
    if(numeric.length>0&&numeric.every(c=>Math.abs(Number(c.value))<0.005))add({code:'EMPTY_REPORT',severity:'warning',sheet:sheet.name,cell:'',message:'El reporte contiene únicamente importes cero o resultados sin completar.',suggestion:'Comprobar que las operaciones estén registradas y vinculadas; 0 = 0 no demuestra cobertura.',repairable:false});
  }
  const externalLinks=Object.keys(book.files).filter(p=>p.startsWith('xl/externalLinks/')&&p.endsWith('.xml'));
  if(externalLinks.length)add({code:'EXTERNAL_LINKS',severity:'warning',sheet:'Libro',cell:'',message:`Hay ${externalLinks.length} partes de vínculos externos.`,suggestion:'No se actualizarán conexiones externas automáticamente; adjuntar las fuentes necesarias.',repairable:false});
  return {filename,sheets:book.sheets.filter(s=>s.name!=='Revisión ContaEZ').map(s=>({name:s.name,formulas:[...s.cells.values()].filter(c=>c.formula!==undefined).length,populated:[...s.cells.values()].filter(c=>c.value!==''||c.formula).length})),findings,formulaCount:formulaCells.size,externalLinks,hasMacros:!!book.files['xl/vbaProject.bin'],stats:{errors:findings.filter(f=>f.severity==='error').length,warnings:findings.filter(f=>f.severity==='warning').length,repairable:findings.filter(f=>f.repairable).length},nativeRecalculationVerified:false};
}
export async function auditWorkbook(data:ArrayBuffer|Uint8Array,filename:string):Promise<WorkbookAudit>{return auditRawWorkbook(readRawWorkbook(data),filename);}
export async function repairWorkbook(data:ArrayBuffer|Uint8Array,filename:string){
  const book=readRawWorkbook(data);const before=auditRawWorkbook(book,filename);const changes:WorkbookFinding[]=[];
  // Multiple findings on one formula are composed, never applied from stale original expressions.
  for(const finding of before.findings.filter(f=>f.repairable&&f.replacement)){
    const sheet=book.sheets.find(s=>s.name===finding.sheet)!;let replacement=finding.replacement!;
    if(finding.code==='LOCALIZED_FORMULA')replacement=normalizeFormulaFunctions(sheet.cells.get(finding.cell)?.formula??replacement);
    updateCellFormula(sheet,finding.cell,replacement);changes.push(finding);
  }
  const after=auditRawWorkbook(book,filename);const pending=after.findings.filter(f=>f.severity!=='info');
  const rows=[['Estado','Hoja','Celda','Hallazgo','Antes','Después / acción','Alcance'],...changes.map(f=>['Corregido',f.sheet,f.cell,f.message,f.original??'',book.sheets.find(s=>s.name===f.sheet)?.cells.get(f.cell)?.formula??'','Requiere recálculo nativo']),...pending.map(f=>['Pendiente',f.sheet,f.cell,f.message,f.original??'',f.suggestion,'No certificado']),['Información','','','Se conserva el libro original; esta copia tiene reparaciones verificables.','','','El recálculo nativo y la auditoría integral no se han certificado.'],['Autor','','','ContaEZ · @betcover_ii','','gallardoquirozd4@gmail.com','México exclusivamente']];
  appendReviewSheet(book,rows);
  const output=writeRawWorkbook(book);
  return {data:output,before,after,changes,pending};
}
