import { auditRawWorkbook, type WorkbookAudit, type WorkbookFinding } from './audit';
import { appendReviewSheet, cellParts, columnName, escapeXml, readRawWorkbook, referenceKeys, updateCellFormula, writeRawWorkbook, normalizeFormulaFunctions, brokenReferenceCount, replaceBrokenFormulaReference, type RawBook, type RawCell, type RawSheet } from './workbook';

export interface StudentQuestion { id:string; title:string; explanation:string; placeholder:string; }
export interface StudentConnection { source:string; target:string; description:string; }
export interface StudentPracticeResult { data:Uint8Array; before:WorkbookAudit; after:WorkbookAudit; changes:WorkbookFinding[]; pending:WorkbookFinding[]; connections:StudentConnection[]; questions:StudentQuestion[]; }
type Side = 'debit'|'credit';
interface Journal { sheet:RawSheet; row:number; start:number; end:number; account:number; code?:number; partial?:number; debit:number; credit:number; }
interface Source { journal:Journal; row:number; account:RawCell; code?:RawCell; partial?:{ address:string; side:Side }; unresolved?:boolean; }
interface Table { sheet:RawSheet; row:number; start:number; end:number; account:number; code?:number; openingDebit?:number; openingCredit?:number; movementDebit?:number; movementCredit?:number; balanceDebit?:number; balanceCredit?:number; ambiguous?:boolean; adjustmentScope?:boolean; }
interface Proposal { sheet:RawSheet; address:string; formula?:string; source?:string; message:string; code:string; suggestion?:string; }
const norm=(s:string)=>s.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const quote=(s:string)=>`'${s.replace(/'/g,"''")}'`;
const criterion=(s:string)=>s.replace(/~/g,'~~').replace(/\*/g,'~*').replace(/\?/g,'~?').replace(/"/g,'""');
const at=(s:RawSheet,c:number,r:number)=>s.cells.get(`${columnName(c)}${r}`);
const blank=(c:RawCell|undefined)=>!c||c.formula===undefined&&c.value.trim()==='';
const amount=(c:RawCell|undefined)=>!!c&&(!!c.formula||c.type!=='s'&&c.type!=='inlineStr'&&c.value!==''&&Number.isFinite(Number(c.value)));
const terminal=(s:string)=>/^(?:sumas? iguales|sumas?|totales?|diferencias?|comprobacion)\b/.test(norm(s));
const accountHeader=(s:string)=>/^(?:cuenta|nombre(?: de la)? cuenta|nombre de cuenta|concepto|denominacion|descripcion de la cuenta)$/.test(norm(s));
const codeHeader=(s:string)=>/^(?:codigo(?: de cuenta)?|clave(?: de cuenta)?|numero de cuenta|no cuenta|cta)$/.test(norm(s));
const sideHeader=(s:string):Side|undefined=>/^(?:debe|deudor|deudores|cargo|cargos)$/.test(norm(s))?'debit':/^(?:haber|acreedor|acreedores|abono|abonos)$/.test(norm(s))?'credit':undefined;
const isJournal=(s:RawSheet)=>/^(?:diario|libro diario|polizas?(?: de)? (?:diario|ingresos?|egresos?)|ingresos?|egresos?)$/.test(norm(s.name));
const isBalance=(s:RawSheet)=>/bala[nz]*[az]?[ao]? de comprobacion|balanza|balaza/.test(norm(s.name));
const isMajor=(s:RawSheet)=>/mayor/.test(norm(s.name));
const isReport=(s:RawSheet)=>/balance general|estado[s]? de resultado/.test(norm(s.name));

/** Add one cell without round-tripping the worksheet, drawings, styles or other parts. */
function setFormula(sheet:RawSheet,address:string,formula:string){
  if(!sheet.cells.has(address)||!new RegExp(`<c\\b[^>]*\\br="${address}"[^>]*>[^]*?<\\/c>`).test(sheet.xml)||new RegExp(`<c\\b[^>]*\\br="${address}"[^>]*\\/>`).test(sheet.xml)){
    const self=new RegExp(`<c\\b([^>]*\\br="${address}"[^>]*)\\/>`);
    if(self.test(sheet.xml))sheet.xml=sheet.xml.replace(self,(_all,attrs:string)=>`<c${attrs}><f>${escapeXml(formula)}</f></c>`);
    else {
      const [col,row]=cellParts(address);const cell=`<c r="${address}"><f>${escapeXml(formula)}</f></c>`;
      const rowRe=new RegExp(`<row\\b([^>]*\\br="${row}"[^>]*)(?<!/)>([\\s\\S]*?)<\\/row>`),emptyRow=new RegExp(`<row\\b([^>]*\\br="${row}"[^>]*)\\/>`);
      if(emptyRow.test(sheet.xml))sheet.xml=sheet.xml.replace(emptyRow,(_all,attrs:string)=>`<row${attrs}>${cell}</row>`);
      else if(rowRe.test(sheet.xml))sheet.xml=sheet.xml.replace(rowRe,(_all,attrs:string,body:string)=>{
        let inserted=false;body=body.replace(/<c\b[^>]*\br="([A-Z]+\d+)"[^>]*(?:\/>|>[\s\S]*?<\/c>)/g,(existing,ref:string)=>{if(!inserted&&cellParts(ref)[0]>col){inserted=true;return cell+existing;}return existing;});
        return `<row${attrs}>${body}${inserted?'':cell}</row>`;
      });
      else {const rowXml=`<row r="${row}">${cell}</row>`;let inserted=false;sheet.xml=sheet.xml.replace(/<row\b[^>]*\br="(\d+)"[^>]*(?:\/>|>[\s\S]*?<\/row>)/g,(existing,r:string)=>{if(!inserted&&Number(r)>row){inserted=true;return rowXml+existing;}return existing;});if(!inserted)sheet.xml=sheet.xml.replace('</sheetData>',()=>`${rowXml}</sheetData>`);}
    }
    sheet.cells.set(address,{address,formula,value:'',type:'n'});
  }else updateCellFormula(sheet,address,formula);
}
function tableEnd(sheet:RawSheet,row:number,account:number,limit:number){
  for(let r=row+1;r<=limit;r++)if(terminal(at(sheet,account,r)?.value??'')||accountHeader(at(sheet,account,r)?.value??''))return r-1;
  return limit;
}
function journals(book:RawBook):Journal[]{
  const found:Journal[]=[];
  for(const sheet of book.sheets.filter(isJournal)){
    const max=Math.max(1,...[...sheet.cells.keys()].map(a=>cellParts(a)[1]));
    for(let row=1;row<=Math.min(max,100);row++){
      const cells=[...sheet.cells.values()].filter(c=>cellParts(c.address)[1]===row);
      const deb=cells.filter(c=>sideHeader(c.value)==='debit'),cre=cells.filter(c=>sideHeader(c.value)==='credit');
      if(deb.length!==1||cre.length!==1)continue;
      const headers=[...cells,...[...sheet.cells.values()].filter(c=>cellParts(c.address)[1]===row-1)];
      const names=headers.filter(c=>accountHeader(c.value));if(names.length!==1)continue;
      const account=cellParts(names[0].address)[0],code=headers.find(c=>codeHeader(c.value)),partial=cells.find(c=>norm(c.value)==='parcial');
      const end=tableEnd(sheet,row,account,max);if(end<=row)continue;
      found.push({sheet,row,start:row+1,end,account,code:code&&cellParts(code.address)[0],partial:partial&&cellParts(partial.address)[0],debit:cellParts(deb[0].address)[0],credit:cellParts(cre[0].address)[0]});
      row=end;
    }
  }
  return found;
}
function depends(book:RawBook,sheet:RawSheet,from:string,to:string,visited=new Set<string>()):boolean{
  if(from===to)return true;if(visited.has(from)||visited.size>80)return false;visited.add(from);
  const f=sheet.cells.get(from)?.formula;if(!f)return false;
  return referenceKeys(f,sheet.name,book).filter(k=>k.startsWith(`${sheet.name}!`)).some(k=>depends(book,sheet,k.slice(sheet.name.length+1),to,visited));
}
function positiveCoefficient(book:RawBook,sheet:RawSheet,from:string,to:string,visited=new Set<string>()):number|undefined{
  if(from===to)return 1;if(visited.has(from)||visited.size>80)return;const next=new Set(visited);next.add(from);
  const formula=sheet.cells.get(from)?.formula;if(!formula)return 0;
  // Only direct equality, addition and SUM establish a coefficient of +1.
  // A graph edge alone cannot distinguish a charge from a subtraction, tax,
  // discount or duplicate reference. Unknown expressions remain unresolved.
  const escaped=sheet.name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),quoted=quote(sheet.name).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const expression=formula.replace(/^=/,'').replace(new RegExp(`(?:${quoted}|${escaped})!`,'gi'),'').replace(/\$/g,'').replace(/\s+/g,'').toUpperCase();
  const tokens=expression.match(/[A-Z]{1,3}[1-9]\d*|\d+(?:\.\d+)?|SUM|[()+,:]/g)??[];if(tokens.join('')!==expression)return;
  let index=0;
  const sum=(left:number|undefined,right:number|undefined)=>left===undefined||right===undefined?undefined:left+right;
  function term(inSum=false):number|undefined{
    if(tokens[index]==='+'){index++;return term(inSum);}
    if(tokens[index]==='SUM'){
      index++;if(tokens[index++]!=='(')return;let total=expr(true);while(tokens[index]===','){index++;total=sum(total,expr(true));}if(tokens[index++]!==')')return;return total;
    }
    if(tokens[index]==='('){index++;const total=expr(inSum);if(tokens[index++]!==')')return;return total;}
    const token=tokens[index++];if(!token)return;if(/^\d/.test(token))return 0;if(!/^[A-Z]{1,3}[1-9]\d*$/.test(token))return;
    if(tokens[index]!==':')return positiveCoefficient(book,sheet,token,to,next);
    if(!inSum)return;index++;const last=tokens[index++];if(!/^[A-Z]{1,3}[1-9]\d*$/.test(last??''))return;
    const [c,r]=cellParts(token),[cc,rr]=cellParts(last);if(cc<c||rr<r||(cc-c+1)*(rr-r+1)>50_000)return;let total:number|undefined=0;
    for(const cell of sheet.cells.values()){const [xc,xr]=cellParts(cell.address);if(xc>=c&&xc<=cc&&xr>=r&&xr<=rr)total=sum(total,positiveCoefficient(book,sheet,cell.address,to,next));}return total;
  }
  function expr(inSum=false):number|undefined{let total=term(inSum);while(tokens[index]==='+'){index++;total=sum(total,term(inSum));}return total;}
  const coefficient=expr();return index===tokens.length?coefficient:undefined;
}
function sources(book:RawBook,tables:Journal[]):Source[]{
  const out:Source[]=[];
  for(const journal of tables)for(let row=journal.start;row<=journal.end;row++){
    const account=at(journal.sheet,journal.account,row);if(!account||account.formula||!/[\p{L}]/u.test(account.value)||terminal(account.value))continue;
    const direct=amount(at(journal.sheet,journal.debit,row))||amount(at(journal.sheet,journal.credit,row));
    const source:Source={journal,row,account,code:journal.code?at(journal.sheet,journal.code,row):undefined};
    if(!direct&&journal.partial&&amount(at(journal.sheet,journal.partial,row))){
      const partial=at(journal.sheet,journal.partial,row)!;
      // A partial is assigned a side ONLY if existing formulas prove its relationship
      // with the closest principal amount; proximity or a matching amount is insufficient.
      for(let parent=row-1;parent>=Math.max(journal.start,row-8);parent--){
        const d=at(journal.sheet,journal.debit,parent),c=at(journal.sheet,journal.credit,parent);
        if(!amount(d)&&!amount(c))continue;
        if(amount(d)!==amount(c)){
          const principal=amount(d)?d!:c!;
          const forward=depends(book,journal.sheet,partial.address,principal.address),reverse=depends(book,journal.sheet,principal.address,partial.address);
          if(!(forward&&reverse)&&(forward&&positiveCoefficient(book,journal.sheet,partial.address,principal.address)===1||reverse&&positiveCoefficient(book,journal.sheet,principal.address,partial.address)===1))source.partial={address:partial.address,side:amount(d)?'debit':'credit'};
        }
        break;
      }
    }
    if(!direct&&journal.partial&&amount(at(journal.sheet,journal.partial,row))&&!source.partial)source.unresolved=true;
    if(direct||source.partial||source.unresolved)out.push(source);
  }
  return out;
}
function matches(source:Source,name:string,code?:string){return code&&source.code?.value.trim()?norm(source.code.value)===norm(code):norm(source.account.value)===norm(name);}
function sourceFormula(all:Source[],name:string,side:Side,code?:string):{formula:string;source:string}|undefined{
  const matched=all.filter(s=>matches(s,name,code));if(!matched.length||matched.some(s=>s.unresolved))return;
  if(!code&&new Set(matched.map(s=>norm(s.code?.value??'')).filter(Boolean)).size>1)return;
  // If one recognized journal already points to another journal's same account,
  // adding both could duplicate the posting. The workbook must clarify its scope.
  const amountKeys=new Set(matched.flatMap(s=>s.partial?[`${s.journal.sheet.name}!${s.partial.address}`]:[`${s.journal.sheet.name}!${columnName(s.journal.debit)}${s.row}`,`${s.journal.sheet.name}!${columnName(s.journal.credit)}${s.row}`]));
  for(const s of matched)for(const col of s.partial?[s.partial.address]:[`${columnName(s.journal.debit)}${s.row}`,`${columnName(s.journal.credit)}${s.row}`]){
    const formula=s.journal.sheet.cells.get(col)?.formula;
    if(formula&&referenceKeys(formula,s.journal.sheet.name,{sheets:[...new Set(all.map(x=>x.journal.sheet))]} as RawBook).some(ref=>amountKeys.has(ref)&&!ref.startsWith(`${s.journal.sheet.name}!`)))return;
  }
  const terms:string[]=[];const refs:string[]=[];
  for(const journal of [...new Set(matched.map(s=>s.journal))]){
    const direct=matched.filter(s=>s.journal===journal&&!s.partial);const col=side==='debit'?journal.debit:journal.credit;
    const keys=[...new Map(direct.map(s=>{const key=code&&s.code&&journal.code?s.code.value:s.account.value;return [key.toLocaleLowerCase(),key];})).values()];
    for(const key of keys){
      const useCode=!!code&&!!journal.code&&direct.some(s=>s.code?.value===key);
      const range=`${quote(journal.sheet.name)}!$${columnName(useCode?journal.code!:journal.account)}$${journal.start}:$${columnName(useCode?journal.code!:journal.account)}$${journal.end}`;
      const values=`${quote(journal.sheet.name)}!$${columnName(col)}$${journal.start}:$${columnName(col)}$${journal.end}`;
      terms.push(`SUMIF(${range},"${criterion(key)}",${values})`);refs.push(`${journal.sheet.name}!${columnName(col)}${journal.start}:${columnName(col)}${journal.end}`);
    }
    for(const source of matched.filter(s=>s.journal===journal&&s.partial?.side===side)){terms.push(`${quote(journal.sheet.name)}!${source.partial!.address}`);refs.push(`${journal.sheet.name}!${source.partial!.address}`);}
  }
  // A known account with entries on just one side still needs a live zero on the
  // other side. SUMIF scans the original account/amount columns as rows change.
  if(!terms.length){const j=matched[0].journal,col=side==='debit'?j.debit:j.credit;terms.push(`SUMIF(${quote(j.sheet.name)}!$${columnName(j.account)}$${j.start}:$${columnName(j.account)}$${j.end},"${criterion(matched[0].account.value)}",${quote(j.sheet.name)}!$${columnName(col)}$${j.start}:$${columnName(col)}$${j.end})`);refs.push(`${j.sheet.name}!${columnName(col)}${j.start}:${columnName(col)}${j.end}`);}
  return {formula:terms.length===1?terms[0]:`SUM(${terms.join(',')})`,source:[...new Set(refs)].join(' + ')};
}
function balanceTables(book:RawBook):Table[]{
  const found:Table[]=[];
  for(const sheet of book.sheets.filter(s=>isBalance(s)||isMajor(s))){
    const max=Math.max(1,...[...sheet.cells.keys()].map(a=>cellParts(a)[1]));
    for(let row=1;row<=Math.min(max,150);row++){
      const cells=[...sheet.cells.values()].filter(c=>cellParts(c.address)[1]===row);
      const sideCells=cells.filter(c=>sideHeader(c.value));if(sideCells.length<2)continue;
      const headers=[...cells,...[...sheet.cells.values()].filter(c=>cellParts(c.address)[1]===row-1)];const names=headers.filter(c=>accountHeader(c.value));if(names.length!==1)continue;
      const account=cellParts(names[0].address)[0];const code=headers.find(c=>codeHeader(c.value));
      const table:Table={sheet,row,start:row+1,end:tableEnd(sheet,row,account,max),account,code:code&&cellParts(code.address)[0]};
      table.adjustmentScope=[...sheet.cells.values()].some(c=>{const r=cellParts(c.address)[1];return r>=Math.max(1,row-4)&&r<=table.end&&/\b(?:sin ajustes|con ajustes|ajustad[ao]s?)\b/.test(norm(c.value));});
      let group='';
      for(const cell of sideCells.sort((a,b)=>cellParts(a.address)[0]-cellParts(b.address)[0])){
        const col=cellParts(cell.address)[0],above=norm(at(sheet,col,row-1)?.value??'');if(/sald|movim|sumas|inicial|anterior|apertura/.test(above))group=above;
        const side=sideHeader(cell.value)!,opening=/inicial|anterior|apertura/.test(group),balance=/sald/.test(group)||!group&&/deudor|acreedor/.test(norm(cell.value))&&isBalance(sheet);
        const field=opening?(side==='debit'?'openingDebit':'openingCredit'):balance?(side==='debit'?'balanceDebit':'balanceCredit'):(side==='debit'?'movementDebit':'movementCredit');
        if(table[field]!==undefined){table.ambiguous=true;continue;}table[field]=col;
      }
      found.push(table);row=table.end;
    }
  }
  return found;
}
function plan(book:RawBook):Proposal[]{
  const proposals:Proposal[]=[];const js=journals(book),ss=sources(book,js),tables=balanceTables(book);
  const add=(p:Proposal)=>{if(!proposals.some(x=>x.sheet===p.sheet&&x.address===p.address))proposals.push(p);};
  for(const sheet of book.sheets.filter(isMajor))for(const cell of sheet.cells.values()){
    const m=cell.formula?.match(/^\+?SUM\(\$?([A-Z]+)\$?(\d+):\$?\1\$?(\d+)\)$/i);if(!m)continue;
    const [col,totalRow]=cellParts(cell.address),start=Number(m[2]),end=Number(m[3]);if(totalRow!==end+1)continue;
    const right=at(sheet,col+1,totalRow)?.formula?.replace(/\$/g,'');if(right!==`SUM(${columnName(col+1)}${start}:${columnName(col+1)}${end})`)continue;
    const title=at(sheet,col,start-1);if(!title||title.formula||!title.value.trim())continue;
    const occupied=[...sheet.cells.values()].some(c=>{const [cc,rr]=cellParts(c.address);return (cc===col||cc===col+1)&&rr>=start&&rr<=end&&!blank(c);});if(occupied)continue;
    for(const [side,column]of [['debit',col],['credit',col+1]] as const){const f=sourceFormula(ss,title.value,side);add({sheet,address:`${columnName(column)}${start}`,formula:f?.formula,source:f?.source,code:'STUDENT_MISSING_LINK',message:`Mayor de ${title.value.trim()}: falta el vínculo ${side==='debit'?'deudor':'acreedor'} con las pólizas del libro.`,suggestion:'Indicar el rango fuente de esta cuenta y de este lado. Un importe en Parcial necesita una relación comprobable con Deudor o Acreedor.'});}
  }
  for(const table of tables){
    if(table.ambiguous){add({sheet:table.sheet,address:`${columnName(table.account)}${table.row}`,code:'STUDENT_ACCOUNT_LAYOUT',message:'Las columnas de este bloque repiten lados deudor/acreedor sin distinguir su función.',suggestion:'Identifica las columnas de apertura, movimientos y saldos finales; no se asignarán por posición.'});continue;}
    let names=0;
    for(let row=table.start;row<=table.end;row++){
      const account=at(table.sheet,table.account,row);if(!account||account.formula||!/[\p{L}]/u.test(account.value)||terminal(account.value))continue;names++;
      const code=table.code?at(table.sheet,table.code,row)?.value:undefined;
      const debit=table.adjustmentScope?undefined:sourceFormula(ss,account.value,'debit',code),credit=table.adjustmentScope?undefined:sourceFormula(ss,account.value,'credit',code);
      for(const [field,side]of [['movementDebit','debit'],['movementCredit','credit'],['balanceDebit','debit'],['balanceCredit','credit']] as const){
        const col=table[field];if(!col)continue;const address=`${columnName(col)}${row}`;if(!blank(table.sheet.cells.get(address)))continue;
        let formula=side==='debit'?debit?.formula:credit?.formula;
        if(field.startsWith('balance')){
          const movementReady=!!table.movementDebit&&!!table.movementCredit&&amount(at(table.sheet,table.movementDebit,row))&&amount(at(table.sheet,table.movementCredit,row));
          const openingPresent=!!table.openingDebit||!!table.openingCredit,openingReady=!openingPresent||!!table.openingDebit&&!!table.openingCredit&&amount(at(table.sheet,table.openingDebit,row))&&amount(at(table.sheet,table.openingCredit,row));
          formula=undefined;
          if(openingReady&&(movementReady||debit&&credit)){
            const d=table.movementDebit?`${columnName(table.movementDebit)}${row}`:debit!.formula,c=table.movementCredit?`${columnName(table.movementCredit)}${row}`:credit!.formula;
            const net=`${d}-${c}`,opening=openingPresent?`${columnName(table.openingDebit!)}${row}-${columnName(table.openingCredit!)}${row}`:'';
            formula=opening?`MAX(0,${side==='debit'?`(${opening})+(${net})`:`-(${opening})-(${net})`})`:`MAX(0,${side==='debit'?net:`${c}-${d}`})`;
          }
        }
        add({sheet:table.sheet,address,formula,source:debit&&credit?[debit.source,credit.source].join(' / '):undefined,code:'STUDENT_MISSING_LINK',message:`${account.value.trim()}: la columna ${columnName(col)} no tiene importe ni fórmula.`,suggestion:table.adjustmentScope?'Este bloque distingue ajustes; confirma las pólizas y el rango aplicables. No se copiarán todos los movimientos globales a ambos bloques.':`Indicar la celda o rango fuente de ${side==='debit'?'cargos/saldo deudor':'abonos/saldo acreedor'} para ${account.value.trim()}; los saldos de apertura se conservan como datos de entrada.`});
      }
    }
    if(!names&&isBalance(table.sheet))add({sheet:table.sheet,address:`${columnName(table.account)}${table.start}`,code:'STUDENT_ACCOUNT_LAYOUT',message:'La balanza no tiene nombres o códigos de cuentas en este bloque.',suggestion:'Indicar el rango del propio libro que contiene las cuentas de esta balanza. Se conserva el diseño y no se inventan cuentas.'});
  }
  // A one-sided missing posting in a populated T account is ambiguous. We never
  // copy a neighboring posting or replace captured numbers to force agreement.
  for(const sheet of book.sheets.filter(isReport)){
    let candidates=0;
    for(const account of sheet.cells.values()){
      if(account.formula||!account.value.trim()||!ss.some(s=>matches(s,account.value)))continue;
      const [col,row]=cellParts(account.address);const matching=tables.filter(t=>isBalance(t.sheet)&&!t.ambiguous).flatMap(t=>{
        const rows=[] as {t:Table;r:number}[];for(let r=t.start;r<=t.end;r++)if(norm(at(t.sheet,t.account,r)?.value??'')===norm(account.value))rows.push({t,r});return rows;
      });
      // Only an explicit Deudor/Acreedor heading establishes the sign/column.
      const sideTargets=[...sheet.cells.values()].filter(c=>{const [cc,rr]=cellParts(c.address);return cc>col&&cc<=col+6&&rr<row&&rr>=Math.max(1,row-12)&&!!sideHeader(c.value);});
      const seen=new Set<number>();for(const heading of sideTargets.sort((a,b)=>cellParts(b.address)[1]-cellParts(a.address)[1])){
        const targetCol=cellParts(heading.address)[0];if(seen.has(targetCol))continue;seen.add(targetCol);const address=`${columnName(targetCol)}${row}`;if(!blank(sheet.cells.get(address)))continue;candidates++;
        const side=sideHeader(heading.value)!,match=matching.length===1?matching[0]:undefined;const srcCol=match?(side==='debit'?match.t.balanceDebit:match.t.balanceCredit):undefined;
        const sourceAddress=match&&srcCol?`${columnName(srcCol)}${match.r}`:undefined;
        const source=match&&sourceAddress&&(!blank(match.t.sheet.cells.get(sourceAddress))||proposals.some(p=>p.sheet===match.t.sheet&&p.address===sourceAddress&&p.formula))?`${match.t.sheet.name}!${sourceAddress}`:undefined;
        add({sheet,address,formula:source?`${quote(match!.t.sheet.name)}!${columnName(srcCol!)}${match!.r}`:undefined,source,code:'STUDENT_MISSING_LINK',message:`Falta el saldo de ${account.value.trim()} en el estado financiero.`,suggestion:'Indicar la celda de saldo correcta de la balanza; hay varias fuentes posibles o no se reconoce su columna.'});
      }
    }
    if(!candidates&&![...sheet.cells.values()].some(c=>c.formula&&/!/.test(c.formula)))add({sheet,address:'',code:'STUDENT_REPORT_LAYOUT',message:'El estado financiero no tiene vínculos con las cuentas de la balanza que puedan reconstruirse inequívocamente.',suggestion:'Indicar el rango de nombres de cuentas y la celda o columna de importes en este reporte. No se certifica su cobertura porque sus sumas coincidan.'});
  }
  const safe=proposals.map(p=>p.formula&&!formulaSourcesSafe(book,p.sheet,p.address,p.formula)?{...p,formula:undefined,suggestion:'La conexión propuesta depende de un error o produciría un ciclo; revisa primero sus fuentes. No se insertó la fórmula.'}:p);
  let changed=true;while(changed){changed=false;for(const proposal of safe)if(proposal.formula&&referenceKeys(proposal.formula,proposal.sheet.name,book).some(key=>safe.some(source=>`${source.sheet.name}!${source.address}`===key&&!source.formula))){proposal.formula=undefined;proposal.suggestion='Falta completar una de las celdas fuente de esta conexión; no se usará su espacio vacío como saldo cero.';changed=true;}}
  return safe;
}
function formulaSourcesSafe(book:RawBook,sheet:RawSheet,address:string,formula:string):boolean{
  const original=sheet.cells.get(address),target=`${sheet.name}!${address}`;
  sheet.cells.set(address,{address,value:'',type:'n',formula});
  try{
    const color=new Map<string,number>(),stack:{key:string;exit:boolean}[]=[{key:target,exit:false}];
    while(stack.length){const {key,exit}=stack.pop()!;if(exit){color.set(key,2);continue;}if(color.get(key)===1)return false;if(color.get(key)===2)continue;if(color.size>20_000)return false;
      color.set(key,1);stack.push({key,exit:true});const split=key.lastIndexOf('!'),s=book.sheets.find(x=>x.name===key.slice(0,split)),cell=s?.cells.get(key.slice(split+1));
      if(cell&&/^#(?:REF!|NAME\?|DIV\/0!|VALUE!|N\/A|NUM!|NULL!|SPILL!|CALC!)/i.test(cell.value))return false;
      if(cell?.formula&&brokenReferenceCount(cell.formula))return false;
      if(s&&cell?.formula)for(const ref of referenceKeys(cell.formula,s.name,book))stack.push({key:ref,exit:false});
    }
    return true;
  }finally{if(original)sheet.cells.set(address,original);else sheet.cells.delete(address);}
}
function finding(p:Proposal):WorkbookFinding{return {id:`${p.code}:${p.sheet.name}:${p.address}`,code:p.code,severity:'warning',sheet:p.sheet.name,cell:p.address,message:p.message,suggestion:p.suggestion??'Conectar con fórmulas explícitas a las cuentas coincidentes del propio libro.',repairable:!!p.formula,replacement:p.formula};}
function enrich(audit:WorkbookAudit,extra:WorkbookFinding[]):WorkbookAudit{const findings=[...audit.findings,...extra.filter(f=>!audit.findings.some(x=>x.id===f.id))];return {...audit,findings,stats:{errors:findings.filter(f=>f.severity==='error').length,warnings:findings.filter(f=>f.severity==='warning').length,repairable:findings.filter(f=>f.repairable).length}};}
function validatedReference(value:string,book:RawBook,target:string):string|undefined{
  const m=value.trim().replace(/^=/,'').match(/^(?:'((?:[^']|'')+)'|([^!]+))!(\$?[A-Z]{1,3}\$?[1-9]\d*)(?::(\$?[A-Z]{1,3}\$?[1-9]\d*))?$/i);if(!m)return;
  const sheet=book.sheets.find(s=>s.name.toLowerCase()===(m[1]?.replace(/''/g,"'")??m[2]).trim().toLowerCase());if(!sheet)return;
  const first=m[3].replace(/\$/g,'').toUpperCase(),last=m[4]?.replace(/\$/g,'').toUpperCase();const [c,r]=cellParts(first),[cc,rr]=cellParts(last??first);
  if(c<1||cc>16384||r<1||rr>1048576||cc<c||rr<r||(cc-c+1)*(rr-r+1)>50_000)return;
  if(![...sheet.cells.values()].some(x=>{const [xc,xr]=cellParts(x.address);return xc>=c&&xc<=cc&&xr>=r&&xr<=rr&&!blank(x);}))return;
  const ref=`${quote(sheet.name)}!${m[3].toUpperCase()}${m[4]?`:${m[4].toUpperCase()}`:''}`;
  const refs=referenceKeys(ref,sheet.name,book);if(refs.includes(target))return;
  // Do not accept an answer that creates a cycle through existing formulas.
  const seen=new Set<string>();const reaches=(key:string):boolean=>{if(key===target)return true;if(seen.has(key)||seen.size>10_000)return false;seen.add(key);const split=key.lastIndexOf('!'),s=book.sheets.find(x=>x.name===key.slice(0,split)),cell=s?.cells.get(key.slice(split+1));return !!s&&!!cell?.formula&&referenceKeys(cell.formula,s.name,book).some(reaches);};
  return refs.some(reaches)?undefined:ref;
}
function addReview(book:RawBook,rows:string[][]){
  const existing=book.sheets.find(s=>s.name==='Revisión ContaEZ'||/^cambios(?: contaez)?$/i.test(s.name));
  if(!existing){appendReviewSheet(book,rows);return;}
  let last=Math.max(0,...[...existing.cells.keys()].map(a=>cellParts(a)[1]));
  const content=rows.map(row=>{last++;return `<row r="${last}">${row.map((value,col)=>`<c r="${columnName(col+1)}${last}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`).join('')}</row>`;}).join('');
  existing.xml=existing.xml.replace('</sheetData>',()=>`${content}</sheetData>`).replace(/<dimension\b[^>]*\/>/,`<dimension ref="A1:G${last}"/>`);
}
function periodHeader(sheet:RawSheet,cell:RawCell,js:Journal[]){return !cell.formula&&cellParts(cell.address)[1]<=8&&!js.some(j=>j.sheet===sheet&&cellParts(cell.address)[1]>=j.start)&&![...sheet.cells.values()].some(c=>c.address!==cell.address&&cellParts(c.address)[1]===cellParts(cell.address)[1]&&amount(c));}

export async function repairStudentPractice(data:ArrayBuffer|Uint8Array,filename:string,answers:Record<string,string>={}):Promise<StudentPracticeResult>{
  const book=readRawWorkbook(data);const initial=plan(book);const before=enrich(auditRawWorkbook(book,filename),initial.map(finding));
  const changes:WorkbookFinding[]=[];const connections:StudentConnection[]=[];const questions:StudentQuestion[]=[];
  for(const f of before.findings.filter(f=>f.repairable&&f.replacement&&!f.code.startsWith('STUDENT_'))){
    const sheet=book.sheets.find(s=>s.name===f.sheet)!;const replacement=f.code==='LOCALIZED_FORMULA'?normalizeFormulaFunctions(sheet.cells.get(f.cell)?.formula??f.replacement!):f.replacement!;setFormula(sheet,f.cell,replacement);changes.push({...f,replacement});
  }
  for(const f of before.findings.filter(f=>f.code==='BROKEN_REFERENCE')){
    const answer=answers[f.id];const ref=answer?validatedReference(answer,book,`${f.sheet}!${f.cell}`):undefined;
    if(ref&&f.original&&brokenReferenceCount(f.original)===1){const sheet=book.sheets.find(s=>s.name===f.sheet)!;const original=sheet.cells.get(f.cell)?.formula??f.original;const replacement=replaceBrokenFormulaReference(original,ref);if(!formulaSourcesSafe(book,sheet,f.cell,replacement))continue;setFormula(sheet,f.cell,replacement);changes.push({...f,repairable:true,replacement});connections.push({source:answer.trim(),target:`${f.sheet}!${f.cell}`,description:'Referencia indicada por el usuario y validada dentro de este libro.'});}
  }
  for(const proposal of plan(book)){
    if(!proposal.address||!blank(proposal.sheet.cells.get(proposal.address)))continue;
    const f=finding(proposal),answer=answers[f.id];const ref=answer?validatedReference(answer,book,`${f.sheet}!${f.cell}`):undefined;
    const formula=ref?(/:/.test(ref)?`SUM(${ref})`:ref):proposal.formula;if(!formula||!formulaSourcesSafe(book,proposal.sheet,proposal.address,formula))continue;
    setFormula(proposal.sheet,proposal.address,formula);changes.push({...f,replacement:formula});connections.push({source:ref?answer.trim():proposal.source??'',target:`${f.sheet}!${f.cell}`,description:ref?'Fuente indicada por el usuario.':proposal.message});
  }
  // Period answers affect only textual headers, never operation dates or amounts.
  const periodJournals=journals(book);
  for(const f of before.findings.filter(f=>f.code==='PERIOD_CONFLICT')){
    const answer=answers[f.id]?.trim();if(!/^(?:19|20)\d{2}$/.test(answer??''))continue;
    for(const sheet of book.sheets)for(const cell of sheet.cells.values())if(periodHeader(sheet,cell,periodJournals)&&/\b(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\s+(?:de(?:l)?\s+)?20\d{2}\b/i.test(cell.value)){
      const original=cell.value,replacement=original.replace(/\b20\d{2}\b/g,answer!);if(original===replacement)continue;
      const re=new RegExp(`<c\\b([^>]*\\br="${cell.address}"[^>]*)>([\\s\\S]*?)<\\/c>`);sheet.xml=sheet.xml.replace(re,(_all,attrs:string)=>`<c${attrs.replace(/\s+t="[^"]*"/g,'')} t="inlineStr"><is><t xml:space="preserve">${escapeXml(replacement)}</t></is></c>`);cell.value=replacement;cell.type='inlineStr';changes.push({...f,id:`${f.id}:${sheet.name}:${cell.address}`,sheet:sheet.name,cell:cell.address,original,replacement,repairable:true});
    }
  }
  const after=enrich(auditRawWorkbook(book,filename),plan(book).map(finding)),pending=after.findings.filter(f=>f.severity!=='info');
  for(const f of pending){
    if((f.code==='BROKEN_REFERENCE'&&(f.original?.match(/#REF!/gi)?.length??0)===1)||f.code==='STUDENT_MISSING_LINK')questions.push({id:f.id,title:`¿Cuál es la fuente de ${f.sheet}!${f.cell}?`,explanation:`${f.message} ${f.suggestion}${answers[f.id]?' La respuesta anterior no identifica una referencia válida o produciría un ciclo.':''}`,placeholder:'Diario!D8 o \'Balanza de comprobación\'!D6:D10'});
    else if(f.code==='PERIOD_CONFLICT'){const sheet=book.sheets.find(s=>s.name===f.sheet),cell=sheet?.cells.get(f.cell);if(sheet&&cell&&periodHeader(sheet,cell,periodJournals))questions.push({id:f.id,title:`Confirma el ejercicio del encabezado ${f.sheet}!${f.cell}`,explanation:'Indica el año correcto. Solo se actualizarán encabezados con mes y año en las primeras ocho filas; las fechas de las operaciones se conservan.',placeholder:'2026'});}
  }
  if(changes.length||!book.sheets.some(s=>s.name==='Revisión ContaEZ'||/^cambios(?: contaez)?$/i.test(s.name)))addReview(book,[['Estado','Hoja','Celda','Hallazgo','Antes','Después / acción','Alcance'],...changes.map(f=>['Conectado / corregido',f.sheet,f.cell,f.message,f.original??'',f.replacement??'','Fórmula en el libro original; requiere recálculo en Excel']),...pending.map(f=>['Pendiente',f.sheet,f.cell,f.message,f.original??'',f.suggestion,'No certificado']),['Información','','','Se conservan hojas, datos capturados y componentes del archivo.','','','Las coincidencias de totales no certifican cobertura ni exactitud integral.']]);
  // appendReviewSheet owns newly added review XML; existing sheets are written
  // verbatim except the explicit cells above and the appended review rows.
  const output=writeRawWorkbook(book);return {data:output,before,after,changes,pending,connections,questions};
}
