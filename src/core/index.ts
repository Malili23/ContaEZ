import type { ChatProposal, JournalEntry, Mode, Operation, Project } from './types';
import { DEFAULT_ACCOUNTS } from './catalog';
import { RULE_SET } from './rules';
import { processProject } from './engine';
import Decimal from 'decimal.js';
export * from './types';
export * from './catalog';
export * from './rules';
export { processProject } from './engine';

export function newId():string {return globalThis.crypto?.randomUUID?.()??`${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;}
export function parseProject(raw:unknown):Project {
  const object=(v:unknown):v is Record<string,unknown>=>typeof v==='object'&&v!==null&&!Array.isArray(v);
  const invalid=()=>new Error('El archivo no es un proyecto ContaEZ compatible. Conserva el original y revisa su formato.');
  if(!object(raw)||raw.schemaVersion!==1||!['student','business','individual'].includes(String(raw.mode))||raw.jurisdiction!=='MX'||raw.currency!=='MXN')throw invalid();
  const expectedRegime={student:'school',business:'601',individual:'612'}[raw.mode as Mode];
  if(raw.regime!==expectedRegime)throw new Error('La modalidad y el régimen del archivo no coinciden con una combinación admitida por ContaEZ.');
  if(!['id','name','period','rfc','ruleSetId','createdAt','updatedAt'].every(k=>typeof raw[k]==='string')||!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(raw.period)))throw invalid();
  if(!['analytical','perpetual'].includes(String(raw.inventorySystem))||!['fifo','average'].includes(String(raw.valuation))||typeof raw.closed!=='boolean')throw invalid();
  if(!['accounts','documents','operations','manualEntries','inventoryInitial','bankTransactions','assets','chat','revisions','notes'].every(k=>Array.isArray(raw[k])))throw invalid();
  if(!object(raw.taxConfig)||!['coefficient','previousIsr','priorTaxableIncome','priorDeductions','priorRetentions','finalInventory'].every(k=>typeof (raw.taxConfig as Record<string,unknown>)[k]==='string')||typeof raw.taxConfig.openingBalancesConfirmed!=='boolean')throw invalid();
  for(const a of raw.accounts as unknown[])if(!object(a)||!['code','name','type','nature'].every(k=>typeof a[k]==='string')||!['asset','liability','equity','income','cost','expense'].includes(String(a.type))||!['debit','credit'].includes(String(a.nature)))throw invalid();
  const stringArray=(v:unknown):boolean=>Array.isArray(v)&&v.every(x=>typeof x==='string');
  const operationTypes=['purchase','sale','collection','payment','purchase_return','sale_return','expense','contribution','adjustment'];
  const operationShape=(o:unknown):boolean=>object(o)&&['id','date','type','description','amount','vatRate','paymentMethod'].every(k=>typeof o[k]==='string')&&operationTypes.includes(String(o.type))&&['cash','bank','credit'].includes(String(o.paymentMethod))&&stringArray(o.sourceIds)&&typeof o.confirmed==='boolean'&&['accountCode','counterpartyCode','productId','quantity','unitCost','relatedOperationId','invoiceId','openingOutstandingBase'].every(k=>o[k]===undefined||typeof o[k]==='string')&&['taxDeductible','referenceOnly'].every(k=>o[k]===undefined||typeof o[k]==='boolean');
  for(const o of raw.operations as unknown[])if(!operationShape(o))throw invalid();
  for(const e of raw.manualEntries as unknown[]){if(!object(e)||!['id','date','concept','kind'].every(k=>typeof e[k]==='string')||!['opening','income','expense','diary','adjustment'].includes(String(e.kind))||!Array.isArray(e.lines)||!stringArray(e.sourceIds))throw invalid();for(const l of e.lines)if(!object(l)||!['id','accountCode','debit','credit'].every(k=>typeof l[k]==='string'))throw invalid();}
  for(const d of raw.documents as unknown[])if(!object(d)||!['id','name','mime','hash','importedAt','status'].every(k=>typeof d[k]==='string')||!['pending','confirmed','duplicate'].includes(String(d.status))||(d.contentBase64!==undefined&&typeof d.contentBase64!=='string'))throw invalid();
  for(const lot of raw.inventoryInitial as unknown[])if(!object(lot)||!['id','productId','date','quantity','unitCost'].every(k=>typeof lot[k]==='string'))throw invalid();
  for(const b of raw.bankTransactions as unknown[])if(!object(b)||!['id','date','description','amount'].every(k=>typeof b[k]==='string'))throw invalid();
  for(const a of raw.assets as unknown[])if(!object(a)||!['id','name','type','cost','residual','startDate','accountCode','expenseAccountCode'].every(k=>typeof a[k]==='string')||!['depreciation','amortization'].includes(String(a.type))||typeof a.usefulLifeMonths!=='number')throw invalid();
  for(const r of raw.revisions as unknown[])if(!object(r)||!['id','at','label','snapshot'].every(k=>typeof r[k]==='string'))throw invalid();
  for(const c of raw.chat as unknown[]){
    if(!object(c)||!['id','role','text','at'].every(k=>typeof c[k]==='string')||!['user','assistant'].includes(String(c.role)))throw invalid();
    if(c.proposal!==undefined){
      const proposal=c.proposal;
      if(!object(proposal)||!['period','method','operation','note','clarification'].includes(String(proposal.kind))||typeof proposal.message!=='string')throw invalid();
      if(proposal.operation!==undefined&&!operationShape(proposal.operation))throw invalid();
      if(proposal.note!==undefined&&typeof proposal.note!=='string')throw invalid();
      if(proposal.patch!==undefined){const patch=proposal.patch;if(!object(patch)||Object.keys(patch).some(k=>!['period','inventorySystem','valuation'].includes(k))||(patch.period!==undefined&&(typeof patch.period!=='string'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(patch.period)))||(patch.inventorySystem!==undefined&&!['analytical','perpetual'].includes(String(patch.inventorySystem)))||(patch.valuation!==undefined&&!['fifo','average'].includes(String(patch.valuation))))throw invalid();}
    }
  }
  if(!(raw.notes as unknown[]).every(n=>typeof n==='string'))throw invalid();
  return structuredClone(raw) as unknown as Project;
}
export function createProject(mode:Mode,name?:string,period='2026-01'):Project {
  const now=new Date().toISOString();
  return {schemaVersion:1,id:newId(),name:name?.trim()||({student:'Mi práctica contable',business:'Mi empresa comercial',individual:'Mi actividad profesional'}[mode]),mode,period,rfc:'',regime:mode==='student'?'school':mode==='business'?'601':'612',inventorySystem:'perpetual',valuation:'fifo',currency:'MXN',jurisdiction:'MX',ruleSetId:RULE_SET.id,accounts:structuredClone(DEFAULT_ACCOUNTS),documents:[],operations:[],manualEntries:[],inventoryInitial:[],bankTransactions:[],assets:[],chat:[],revisions:[],notes:[],closed:false,taxConfig:{coefficient:'',previousIsr:'',priorTaxableIncome:'',priorDeductions:'',priorRetentions:'',openingBalancesConfirmed:false,finalInventory:'',priorPeriodConfirmed:false,vatRetentions:'',retentionsConfirmed:false},createdAt:now,updatedAt:now};
}

export function createRevision(project:Project,label:string):Project {
  const snapshot=JSON.stringify({...project,revisions:[]});
  return {...project,revisions:[...project.revisions,{id:newId(),at:new Date().toISOString(),label,snapshot}].slice(-30),updatedAt:new Date().toISOString()};
}
export function restoreRevision(project:Project,id:string):Project {
  const revision=project.revisions.find(r=>r.id===id);
  if(!revision)throw new Error('No se encontró la revisión seleccionada.');
  const previous=parseProject(JSON.parse(revision.snapshot));
  const withAudit=createRevision(project,`Antes de restaurar: ${revision.label}`);
  return {...previous,revisions:withAudit.revisions,closed:false,updatedAt:new Date().toISOString()};
}
export function closeProject(project:Project):Project {
  const result=processProject(project);
  const pendingCodes=new Set(['OPERATION_PENDING','DOCUMENT_PENDING','ENTRY_SOURCE_PENDING','BANK_STATEMENT','BANK_UNMATCHED','BANK_DIFFERENCE','BANK_MATCH_MISMATCH']);
  if(result.issues.some(i=>i.severity==='error'||pendingCodes.has(i.code))||!project.taxConfig.openingBalancesConfirmed)throw new Error('Resolver incidencias, documentos/operaciones pendientes y conciliación; confirmar saldos iniciales antes de cerrar.');
  if(project.mode!=='student'&&!project.rfc.trim())throw new Error('Capturar y confirmar el RFC antes de cerrar el proyecto profesional.');
  if(project.mode!=='student'&&result.taxes.status==='incomplete')throw new Error('Completar los datos del papel de trabajo fiscal antes de cerrar este proyecto profesional.');
  return {...createRevision(project,`Cierre ${project.period} · ${project.ruleSetId}`),closed:true};
}
export function reopenProject(project:Project,reason:string):Project {
  if(reason.trim().length<5)throw new Error('Indicar el motivo de la reapertura.');
  return {...createRevision(project,`Reapertura: ${reason.trim()}`),closed:false};
}

function cleanText(text:string):string {return text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();}
function parseAmount(input:string):string|null {
  const raw=input.replace(/\s/g,'');
  let normalized=raw;
  if(raw.includes(',')&&raw.includes('.'))normalized=raw.lastIndexOf('.')>raw.lastIndexOf(',')?raw.replace(/,/g,''):raw.replace(/\./g,'').replace(',','.');
  else if(raw.includes(','))normalized=/,\d{1,2}$/.test(raw)?raw.replace(',','.'):raw.replace(/,/g,'');
  try {const d=new Decimal(normalized);return d.isFinite()&&d.gt(0)?d.toFixed(2):null;}catch{return null;}
}
export function proposeChat(project:Project,text:string):ChatProposal {
  const normalized=cleanText(text);
  if(!normalized)return {kind:'clarification',message:'Escribe qué dato quieres agregar o corregir.'};
  const namedMonth=normalized.match(/\b(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\s+(?:de\s+)?(20\d{2})\b/);
  const numericMonth=normalized.match(/\b(20\d{2})[-/](0?[1-9]|1[0-2])\b/);
  if(namedMonth||numericMonth){
    const months=['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
    const year=namedMonth?namedMonth[2]:numericMonth![1],month=namedMonth?months.indexOf(namedMonth[1]==='setiembre'?'septiembre':namedMonth[1])+1:Number(numericMonth![2]);
    const period=`${year}-${String(month).padStart(2,'0')}`;
    return {kind:'period',patch:{period},message:`Propongo cambiar el periodo de ${project.period} a ${period}. Las fechas de documentos y operaciones se conservarán; señalaré las que queden fuera. Confirma antes de aplicar.`};
  }
  if(/\banalitic[oa]\b/.test(normalized))return {kind:'method',patch:{inventorySystem:'analytical'},message:'Propongo usar método analítico. Se conservarán las operaciones y será necesario confirmar el inventario final para calcular el costo de ventas. Confirma el cambio.'};
  if(/\b(peps|fifo)\b/.test(normalized))return {kind:'method',patch:{inventorySystem:'perpetual',valuation:'fifo'},message:'Propongo inventarios perpetuos con PEPS. Se recalcularán capas, costo de ventas y reportes. Confirma el cambio.'};
  if(/\b(promedio|promediado)\b/.test(normalized))return {kind:'method',patch:{inventorySystem:'perpetual',valuation:'average'},message:'Propongo inventarios perpetuos con promedio móvil. Se recalculará el costo después de cada entrada. Confirma el cambio.'};
  if(/\bperpetu[oa]s?\b/.test(normalized))return {kind:'method',patch:{inventorySystem:'perpetual'},message:'Propongo usar inventarios perpetuos, conservando el método de valuación actual. Confirma el cambio.'};
  if(/^(nota|instruccion|aclaracion)\s*:/.test(normalized))return {kind:'note',note:text.replace(/^[^:]+:\s*/,''),message:'Guardaré esta información como nota del proyecto. No modificaré asientos ni cifras hasta convertirla en datos confirmados.'};
  if(/\b(error|errores|revisa|revisar|problema|por que|explica)\b/.test(normalized)){
    const result=processProject(project),errors=result.issues.filter(i=>i.severity==='error');
    return {kind:'clarification',message:errors.length?errors.slice(0,3).map(i=>`${i.title}: ${i.detail} ${i.suggestion}`).join('\n\n'):'No encontré errores bloqueantes en los datos registrados. Revisa también advertencias, documentos pendientes y cobertura; el cuadre por sí solo no certifica el trabajo.'};
  }
  const type:Operation['type']|null=/\b(gasto|renta|honorarios|servicio pagado)\b/.test(normalized)?'expense':/\b(venta|servicio cobrado)\b/.test(normalized)?'sale':/\b(aportacion|aporte|capital)\b/.test(normalized)?'contribution':null;
  const rawAmount=normalized.match(/(?:\$\s*|\b(?:por|de)\s+)(\d[\d.,]*)/);
  if(type&&rawAmount){
    const amount=parseAmount(rawAmount[1]);
    const explicitVat=normalized.match(/(?:iva\s*(?:incluido\s*)?(?:al|del|de)?\s*(\d+(?:[.,]\d+)?)\s*%|\b(\d+(?:[.,]\d+)?)\s*%\s*(?:de\s*)?iva)/);
    const zeroVat=/\bsin iva\b|\btasa (?:0|cero)\b/.test(normalized)||type==='contribution';
    if(!amount)return {kind:'clarification',message:'No pude confirmar el importe. Usa, por ejemplo: «Agrega gasto por $1,000 sin IVA pagado por banco».'};
    if(!explicitVat&&!zeroVat)return {kind:'clarification',message:'Indica la tasa de IVA o escribe «sin IVA». Ejemplo: «Agrega gasto por $1,000 más IVA 16% pagado por banco». No asumiré una tasa por tu ubicación.'};
    if(/\bunidades|\bpiezas|\bkilos|\bkg\b/.test(normalized))return {kind:'clarification',message:'La operación incluye mercancías. Usa el formulario de operación para confirmar producto, cantidad, base sin IVA y forma de pago; así puedo calcular el inventario sin inventar datos.'};
    const rate=zeroVat?'0':new Decimal((explicitVat![1]||explicitVat![2]).replace(',','.')).div(100).toString();
    if(new Decimal(rate).gt(1))return {kind:'clarification',message:'La tasa de IVA no es válida. Captura un porcentaje entre 0 y 100 y revisa el tratamiento que corresponda.'};
    const inclusive=/\b(incluido|incluye|con iva incluido)\b/.test(normalized);
    const base=inclusive?new Decimal(amount).div(new Decimal(rate).add(1)).toFixed(2):amount;
    const paymentMethod=/\bcredito\b/.test(normalized)?'credit':/\befectivo|\bcaja\b/.test(normalized)?'cash':'bank';
    const op:Operation={id:newId(),date:`${project.period}-01`,type,description:text.trim(),amount:base,vatRate:rate,paymentMethod,sourceIds:[],confirmed:true,accountCode:type==='expense'?'601.01':undefined};
    return {kind:'operation',operation:op,message:`Propongo registrar ${type==='expense'?'un gasto':type==='sale'?'una venta/servicio':'una aportación'} con base sin IVA $${base}, IVA ${new Decimal(rate).mul(100).toString()}%, fecha ${op.date} y medio ${paymentMethod==='credit'?'crédito':paymentMethod==='cash'?'efectivo':'banco'}. Confirma o completa los datos en Operaciones. La deducibilidad fiscal sigue pendiente.`};
  }
  return {kind:'clarification',message:'Puedo ayudarte gratis a cambiar el periodo o método, guardar una nota y proponer un gasto, venta de servicio o aportación con importe e IVA explícitos. Para mercancías, cobros o pagos usa el formulario y relaciona la operación original. También puedes adjuntar el documento y confirmar sus datos.'};
}
export function applyChatProposal(project:Project,proposal:ChatProposal):Project {
  if(project.closed)throw new Error('Reabrir el proyecto con motivo antes de aplicar cambios.');
  if(proposal.kind==='clarification')return project;
  const revised=createRevision(project,`Chat: ${proposal.kind}`);
  return {...revised,...proposal.patch,operations:proposal.operation?[...revised.operations,proposal.operation]:revised.operations,notes:proposal.note?[...revised.notes,proposal.note]:revised.notes,updatedAt:new Date().toISOString()};
}

export function makeDemoProject(mode:Mode):Project {
  const p=createProject(mode,mode==='student'?'Práctica · Comercial del Pacífico':mode==='business'?'Comercial del Pacífico · Empresa':'Servicios profesionales · Persona física');
  p.rfc=mode==='student'?'':mode==='business'?'AAA010101AAA':'AAAA010101AAA';
  p.notes=['Proyecto de demostración con datos ficticios. Sustituye estos datos al crear tu contabilidad.'];
  p.taxConfig={coefficient:'.12',previousIsr:'0',priorTaxableIncome:'0',priorDeductions:'0',priorRetentions:'0',openingBalancesConfirmed:true,finalInventory:'',priorPeriodConfirmed:true,vatRetentions:'0',retentionsConfirmed:true};
  const opening:JournalEntry={id:'demo-opening',date:'2026-01-01',concept:'Asiento de apertura confirmado',kind:'opening',sourceIds:[],lines:[{id:'opening-bank',accountCode:'102.01',debit:'100000.00',credit:'0.00'},{id:'opening-stock',accountCode:'115.01',debit:mode==='individual'?'0.00':'10000.00',credit:'0.00'},{id:'opening-capital',accountCode:'301.01',debit:'0.00',credit:mode==='individual'?'100000.00':'110000.00'}]};
  p.manualEntries=[opening];
  const op=(id:string,type:Operation['type'],date:string,amount:string,paymentMethod:Operation['paymentMethod'],description:string,extra:Partial<Operation>={}):Operation=>({id,type,date,amount,vatRate:'.16',paymentMethod,description,sourceIds:[],confirmed:true,taxDeductible:true,...extra});
  if(mode!=='individual'){
    p.inventoryInitial=[{id:'opening-product',productId:'OMEGA',date:'2026-01-01',quantity:'100',unitCost:'100'}];
    p.operations=[op('demo-purchase','purchase','2026-01-03','6000','bank','Compra 50 unidades OMEGA a $120',{productId:'OMEGA',quantity:'50',unitCost:'120'}),op('demo-sale','sale','2026-01-08','16000','credit','Venta 80 unidades OMEGA a $200',{productId:'OMEGA',quantity:'80'}),op('demo-collection','collection','2026-01-12','16000','bank','Cobro de la venta del 8 de enero',{relatedOperationId:'demo-sale'}),op('demo-expense','expense','2026-01-16','2000','bank','Gasto administrativo confirmado')];
    p.bankTransactions=[{id:'bank-1',date:'2026-01-03',description:'Pago compra OMEGA',amount:'-6960',matchedOperationId:'demo-purchase'},{id:'bank-2',date:'2026-01-12',description:'Cobro cliente',amount:'18560',matchedOperationId:'demo-collection'},{id:'bank-3',date:'2026-01-16',description:'Pago gasto',amount:'-2320',matchedOperationId:'demo-expense'}];
  } else {
    p.operations=[op('demo-service','sale','2026-01-08','20000','bank','Servicio profesional cobrado'),op('demo-office','expense','2026-01-16','3000','bank','Gasto de oficina deducible confirmado')];
    p.bankTransactions=[{id:'bank-1',date:'2026-01-08',description:'Cobro servicio',amount:'23200',matchedOperationId:'demo-service'},{id:'bank-2',date:'2026-01-16',description:'Pago oficina',amount:'-3480',matchedOperationId:'demo-office'}];
  }
  p.chat=[{id:'welcome',role:'assistant',at:new Date().toISOString(),text:'Este ejemplo ya contiene apertura, operaciones y movimientos bancarios relacionados. Puedes revisar el diario, comparar PEPS con promedio o exportar el Excel. Cada cambio confirmado genera una revisión.'}];
  return p;
}
