import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', removeNSPrefix: true, parseTagValue: false, parseAttributeValue: false, trimValues: false });
export const asArray = <T>(v: T | T[] | undefined): T[] => v === undefined ? [] : Array.isArray(v) ? v : [v];
export const xmlText = (v: any): string => typeof v === 'object' && v !== null ? xmlText(v['#text'] ?? v.t ?? '') : String(v ?? '');
export const escapeXml = (s: unknown): string => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
export const formulaCode=(formula:string):string=>formula.replace(/"(?:[^"]|"")*"|'(?:[^']|'')*'/g,part=>' '.repeat(part.length));
export function normalizeFormulaFunctions(formula:string):string{return formula.split(/("(?:[^"]|"")*"|'(?:[^']|'')*')/g).map((part,i)=>i%2?part:part.replace(/(?<![\p{L}\p{N}_.])SUMA(?=\s*\()/giu,'SUM')).join('');}
function brokenReferences(formula:string){const code=formulaCode(formula),found:{start:number;end:number}[]=[];for(const match of code.matchAll(/#REF!(?:\$?[A-Z]{1,3}\$?[1-9]\d*(?::\$?[A-Z]{1,3}\$?[1-9]\d*)?)?/gi)){const prefix=formula.slice(0,match.index).match(/(?:'(?:[^']|'')+'|[\p{L}_][\p{L}\p{N}_ .]*)!$/u);found.push({start:match.index!-(prefix?.[0].length??0),end:match.index!+match[0].length});}return found;}
export const brokenReferenceCount=(formula:string)=>brokenReferences(formula).length;
export function replaceBrokenFormulaReference(formula:string,replacement:string):string{const ref=brokenReferences(formula)[0];return ref?formula.slice(0,ref.start)+replacement+formula.slice(ref.end):formula;}
const plainText = (v: any): string => typeof v === 'string' ? v : v?.t !== undefined ? xmlText(v.t) : asArray(v?.r).map(x=>xmlText(x.t)).join('');
export interface RawCell { address: string; value: string; formula?: string; type: string; }
type FormulaRange = { firstColumn:number; firstRow:number; lastColumn:number; lastRow:number; editableAnchor?:string };
export interface RawSheet { name: string; path: string; cells: Map<string,RawCell>; xml: string; protectedRanges?: FormulaRange[]; }
export interface RawBook { files: Record<string,Uint8Array>; sheets: RawSheet[]; sharedStrings: string[]; date1904?:boolean; }
function formulaRange(reference:unknown, editableAnchor?:string):FormulaRange|undefined {
  if (typeof reference !== 'string') return;
  const [first, last = first] = reference.split(':');
  const [firstColumn,firstRow] = cellParts(first), [lastColumn,lastRow] = cellParts(last);
  if (!firstColumn || !firstRow || lastColumn < firstColumn || lastRow < firstRow || lastColumn > 16384 || lastRow > 1048576) return;
  return { firstColumn, firstRow, lastColumn, lastRow, editableAnchor };
}
export function cellCanReceiveFormula(sheet:RawSheet, address:string):boolean {
  const [column,row] = cellParts(address);
  if (column < 1 || column > 16384 || row < 1 || row > 1048576) return false;
  return !sheet.protectedRanges?.some(range => address !== range.editableAnchor &&
    column >= range.firstColumn && column <= range.lastColumn && row >= range.firstRow && row <= range.lastRow);
}
function packagePath(target:string,files:Record<string,Uint8Array>):string{
  const resolve=(value:string)=>{const parts:string[]=[];for(const part of (value.startsWith('/')?value.slice(1):`xl/${value}`).replace(/\\/g,'/').split('/')){if(!part||part==='.')continue;if(part==='..'){if(!parts.length)throw new Error('La ruta de una hoja queda fuera del libro.');parts.pop();}else parts.push(part);}return parts.join('/');};
  const path=resolve(target);if(files[path])return path;try{return resolve(decodeURIComponent(target));}catch{throw new Error('La ruta de una hoja no es válida.');}
}
export function readRawWorkbook(data: ArrayBuffer | Uint8Array): RawBook {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.length > 80_000_000) throw new Error('El archivo supera el límite de 80 MB para una revisión local.');
  let totalSize=0; const files=unzipSync(bytes,{filter(file){totalSize+=file.originalSize; if(totalSize>300_000_000)throw new Error('El contenido descomprimido supera 300 MB.'); return true;}});
  if (!files['xl/workbook.xml']||!files['xl/_rels/workbook.xml.rels']) throw new Error('Se requiere un libro .xlsx/.xlsm válido, sin contraseña.');
  const workbook=parser.parse(strFromU8(files['xl/workbook.xml'])).workbook;
  const rels=asArray(parser.parse(strFromU8(files['xl/_rels/workbook.xml.rels'])).Relationships?.Relationship);
  const sharedStrings=files['xl/sharedStrings.xml'] ? asArray(parser.parse(strFromU8(files['xl/sharedStrings.xml'])).sst?.si).map(plainText) : [];
  const sheets=asArray(workbook.sheets?.sheet).map((s:any):RawSheet=>{
    const rel=rels.find((r:any)=>r['@_Id']===s['@_id']);
    const target=String(rel?.['@_Target']??'');
    const path=packagePath(target,files);
    if(!files[path])throw new Error(`Falta la hoja ${s['@_name']}.`);
    const xml=strFromU8(files[path]); const document=parser.parse(xml).worksheet;
    const cells=new Map<string,RawCell>();const sharedMasters=new Map<string,{address:string;formula:string}>();const sharedCopies:{address:string;index:string}[]=[];
    const protectedRanges:FormulaRange[]=[];
    for (const merge of asArray(document?.mergeCells?.mergeCell)) {
      const reference = merge['@_ref'];
      const range = formulaRange(reference, typeof reference === 'string' ? reference.split(':')[0].replace(/\$/g,'').toUpperCase() : undefined);
      if (range) protectedRanges.push(range);
    }
    for (const row of asArray(document?.sheetData?.row)) for(const c of asArray(row.c)){
      const type=c['@_t']??'n'; const raw=xmlText(c.v); const value=type==='s'?sharedStrings[Number(raw)]??'':type==='inlineStr'?plainText(c.is):raw;
      const formula=c.f!==undefined?xmlText(c.f):undefined;
      cells.set(c['@_r'],{address:c['@_r'],value,formula,type});
      if(c.f?.['@_t']==='shared'){const index=String(c.f['@_si']);if(formula)sharedMasters.set(index,{address:c['@_r'],formula});else sharedCopies.push({address:c['@_r'],index});}
      if (['array','dataTable'].includes(c.f?.['@_t'])) {
        const range = formulaRange(c.f['@_ref']) ?? formulaRange(c['@_r']);
        if (range) protectedRanges.push(range);
      }
    }
    for(const copy of sharedCopies){const master=sharedMasters.get(copy.index);if(master){const [mc,mr]=cellParts(master.address),[cc,cr]=cellParts(copy.address);cells.get(copy.address)!.formula=shiftFormula(master.formula,cc-mc,cr-mr);}}
    return {name:s['@_name'],path,cells,xml,protectedRanges};
  });
  return {files,sheets,sharedStrings,date1904:['1','true'].includes(String(workbook.workbookPr?.['@_date1904']??'').toLowerCase())};
}
interface FormulaReference { index:number; text:string; sheet?:string; kind:'cells'|'columns'|'rows'; first:string; last?:string; }
/** A1 references only; quoted strings, identifiers and function names are not cells. */
function formulaReferences(formula:string):FormulaReference[]{
  const expression=formula.replace(/"(?:[^"]|"")*"/g,match=>' '.repeat(match.length));
  const pattern=/(?<![\p{L}\p{N}_.$\]!])(?:(?:'((?:[^']|'')+)'|([\p{L}_][\p{L}\p{N}_ .]*))!)?(?:(\$?[A-Z]{1,3}\$?[1-9]\d*)(?::(\$?[A-Z]{1,3}\$?[1-9]\d*))?|(\$?[A-Z]{1,3}):(\$?[A-Z]{1,3})|(\$?[1-9]\d*):(\$?[1-9]\d*))(?![\p{L}\p{N}_.(])/giu;
  const refs:FormulaReference[]=[];let match:RegExpExecArray|null;
  while((match=pattern.exec(expression)))refs.push({index:match.index,text:formula.slice(match.index,match.index+match[0].length),sheet:match[1]?.replace(/''/g,"'")??match[2],kind:match[3]?'cells':match[5]?'columns':'rows',first:match[3]??match[5]??match[7],last:match[4]??match[6]??match[8]});
  return refs;
}
function shiftFormula(formula:string,dc:number,dr:number):string {
  let result=formula;
  for(const ref of formulaReferences(formula).reverse()){
    const split=ref.text.lastIndexOf('!'),prefix=split>=0?ref.text.slice(0,split+1):'';
    const move=(value:string)=>{
      if(ref.kind==='columns'){const column=columnNumber(value)+(value.startsWith('$')?0:dc);return column<1||column>16384?'#REF!':`${value.startsWith('$')?'$':''}${columnName(column)}`;}
      if(ref.kind==='rows'){const row=Number(value.replace('$',''))+(value.startsWith('$')?0:dr);return row<1||row>1048576?'#REF!':`${value.startsWith('$')?'$':''}${row}`;}
      const match=value.match(/^(\$?)([A-Z]+)(\$?)(\d+)$/i)!;const column=columnNumber(match[2])+(match[1]?0:dc),row=Number(match[4])+(match[3]?0:dr);return column<1||column>16384||row<1||row>1048576?'#REF!':`${match[1]}${columnName(column)}${match[3]}${row}`;
    };
    result=result.slice(0,ref.index)+prefix+move(ref.first)+(ref.last?`:${move(ref.last)}`:'')+result.slice(ref.index+ref.text.length);
  }
  return result;
}
export function columnNumber(s:string):number { return s.replace(/\$/g,'').toUpperCase().split('').reduce((n,c)=>n*26+c.charCodeAt(0)-64,0); }
export function columnName(n:number):string { let s='';for(;n>0;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s; }
export function cellParts(address:string):[number,number] {const m=address.replace(/\$/g,'').match(/^([A-Z]+)(\d+)$/i);return m?[columnNumber(m[1]),Number(m[2])]:[0,0];}
export function referenceKeys(formula:string,currentSheet:string,book:RawBook):string[] {
  const keys=new Set<string>();
  for(const ref of formulaReferences(formula)){
    const sheetName=(ref.sheet??currentSheet).trim();
    const sheet=book.sheets.find(s=>s.name.toLowerCase()===sheetName.toLowerCase());if(!sheet)continue;
    const start=ref.first.replace(/\$/g,'').toUpperCase(),last=ref.last?.replace(/\$/g,'').toUpperCase();
    let c1:number,r1:number,c2:number,r2:number;
    if(ref.kind==='columns'){c1=columnNumber(start);c2=columnNumber(last!);r1=1;r2=1048576;}
    else if(ref.kind==='rows'){c1=1;c2=16384;r1=Number(start);r2=Number(last);}
    else {[c1,r1]=cellParts(start);[c2,r2]=cellParts(last??start);}
    if(c1<1||c2>16384||r1<1||r2>1048576||c2<c1||r2<r1)continue;
    if(!last){keys.add(`${sheet.name}!${start}`);continue;}
    // Only actual cells can participate in the graph.
    for(const [address]of sheet.cells){const [c,r]=cellParts(address);if(c>=c1&&c<=c2&&r>=r1&&r<=r2)keys.add(`${sheet.name}!${address}`);}
  }
  return [...keys];
}
export function updateCellFormula(sheet:RawSheet,address:string,formula:string):void {
  const re=new RegExp(`<c\\b([^>]*\\br="${address}"[^>]*)(?<!/)>([\\s\\S]*?)<\\/c>`);
  const original=sheet.xml.match(re);
  const sharedTag=original?.[2].match(/<f\b([^>]*)(?:\/>|>[\s\S]*?<\/f>)/)?.[1];
  const sharedId=sharedTag&&/\bt="shared"/.test(sharedTag)?sharedTag.match(/\bsi="(\d+)"/)?.[1]:undefined;
  // Removing or changing a shared master must not strand its dependent <f t="shared"/>
  // cells. Materialize this complete group using formulas resolved during the read.
  if(sharedId!==undefined){
    sheet.xml=sheet.xml.replace(/<c\b([^>]*\br="([^"]+)"[^>]*)(?<!\/)>([\s\S]*?)<\/c>/g,(all,attrs:string,cellAddress:string,body:string)=>{
      const tag=body.match(/<f\b([^>]*)(?:\/>|>[\s\S]*?<\/f>)/);
      const matching=tag&&/\bt="shared"/.test(tag[1])&&tag[1].match(/\bsi="(\d+)"/)?.[1]===sharedId;
      const expanded=sheet.cells.get(cellAddress)?.formula;
      return matching&&expanded!==undefined?`<c${attrs}>${body.replace(tag![0],()=>`<f>${escapeXml(expanded)}</f>`)}</c>`:all;
    });
  }
  sheet.xml=sheet.xml.replace(re,(_all,attrs:string,body:string)=>{
    const cleanAttrs=attrs.replace(/\s+t="[^"]*"/g,'');
    const cleanBody=body.replace(/<(f|v|is)\b[^>]*(?:\/>|>[\s\S]*?<\/\1>)/g,'');
    return `<c${cleanAttrs}><f>${escapeXml(formula)}</f>${cleanBody}</c>`;
  });
  const cell=sheet.cells.get(address);if(cell){cell.formula=formula;cell.value='';cell.type='n';}
}
export function appendReviewSheet(book:RawBook,rows:string[][],name='Revisión ContaEZ'):void {
  // Replace an existing own review sheet instead of stacking copies after a repeated run.
  const existing=book.sheets.find(s=>s.name===name);
  const content=rows.map((row,i)=>`<row r="${i+1}">${row.map((v,j)=>`<c r="${columnName(j+1)}${i+1}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(v)}</t></is></c>`).join('')}</row>`).join('');
  const xml=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:G${rows.length}"/><sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="30"/><cols><col min="1" max="2" width="22" customWidth="1"/><col min="3" max="7" width="55" customWidth="1"/></cols><sheetData>${content}</sheetData><autoFilter ref="A1:G${rows.length}"/></worksheet>`;
  if(existing){book.files[existing.path]=strToU8(xml);existing.xml=xml;return;}
  appendWorksheetXml(book,name,xml);
}

/** Insert a package part while retaining all existing worksheets and other relationships. */
export function appendWorksheetXml(book:RawBook,name:string,xml:string):void {
  if (book.sheets.some(sheet => sheet.name.toLowerCase() === name.toLowerCase())) throw new Error(`La hoja ${name} ya existe en el libro.`);
  let workbook=strFromU8(book.files['xl/workbook.xml']);let rels=strFromU8(book.files['xl/_rels/workbook.xml.rels']);let types=strFromU8(book.files['[Content_Types].xml']);
  const ids=[...workbook.matchAll(/\bsheetId\s*=\s*["'](\d+)["']/g)].map(m=>Number(m[1]));
  let id=Math.max(0,...ids)+1;
  while(book.files[`xl/worksheets/sheet${id}.xml`])id++;
  const relIds=new Set([...rels.matchAll(/\bId\s*=\s*["']([^"']+)["']/g)].map(m=>m[1]));
  let relId=id;
  while(relIds.has(`rId${relId}`))relId++;
  const rid=`rId${relId}`;
  const path=`xl/worksheets/sheet${id}.xml`;
  const insert=(source:string,tag:string,child:(prefix:string)=>string)=>{
    const closing=new RegExp(`</((?:[\\w.-]+:)?)(?:${tag})\\s*>`);
    if(!closing.test(source))throw new Error('No se pueden añadir hojas a la estructura de este archivo.');
    return source.replace(closing,(end:string,prefix:string)=>child(prefix)+end);
  };
  workbook=insert(workbook,'sheets',prefix=>`<${prefix}sheet name="${escapeXml(name)}" sheetId="${id}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="${rid}"/>`);
  rels=insert(rels,'Relationships',prefix=>`<${prefix}Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${id}.xml"/>`);
  types=insert(types,'Types',prefix=>`<${prefix}Override PartName="/${path}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`);
  book.files['xl/workbook.xml']=strToU8(workbook);book.files['xl/_rels/workbook.xml.rels']=strToU8(rels);book.files['[Content_Types].xml']=strToU8(types);book.files[path]=strToU8(xml);
}
/** Only use with a result obtained from a separately verified calculation engine. */
export function updateCellCache(sheet:RawSheet,address:string,value:string|number|boolean|null,error?:string):void {
  const cell=sheet.cells.get(address);if(!cell||cell.formula===undefined)return;
  const type=error?'e':typeof value==='string'?'str':typeof value==='boolean'?'b':'n';
  const text=error??(typeof value==='boolean'?(value?'1':'0'):value===null?'':String(value));
  const re=new RegExp(`<c\\b([^>]*\\br="${address}"[^>]*)>([\\s\\S]*?)<\\/c>`);
  sheet.xml=sheet.xml.replace(re,(_all,attrs:string,body:string)=>{
    const cleanAttrs=attrs.replace(/\s+t="[^"]*"/g,'');const withoutCache=body.replace(/<v\b[^>]*>[\s\S]*?<\/v>/g,'');
    const cache=value===null&&!error?'':`<v>${escapeXml(text)}</v>`;
    const content=withoutCache.includes('<extLst')?withoutCache.replace('<extLst',()=>`${cache}<extLst`):withoutCache+cache;
    return `<c${cleanAttrs}${type==='n'?'':` t="${type}"`}>${content}</c>`;
  });
  cell.value=text;cell.type=type;
}
export function writeRawWorkbook(book:RawBook):Uint8Array {
  for(const sheet of book.sheets) book.files[sheet.path]=strToU8(sheet.xml);
  let workbook=strFromU8(book.files['xl/workbook.xml']);
  const calcTag='<calcPr calcId="191029" fullCalcOnLoad="1" forceFullCalc="1" calcMode="auto"/>';
  const calcPattern=/<calcPr\b[^>]*\/?>(?:<\/calcPr>)?/;
  workbook=calcPattern.test(workbook)?workbook.replace(calcPattern,calcTag):workbook.replace(/<extLst\b|<\/workbook>/,m=>calcTag+m);
  book.files['xl/workbook.xml']=strToU8(workbook);
  if(book.files['xl/calcChain.xml']){
    delete book.files['xl/calcChain.xml'];
    book.files['xl/_rels/workbook.xml.rels']=strToU8(strFromU8(book.files['xl/_rels/workbook.xml.rels']).replace(/<Relationship\b[^>]*Type="[^"]*\/calcChain"[^>]*\/?>(?:<\/Relationship>)?/g,''));
    book.files['[Content_Types].xml']=strToU8(strFromU8(book.files['[Content_Types].xml']).replace(/<Override\b[^>]*PartName="\/xl\/calcChain.xml"[^>]*\/?>(?:<\/Override>)?/g,''));
  }
  return zipSync(book.files,{level:6});
}
