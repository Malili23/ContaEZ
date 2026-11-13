import './style.css';
import { createProject, makeDemoProject, processProject, proposeChat, applyChatProposal, newId } from '../src/core';
import type { ChatProposal, Mode, Operation, OperationType, Project } from '../src/core/types';
import { exportWorkbook } from '../src/io';
import type { StudentPracticeResult } from '../src/io/student';
import { repairStudentPractice } from '../src/studentProcessor';

declare const Office: { onReady(callback: (info: { host?: string }) => void): void };
declare const Excel: { run<T>(callback: (context: any) => Promise<T>): Promise<T>; createWorkbook?: (base64?: string) => Promise<void> | void };
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
let project: Project = createProject('business', 'Proyecto desde Excel', '2026-01');
let pending: ChatProposal | null = null;
let selectedContext = '';
let ready = false;
const display = (id: string, text: string, error = false) => { $(id).textContent = text; $(id).classList.toggle('error', error); };
let practiceFile: File | null = null;
let practiceOriginal: Uint8Array | null = null;
let practiceResult: StudentPracticeResult | null = null;
let practiceAnswers: Record<string,string> = {};
let practiceBusy = false;
const asBase64 = (data: Uint8Array) => { let binary='';for(let offset=0;offset<data.length;offset+=8192)binary+=String.fromCharCode(...data.subarray(offset,offset+8192));return btoa(binary); };
const practiceStatus = (message:string,error=false) => { $('practice-status').hidden=false;display('practice-status',message,error); };
const setPracticeButtons = () => {
  ($('practice-review') as HTMLButtonElement).disabled=practiceBusy||!practiceFile;
  ($('practice-download') as HTMLButtonElement).disabled=practiceBusy||!practiceResult;
  ($('practice-open') as HTMLButtonElement).disabled=practiceBusy||!practiceResult||!ready||typeof Excel==='undefined'||typeof Excel.createWorkbook!=='function';
  ($('practice-file') as HTMLInputElement).disabled=practiceBusy;
};
async function runPractice(action:()=>Promise<void>){
  if(practiceBusy)return;practiceBusy=true;setPracticeButtons();
  try{await action();}catch(error){practiceStatus(error instanceof Error?error.message:String(error),true);}finally{practiceBusy=false;setPracticeButtons();}
}
function renderPractice(){
  const result=practiceResult;if(!result)return;$('practice-result').hidden=false;
  display('practice-summary',`${result.changes.length} cambios aplicados · ${result.connections.length} vínculos creados · ${result.pending.length} observaciones pendientes. ${result.questions.length?'Responde las preguntas para avanzar con las referencias que faltan.':'Consulta el informe antes de utilizar el resultado.'}`);
  const renderFindings=(id:string,findings:StudentPracticeResult['changes'],empty:string)=>{
    const target=$(id);target.replaceChildren();if(!findings.length){target.textContent=empty;return;}
    for(const item of findings){const article=document.createElement('article'),heading=document.createElement('strong'),text=document.createElement('p');heading.textContent=`${item.sheet}${item.cell?'!'+item.cell:''}`;text.textContent=`${item.message}\n${item.suggestion}`;article.append(heading,text);if(item.replacement){const formula=document.createElement('code');formula.textContent=item.replacement;article.append(formula);}target.append(article);}
  };
  renderFindings('practice-changes',result.changes,'No se hicieron cambios por suposición. Revisa las observaciones pendientes.');
  renderFindings('practice-pending',result.pending,'No quedan observaciones de las comprobaciones admitidas. Esto no equivale a una auditoría integral.');
  const target=$('practice-questions');target.replaceChildren();
  if(result.questions.length){const heading=document.createElement('h3');heading.textContent='Para avanzar, confirma estos datos';target.append(heading);}
  for(const question of result.questions){
    const form=document.createElement('form'),label=document.createElement('label'),title=document.createElement('strong'),text=document.createElement('p'),input=document.createElement('input'),button=document.createElement('button');form.className='practice-question';title.textContent=question.title;text.textContent=question.explanation;input.placeholder=question.placeholder;input.value=practiceAnswers[question.id]||'';input.required=true;label.append(title,input);button.textContent='Aplicar dato y revisar';button.className='secondary';button.type='submit';form.append(text,label,button);
    form.onsubmit=event=>{event.preventDefault();const answer=input.value.trim();if(!answer)return;void runPractice(async()=>{if(!practiceOriginal||!practiceFile)throw new Error('Vuelve a elegir tu práctica.');practiceStatus('Revisando el mismo libro con esta aclaración…');const answers={...practiceAnswers,[question.id]:answer};const updated=await repairStudentPractice(practiceOriginal.slice(),practiceFile.name,answers);practiceAnswers=answers;practiceResult=updated;renderPractice();practiceStatus(updated.questions.some(q=>q.id===question.id)?'La referencia necesita otra aclaración. Consulta la pregunta antes de descargar.':'La aclaración se aplicó a la nueva revisión. Tu original sigue intacto.');});};target.append(form);
  }
  setPracticeButtons();
}
$('practice-file').onchange=()=>{
  const file=($('practice-file') as HTMLInputElement).files?.[0]??null;practiceFile=null;practiceOriginal=null;practiceResult=null;practiceAnswers={};$('practice-result').hidden=true;$('practice-status').hidden=true;
  if(file&&!/\.xlsx$/i.test(file.name)){practiceStatus('Elige una práctica guardada en formato .xlsx.',true);}else if(file&&file.size>50*1024*1024){practiceStatus('El archivo supera 50 MB. Elige una copia de trabajo más pequeña.',true);}else{practiceFile=file;display('practice-file-name',file?file.name:'Elige una copia guardada de tu archivo, aunque ya esté abierto en Excel.');}setPracticeButtons();
};
$('practice-review').onclick=()=>void runPractice(async()=>{
  if(!practiceFile)throw new Error('Primero elige tu práctica .xlsx.');practiceStatus('Revisando fórmulas y conexiones de tu práctica…');practiceOriginal=new Uint8Array(await practiceFile.arrayBuffer());practiceAnswers={};practiceResult=await repairStudentPractice(practiceOriginal.slice(),practiceFile.name);renderPractice();practiceStatus('Revisión lista. Puedes descargar una copia con los cambios y pendientes.');
});
$('practice-download').onclick=()=>{
  if(!practiceFile||!practiceResult)return;const url=URL.createObjectURL(new Blob([practiceResult.data as BlobPart],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));const link=document.createElement('a');link.href=url;link.download=practiceFile.name.replace(/\.xlsx$/i,'')+'__corregida.xlsx';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);practiceStatus('Copia preparada para descargar. El informe del Excel explica los cambios y lo que falta.');
};
$('practice-open').onclick=()=>void runPractice(async()=>{
  if(!practiceResult||!ready||typeof Excel==='undefined'||typeof Excel.createWorkbook!=='function')throw new Error('Para abrir la copia desde este botón, utiliza el complemento dentro de una versión compatible de Excel. También puedes descargarla.');await Excel.createWorkbook(asBase64(practiceResult.data));practiceStatus('Se solicitó abrir una copia en Excel. Guárdala con otro nombre para conservar tu original.');
});
const mode = () => $('mode') as HTMLSelectElement;
const period = () => $('period') as HTMLInputElement;
const clean = (value: unknown) => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
async function busy(id: string, action: () => Promise<void>) { const button = $(id) as HTMLButtonElement; button.disabled = true; try { await action(); } catch (error) { display('host-status', error instanceof Error ? error.message : String(error), true); } finally { button.disabled = false; } }
async function selection(): Promise<{ values: unknown[][]; formulas: unknown[][]; address: string; rowIndex: number; columnIndex: number }> {
  if (!ready || typeof Excel === 'undefined') throw new Error('Abre este complemento dentro de Excel para leer la selección.');
  return Excel.run(async context => { const range = context.workbook.getSelectedRange(); range.load(['values','formulas','address','rowIndex','columnIndex','cellCount']); await context.sync(); if (range.cellCount > 100000) throw new Error('Selecciona hasta 100,000 celdas por revisión.'); return { values: range.values, formulas: range.formulas, address: range.address, rowIndex: range.rowIndex, columnIndex: range.columnIndex }; });
}
function columnName(index: number): string { let label = ''; for (let n=index+1;n>0;n=Math.floor((n-1)/26)) label=String.fromCharCode(65+(n-1)%26)+label; return label; }
function renderPreview() {
  const count = project.operations.length;
  display('preview', `${count} operaciones leídas · ${project.period} · ${project.mode === 'student' ? 'Práctica' : project.mode === 'business' ? 'Empresa' : 'Persona física'}. Los datos aún requieren confirmación.`);
  ($('confirm') as HTMLInputElement).checked=false; ($('export') as HTMLButtonElement).disabled=true;
}
const typeMap: Record<string,OperationType> = { compra:'purchase',purchase:'purchase',venta:'sale',sale:'sale',gasto:'expense',expense:'expense',cobro:'collection',collection:'collection',pago:'payment',payment:'payment',aportacion:'contribution',contribution:'contribution','devolucion compra':'purchase_return','devolucion venta':'sale_return' };
function excelDate(value: unknown): string {
  if(typeof value==='number') return new Date(Date.UTC(1899,11,30)+value*86400000).toISOString().slice(0,10);
  const text=String(value??'').trim();
  const iso=/^(\d{4})-(\d{2})-(\d{2})/.exec(text);if(iso)return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const local=/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(text);if(local)return `${local[3]}-${local[2].padStart(2,'0')}-${local[1].padStart(2,'0')}`;
  throw new Error(`Fecha sin identificar: ${text}. Usa una fecha de Excel o AAAA-MM-DD.`);
}
$('review').onclick=()=>void busy('review',async()=>{
  const data=await selection();const findings:string[]=[];
  data.values.forEach((row,r)=>row.forEach((value,c)=>{
    const formula=String(data.formulas[r]?.[c]??'');const address=`${columnName(data.columnIndex+c)}${data.rowIndex+r+1}`;
    if(/^#(REF!|DIV\/0!|VALUE!|NAME\?|N\/A|NUM!|NULL!|SPILL!|CALC!)/i.test(String(value)))findings.push(`${address}: ${String(value)}. Revisa el origen y sus dependencias.`);
    if(formula.startsWith('=')&&/#REF!/i.test(formula))findings.push(`${address}: la fórmula contiene una referencia rota.`);
    if(formula.startsWith('=')&&new RegExp(`(^|[^A-Z0-9_])\\$?${columnName(data.columnIndex+c)}\\$?${data.rowIndex+r+1}([^0-9]|$)`,'i').test(formula))findings.push(`${address}: posible autorreferencia; comprueba el rango de suma.`);
  }));
  selectedContext=`Selección ${data.address}\n${data.values.slice(0,200).map(row=>row.map(v=>String(v??'')).join('\t')).join('\n')}\nHallazgos:\n${findings.join('\n')}`;
  display('audit', findings.length?findings.join('\n'):`No se detectaron estos errores en ${data.address}. La revisión de una selección no certifica la contabilidad ni sus dependencias externas.`);
  display('host-status','Selección revisada. No se modificó el libro.');
});
$('import').onclick=()=>void busy('import',async()=>{
  const {values}=await selection();if(values.length<2)throw new Error('Selecciona los encabezados y al menos una operación.');
  const headers=values[0].map(clean);const locate=(names:string[])=>headers.findIndex(h=>names.includes(h));
  const dateCol=locate(['fecha','date']);const typeCol=locate(['tipo','type']);const amountCol=locate(['importe','base','subtotal','amount']);
  if([dateCol,typeCol,amountCol].some(c=>c<0))throw new Error('La tabla requiere las columnas Fecha, Tipo e Importe (base antes de IVA).');
  const descriptionCol=locate(['descripcion','concepto','description']);const vatCol=locate(['iva','tasa iva','vat']);const methodCol=locate(['medio','forma de pago','pago']);const productCol=locate(['producto','product']);const quantityCol=locate(['cantidad','quantity']);const unitCol=locate(['costo unitario','unit cost']);
  const next=createProject(mode().value as Mode,'Proyecto desde Excel',period().value);
  values.slice(1).filter(row=>row.some(v=>v!==''&&v!=null)).forEach((row,index)=>{
    const type=typeMap[clean(row[typeCol])];if(!type)throw new Error(`Fila ${index+2}: tipo de operación sin identificar.`);
    const amount=Number(row[amountCol]);if(!Number.isFinite(amount)||amount<0)throw new Error(`Fila ${index+2}: importe inválido.`);
    const rawRate=vatCol>=0?row[vatCol]:undefined;if(rawRate==null||rawRate==='')throw new Error(`Fila ${index+2}: confirma la tasa de IVA; usa 0 para una base sin IVA.`);
    const rate=typeof rawRate==='string'&&rawRate.includes('%')?Number(rawRate.replace('%',''))/100:Number(rawRate)>1?Number(rawRate)/100:Number(rawRate);if(!Number.isFinite(rate))throw new Error(`Fila ${index+2}: tasa inválida.`);
    const method=methodCol<0?'':clean(row[methodCol]);if(!['efectivo','cash','banco','transferencia','bank','credito','credit'].includes(method))throw new Error(`Fila ${index+2}: confirma Medio (efectivo, banco o crédito).`);
    const operation:Operation={id:newId(),date:excelDate(row[dateCol]),type,description:descriptionCol>=0?String(row[descriptionCol]??''):String(row[typeCol]),amount:String(amount),vatRate:String(rate),paymentMethod:['credito','credit'].includes(method)?'credit':['efectivo','cash'].includes(method)?'cash':'bank',sourceIds:[],confirmed:false};
    if(productCol>=0&&row[productCol])operation.productId=String(row[productCol]);if(quantityCol>=0&&row[quantityCol]!==''&&row[quantityCol]!=null)operation.quantity=String(row[quantityCol]);if(unitCol>=0&&row[unitCol]!==''&&row[unitCol]!=null)operation.unitCost=String(row[unitCol]);next.operations.push(operation);
  }); project=next;renderPreview();display('host-status','Tabla importada para revisión; el original sigue intacto.');
});
$('demo').onclick=()=>{project=makeDemoProject(mode().value as Mode);period().value=project.period;renderPreview();display('host-status','Ejemplo demostrativo cargado.');};
$('confirm').onchange=()=>{($('export') as HTMLButtonElement).disabled=!(($('confirm') as HTMLInputElement).checked&&project.operations.length);};
$('export').onclick=()=>void busy('export',async()=>{
  if(!($('confirm') as HTMLInputElement).checked)throw new Error('Primero revisa y confirma la interpretación de los datos.');
  project={...project,operations:project.operations.map(o=>({...o,confirmed:true}))};const result=processProject(project);const bytes=await exportWorkbook(project,result);
  let binary='';for(let offset=0;offset<bytes.length;offset+=8192)binary+=String.fromCharCode(...bytes.subarray(offset,offset+8192));
  if(typeof Excel!=='undefined'&&typeof Excel.createWorkbook==='function')Excel.createWorkbook(btoa(binary));
  else{const url=URL.createObjectURL(new Blob([bytes as BlobPart],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));const link=document.createElement('a');link.href=url;link.download='ContaEZ-reportes.xlsx';link.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}
  display('host-status',`Copia preparada con ${result.entries.length} asientos y ${result.issues.length} observaciones. Revisa la hoja Revisión ContaEZ.`);
});
$('chat').onclick=()=>{pending=proposeChat(project,($('message') as HTMLTextAreaElement).value);display('proposal',pending.message);$('apply').hidden=pending.kind==='clarification';};
$('apply').onclick=()=>{if(!pending)return;project=applyChatProposal(project,pending);pending=null;$('apply').hidden=true;renderPreview();display('proposal','Cambio confirmado. Revisa y vuelve a generar una copia para actualizar los reportes.');};
$('chatgpt').onclick=()=>void busy('chatgpt',async()=>{const question=($('message') as HTMLTextAreaElement).value.trim();if(!question)throw new Error('Escribe la consulta que quieres copiar.');await navigator.clipboard.writeText(`${question}\n\nInformación seleccionada en Excel:\n${selectedContext||'Sin selección compartida.'}`);window.open('https://chatgpt.com/','_blank','noopener,noreferrer');display('host-status','Consulta copiada. Pégala en tu ChatGPT para enviarla con tu propia cuenta.');});
if(typeof Office!=='undefined')Office.onReady(info=>{ready=String(info.host).toLowerCase()==='excel';setPracticeButtons();display('host-status',ready?'Conectado a Excel. Estas herramientas leen la selección cuando lo solicitas.':'Para leer una selección, abre ContaEZ desde Complementos de Excel. La revisión de un archivo .xlsx está arriba.');});
else display('host-status','Vista del complemento. Para leer celdas, ábrelo dentro de Excel.');

