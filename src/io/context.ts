import { cellParts, columnName, escapeXml, readRawWorkbook, updateCellFormula, appendReviewSheet, writeRawWorkbook, type RawBook, type RawCell, type RawSheet } from './workbook';

export interface PracticeContextReference { name:string; data:Uint8Array; text?:string; }
export interface ContextSuggestion { id:string; title:string; explanation:string; source:string; targetSheet:string; targetCell:string; formula:string; originalFormula?:string; originalValue?:string; layoutFingerprint:string; }
export interface PracticeContextReview { suggestions:ContextSuggestion[]; notes:string[]; focusedCells:{sheet:string;cell:string}[]; }
type Ref={sheet:string;first:string;last?:string};
type Expr={kind:'number';value:number}|{kind:'string';value:string}|{kind:'ref';ref:Ref}|{kind:'bool'}|{kind:'op';op:string;args:Expr[]}|{kind:'call';name:string;args:Expr[]};
type Token={kind:'number'|'string'|'word'|'ref'|'op';text:string;ref?:Ref};
const normalize=(value:string)=>value.normalize('NFD').replace(/\p{Diacritic}/gu,'').replace(/\s+/g,' ').trim().toLowerCase();
const errorValue=/^#(?:REF!|VALUE!|NAME\?|DIV\/0!|N\/A|NUM!|NULL!|SPILL!|CALC!)/i;
const owned=(name:string)=>name==='Revisión ContaEZ'||/^cambios(?: contaez)?$/i.test(name);
const hash=(value:string)=>{let h=2166136261;for(const char of value)h=Math.imul(h^char.charCodeAt(0),16777619);return (h>>>0).toString(16);};
const textLabel=(cell:RawCell|undefined)=>!!cell&&!cell.formula&&!errorValue.test(cell.value)&&/[\p{L}]/u.test(cell.value)&&cell.value.length<180;
const blank=(cell:RawCell|undefined)=>!cell||cell.formula===undefined&&cell.value.trim()==='';
const functions:Record<string,[number,number]>={SUM:[1,255],SUMIF:[2,3],SUMIFS:[3,255],MAX:[1,255],MIN:[1,255],AVERAGE:[1,255],COUNT:[1,255],COUNTA:[1,255],COUNTIF:[2,2],COUNTIFS:[2,254],IF:[2,3],IFERROR:[2,2],ROUND:[2,2],ROUNDUP:[2,2],ROUNDDOWN:[2,2],ABS:[1,1],AND:[1,255],OR:[1,255],NOT:[1,1],SUMPRODUCT:[1,255]};
function cellsIn(book:RawBook,ref:Ref):RawCell[]{
  const sheet=book.sheets.find(s=>s.name===ref.sheet)!;const [c,r]=cellParts(ref.first),[cc,rr]=cellParts(ref.last??ref.first);
  if(c<1||cc>16384||r<1||rr>1048576||cc<c||rr<r||(cc-c+1)*(rr-r+1)>50_000)throw new Error('El rango queda fuera del alcance verificable (máximo 50 000 celdas).');
  const cells=[...sheet.cells.values()].filter(cell=>{const [xc,xr]=cellParts(cell.address);return xc>=c&&xc<=cc&&xr>=r&&xr<=rr;});
  if(!cells.some(cell=>!blank(cell)))throw new Error(`Falta la fuente ${ref.sheet}!${ref.first}${ref.last?`:${ref.last}`:''} en la práctica.`);
  return cells;
}
function parseFormula(formula:string,current:string,book:RawBook):Expr{
  const source=formula.replace(/^=/,'');if(source.length>8000)throw new Error('La fórmula supera el alcance de esta comparación.');
  const tokens:Token[]=[];let offset=0;
  while(offset<source.length){const rest=source.slice(offset);const ws=rest.match(/^\s+/);if(ws){offset+=ws[0].length;continue;}
    const literal=rest.match(/^"((?:[^"]|"")*)"/);if(literal){tokens.push({kind:'string',text:literal[1].replace(/""/g,'"')});offset+=literal[0].length;continue;}
    const reference=rest.match(/^(?:(?:'((?:[^']|'')+)'|([\p{L}_][\p{L}\p{N}_ .]*))!)?(\$?[A-Z]{1,3}\$?[1-9]\d*)(?::(\$?[A-Z]{1,3}\$?[1-9]\d*))?(?![\p{L}\p{N}_])/iu);
    if(reference){const name=(reference[1]?.replace(/''/g,"'")??reference[2]??current).trim(),sheet=book.sheets.find(s=>s.name.toLowerCase()===name.toLowerCase());if(!sheet)throw new Error(`La fórmula requiere una hoja que falta: ${name}.`);const ref={sheet:sheet.name,first:reference[3].replace(/\$/g,'').toUpperCase(),last:reference[4]?.replace(/\$/g,'').toUpperCase()};cellsIn(book,ref);tokens.push({kind:'ref',text:reference[0],ref});offset+=reference[0].length;continue;}
    const number=rest.match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:E[+-]?\d+)?/i);if(number){if(!Number.isFinite(Number(number[0])))throw new Error('Número de fórmula inválido.');tokens.push({kind:'number',text:number[0]});offset+=number[0].length;continue;}
    const word=rest.match(/^[A-Z_][A-Z0-9_.]*/i);if(word){tokens.push({kind:'word',text:word[0].toUpperCase()});offset+=word[0].length;continue;}
    const op=rest.match(/^(?:<>|<=|>=|[+\-*/^&=<>%(),])/);if(op){tokens.push({kind:'op',text:op[0]});offset+=op[0].length;continue;}
    throw new Error('La fórmula contiene un vínculo externo, nombre, rango dinámico o sintaxis no admitida.');
  }
  let pos=0;const priority:Record<string,number>={'=':1,'<>':1,'<':1,'>':1,'<=':1,'>=':1,'&':2,'+':3,'-':3,'*':4,'/':4,'^':5};
  function primary():Expr{const token=tokens[pos++];if(!token)throw new Error('Fórmula incompleta.');
    if(token.kind==='number')return {kind:'number',value:Number(token.text)};if(token.kind==='string')return {kind:'string',value:token.text};if(token.kind==='ref')return {kind:'ref',ref:token.ref!};
    if(token.text==='+'||token.text==='-')return {kind:'op',op:token.text,args:[primary()]};
    if(token.text==='('){const value=expression();if(tokens[pos++]?.text!==')')throw new Error('Paréntesis incompletos.');return value;}
    if(token.kind==='word'){
      if(['TRUE','FALSE'].includes(token.text)&&tokens[pos]?.text!=='(')return {kind:'bool'};
      const limits=functions[token.text];if(!limits||tokens[pos++]?.text!=='(')throw new Error('La función o nombre de fórmula no está dentro del alcance verificable.');
      const args:Expr[]=[];if(tokens[pos]?.text!==')'){args.push(expression());while(tokens[pos]?.text===','){pos++;args.push(expression());}}if(tokens[pos++]?.text!==')'||args.length<limits[0]||args.length>limits[1]||token.text==='SUMIFS'&&args.length%2!==1||token.text==='COUNTIFS'&&args.length%2!==0)throw new Error('Argumentos de fórmula inválidos.');return {kind:'call',name:token.text,args};
    }
    throw new Error('No se reconoce una expresión de la fórmula.');
  }
  function expression(min=0):Expr{let left=primary();while(tokens[pos]?.text==='%'){pos++;left={kind:'op',op:'%',args:[left]};}while(tokens[pos]&&priority[tokens[pos].text]!==undefined&&priority[tokens[pos].text]>=min){const op=tokens[pos++].text,right=expression(priority[op]+(op==='^'?0:1));if(op==='/'&&right.kind==='number'&&right.value===0)throw new Error('La fórmula divide entre cero.');left={kind:'op',op,args:[left,right]};}return left;}
  const result=expression();if(pos!==tokens.length)throw new Error('La fórmula contiene una expresión no admitida.');return result;
}
function refs(expression:Expr):Ref[]{return expression.kind==='ref'?[expression.ref]:expression.kind==='call'||expression.kind==='op'?expression.args.flatMap(refs):[];}
function safeConstants(expression:Expr,book:RawBook,parent?:Expr,index=0):void{
  const criteria=parent?.kind==='call'&&(parent.name==='SUMIF'||parent.name==='COUNTIF'?index===1:parent.name==='SUMIFS'?index>=2&&index%2===0:parent.name==='COUNTIFS'?index%2===1:false);
  if(expression.kind==='number'&&![0,1].includes(expression.value)){
    const precision=parent?.kind==='call'&&/^ROUND(?:UP|DOWN)?$/.test(parent.name)&&index===1&&Number.isInteger(expression.value)&&expression.value>=0&&expression.value<=10;
    const criterion=criteria&&parent?.kind==='call'&&parent.args[index-1]?.kind==='ref'&&cellsIn(book,(parent.args[index-1] as Extract<Expr,{kind:'ref'}>).ref).some(c=>c.value===String(expression.value));
    if(!precision&&!criterion)throw new Error('La fórmula del modelo contiene importes o constantes fijas que no se copiarán.');
  }
  if(expression.kind==='string'&&expression.value!==''){
    const range=criteria&&parent?.kind==='call'?parent.args[index-1]:undefined;
    if(range?.kind!=='ref'||!cellsIn(book,range.ref).some(c=>normalize(c.value)===normalize(expression.value)))throw new Error('La fórmula contiene texto del modelo que no coincide con las cuentas o criterios de la práctica.');
  }
  if(expression.kind==='op'||expression.kind==='call')expression.args.forEach((child,i)=>safeConstants(child,book,expression,i));
}
function validFormula(book:RawBook,sheet:string,address:string,formula:string,restrictConstants=true){
  const candidate=parseFormula(formula,sheet,book);if(!refs(candidate).length)throw new Error('El modelo no aporta una fórmula con fuentes del propio libro.');if(restrictConstants)safeConstants(candidate,book);
  const target=`${sheet}!${address}`,visiting=new Set<string>(),done=new Set<string>();let visited=0;
  function visit(key:string){if(visiting.has(key))throw new Error('La fórmula produciría o mantendría un ciclo.');if(done.has(key))return;if(++visited>20_000)throw new Error('Las dependencias superan el alcance verificable.');visiting.add(key);
    const split=key.lastIndexOf('!'),s=book.sheets.find(x=>x.name===key.slice(0,split))!,cell=s.cells.get(key.slice(split+1));if(cell&&errorValue.test(cell.value))throw new Error(`La fuente ${key} tiene un error guardado.`);
    const expression=key===target?candidate:cell?.formula?parseFormula(cell.formula,s.name,book):undefined;
    if(expression)for(const ref of refs(expression))for(const dep of cellsIn(book,ref)){
      if(errorValue.test(dep.value))throw new Error(`La fuente ${ref.sheet}!${dep.address} tiene un error guardado.`);
      if(dep.formula!==undefined||`${ref.sheet}!${dep.address}`===target)visit(`${ref.sheet}!${dep.address}`);
    }
    visiting.delete(key);done.add(key);
  }
  // A broken cached result at the target is precisely what can be replaced.
  const targetSheet=book.sheets.find(s=>s.name===sheet)!,original=targetSheet.cells.get(address),cached=original?.value,oldFormula=original?.formula;const candidateCell=original??{address,value:'',type:'n'};candidateCell.value='';candidateCell.formula=formula;targetSheet.cells.set(address,candidateCell);try{visit(target);}finally{if(original){original.value=cached!;original.formula=oldFormula;}else targetSheet.cells.delete(address);}
}
function anchors(sheet:RawSheet,address:string){const [col,row]=cellParts(address),selected:RawCell[]=[];
  for(const [dc,dr]of [[-1,0],[0,-1],[1,0]] as const)for(let step=1;step<=4;step++){const c=col+dc*step,r=row+dr*step;if(c<1||r<1)break;const cell=sheet.cells.get(`${columnName(c)}${r}`);if(textLabel(cell)){selected.push(cell!);break;}}
  return selected;
}
function layout(book:RawBook,sheet:RawSheet,address:string){return hash(JSON.stringify({sheets:book.sheets.filter(s=>!owned(s.name)).map(s=>s.name).sort(),anchors:anchors(sheet,address).map(c=>[c.address,normalize(c.value)]),merge:sheet.xml.match(/<mergeCells\b[^>]*>[\s\S]*?<\/mergeCells>/)?.[0]??'',columns:sheet.xml.match(/<cols\b[^>]*>[\s\S]*?<\/cols>/)?.[0]??''}));}
function compatible(primary:RawBook,model:RawBook,sheet:RawSheet,modelSheet:RawSheet,address:string){
  if(primary.sheets.filter(s=>!owned(s.name)).map(s=>s.name).sort().join('\0')!==model.sheets.filter(s=>!owned(s.name)).map(s=>s.name).sort().join('\0'))return false;
  const labels=anchors(sheet,address);if(!labels.length)return false;
  return labels.every(c=>normalize(modelSheet.cells.get(c.address)?.value??'')===normalize(c.value))&&layout(primary,sheet,address)===layout(model,modelSheet,address);
}
function focus(book:RawBook,instruction:string,notes:string[]){const focused:{sheet:string;cell:string}[]=[],qualifiedSpans:[number,number][]=[];
  const qualified=/(?:(?:'((?:[^']|'')+)'|([\p{L}_][\p{L}\p{N}_ .]*))!)\$?([A-Z]{1,3})\$?([1-9]\d*)/giu;let match:RegExpExecArray|null;
  while((match=qualified.exec(instruction))){qualifiedSpans.push([match.index,match.index+match[0].length]);const named=(match[1]?.replace(/''/g,"'")??match[2]).trim();let sheet=book.sheets.find(s=>normalize(s.name)===normalize(named));if(!sheet){const suffix=book.sheets.filter(s=>named.toLowerCase().endsWith(` ${s.name.toLowerCase()}`));if(suffix.length===1)sheet=suffix[0];}const cell=`${match[3].toUpperCase()}${match[4]}`;if(!sheet)notes.push(`No se encontró la hoja indicada junto a ${cell}; escribe su nombre exacto, por ejemplo 'Diario'!${cell}.`);else focused.push({sheet:sheet.name,cell});}
  const plain=/\b([A-Z]{1,3})([1-9]\d*)\b/giu;while((match=plain.exec(instruction))){if(qualifiedSpans.some(([start,end])=>match!.index>=start&&match!.index<end))continue;const cell=`${match[1].toUpperCase()}${match[2]}`,sheets=book.sheets.filter(s=>!owned(s.name));if(sheets.length===1)focused.push({sheet:sheets[0].name,cell});else notes.push(`${cell} es ambiguo: indica la hoja. Opciones: ${sheets.slice(0,8).map(s=>`'${s.name}'!${cell}`).join(', ')}${sheets.length>8?', …':''}.`);}
  return focused.filter((f,i)=>focused.findIndex(x=>x.sheet===f.sheet&&x.cell===f.cell)===i).filter(f=>{const [c,r]=cellParts(f.cell);return c<=16384&&r<=1048576;});
}
export function inspectPracticeContext(practice:Uint8Array,references:PracticeContextReference[],instruction:string):PracticeContextReview{
  const book=readRawWorkbook(practice),notes:string[]=[],focusedCells=focus(book,instruction,notes),suggestions:ContextSuggestion[]=[];
  if(!focusedCells.length&&references.length)notes.push('Indica la celda que deseas revisar (Hoja!Celda). Los anexos aportan contexto y no cambian las operaciones automáticamente.');
  for(const reference of references){
    if(!/\.(?:xlsx|xlsm)$/i.test(reference.name)){const type=/\.(?:png|jpe?g|webp|gif)$/i.test(reference.name)?'imagen':/\.pdf$/i.test(reference.name)?'PDF':/\.xml$/i.test(reference.name)?'XML/CFDI':'texto o documento';notes.push(`${reference.name}: ${type} adjunto para revisión${reference.text?.trim()?`; hay ${reference.text.trim().length} caracteres de texto extraído`:''}. Su contenido no prueba una fórmula ni genera asientos automáticamente.`);continue;}
    let model:RawBook;try{model=readRawWorkbook(reference.data);}catch{notes.push(`${reference.name}: no se pudo leer como un modelo Excel válido.`);continue;}
    for(const target of focusedCells){const sheet=book.sheets.find(s=>s.name===target.sheet)!,cell=sheet.cells.get(target.cell),modelSheet=model.sheets.find(s=>s.name===target.sheet),modelCell=modelSheet?.cells.get(target.cell);
      if(!blank(cell)&&cell?.formula===undefined){notes.push(`${reference.name}: ${target.sheet}!${target.cell} contiene un dato capturado; se conserva.`);continue;}
      if(!modelSheet||!modelCell?.formula){notes.push(`${reference.name}: no hay una fórmula modelo en ${target.sheet}!${target.cell}.`);continue;}
      if(modelCell.formula===cell?.formula)continue;
      if(!compatible(book,model,sheet,modelSheet,target.cell)){notes.push(`${reference.name}: no coincide el diseño o las etiquetas cercanas de ${target.sheet}!${target.cell}; no se propone copiar su fórmula.`);continue;}
      try{if(errorValue.test(modelCell.value))throw new Error('El modelo guarda un error en esa celda.');validFormula(model,target.sheet,target.cell,modelCell.formula,false);validFormula(book,target.sheet,target.cell,modelCell.formula);}
      catch(error){notes.push(`${reference.name}, ${target.sheet}!${target.cell}: ${error instanceof Error?error.message:'la fórmula no es verificable'}`);continue;}
      const id=`context:${hash(`${reference.name}\0${target.sheet}\0${target.cell}\0${modelCell.formula}\0${cell?.formula??''}\0${cell?.value??''}`)}`;
      suggestions.push({id,title:`Revisar fórmula de ${target.sheet}!${target.cell}`,explanation:'El modelo tiene una fórmula con fuentes del mismo libro; coinciden las hojas y etiquetas cercanas. Revisa la fórmula y confirma antes de aplicarla. Esto no certifica su interpretación contable.',source:reference.name,targetSheet:target.sheet,targetCell:target.cell,formula:modelCell.formula,originalFormula:cell?.formula,originalValue:cell?.value??'',layoutFingerprint:layout(book,sheet,target.cell)});
    }
  }
  for(const target of focusedCells)if(new Set(suggestions.filter(s=>s.targetSheet===target.sheet&&s.targetCell===target.cell).map(s=>s.formula)).size>1)notes.push(`Los modelos proponen fórmulas distintas para ${target.sheet}!${target.cell}. Elige una sola alternativa; no se pueden confirmar juntas.`);
  if(suggestions.length)notes.push('Las fórmulas propuestas están pendientes de confirmación. No se han copiado importes, cambiado datos capturados ni modificado el Excel principal.');
  return {suggestions,notes:[...new Set(notes)],focusedCells};
}
function writeFormula(sheet:RawSheet,address:string,formula:string){
  const escaped=escapeXml(formula),paired=new RegExp(`<c\\b[^>]*\\br="${address}"[^>]*(?<!/)>([\\s\\S]*?)<\\/c>`),self=new RegExp(`<c\\b([^>]*\\br="${address}"[^>]*)\\/>`);
  if(paired.test(sheet.xml)){updateCellFormula(sheet,address,formula);return;}
  if(self.test(sheet.xml))sheet.xml=sheet.xml.replace(self,(_all,attrs:string)=>`<c${attrs.replace(/\s+t="[^"]*"/g,'')}><f>${escaped}</f></c>`);
  else {const [col,row]=cellParts(address),tag=`<c r="${address}"><f>${escaped}</f></c>`,empty=new RegExp(`<row\\b([^>]*\\br="${row}"[^>]*)\\/>`),existing=new RegExp(`<row\\b([^>]*\\br="${row}"[^>]*)(?<!/)>([\\s\\S]*?)<\\/row>`);
    if(empty.test(sheet.xml))sheet.xml=sheet.xml.replace(empty,(_all,attrs:string)=>`<row${attrs}>${tag}</row>`);
    else if(existing.test(sheet.xml))sheet.xml=sheet.xml.replace(existing,(_all,attrs:string,body:string)=>{let placed=false;const next=body.replace(/<c\b[^>]*\br="([A-Z]+\d+)"[^>]*(?:\/>|>[\s\S]*?<\/c>)/g,(cell,ref:string)=>{if(!placed&&cellParts(ref)[0]>col){placed=true;return tag+cell;}return cell;});return `<row${attrs}>${next}${placed?'':tag}</row>`;});
    else {const tagRow=`<row r="${row}">${tag}</row>`;let placed=false;sheet.xml=sheet.xml.replace(/<row\b[^>]*\br="(\d+)"[^>]*(?:\/>|>[\s\S]*?<\/row>)/g,(item,r:string)=>{if(!placed&&Number(r)>row){placed=true;return tagRow+item;}return item;});if(!placed)sheet.xml=sheet.xml.replace('</sheetData>',()=>`${tagRow}</sheetData>`);}
  }
  sheet.cells.set(address,{address,formula,value:'',type:'n'});
}
export function applyPracticeContextSuggestion(data:Uint8Array,suggestion:ContextSuggestion):Uint8Array{
  const book=readRawWorkbook(data),sheet=book.sheets.find(s=>s.name===suggestion.targetSheet);if(!sheet||!/^([A-Z]{1,3})([1-9]\d*)$/.test(suggestion.targetCell))throw new Error('La celda propuesta ya no existe en este libro.');
  const current=sheet.cells.get(suggestion.targetCell);if(current?.formula!==suggestion.originalFormula||(current?.value??'')!==(suggestion.originalValue??'')||layout(book,sheet,suggestion.targetCell)!==suggestion.layoutFingerprint)throw new Error('La práctica cambió desde la propuesta. Vuelve a revisar el contexto antes de aplicar.');
  if(!blank(current)&&current?.formula===undefined)throw new Error('Se conserva el dato capturado; esta propuesta no puede sobrescribirlo.');validFormula(book,sheet.name,suggestion.targetCell,suggestion.formula);
  writeFormula(sheet,suggestion.targetCell,suggestion.formula);
  const rows=[['Estado','Hoja','Celda','Hallazgo','Antes','Después / acción','Alcance'],['Contexto confirmado',sheet.name,suggestion.targetCell,`Fórmula propuesta desde ${suggestion.source}`,suggestion.originalFormula??suggestion.originalValue??'',suggestion.formula,'Confirmación explícita; requiere recálculo en Excel. No certifica interpretación contable.']];
  const review=book.sheets.find(s=>s.name==='Revisión ContaEZ'||/^cambios(?: contaez)?$/i.test(s.name));
  if(!review)appendReviewSheet(book,rows);else {let last=Math.max(0,...[...review.cells.keys()].map(a=>cellParts(a)[1]));const xml=rows.slice(1).map(row=>{last++;return `<row r="${last}">${row.map((value,col)=>`<c r="${columnName(col+1)}${last}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`).join('')}</row>`;}).join('');review.xml=review.xml.replace('</sheetData>',()=>`${xml}</sheetData>`).replace(/<dimension\b[^>]*\/>/,`<dimension ref="A1:G${last}"/>`);}
  return writeRawWorkbook(book);
}
