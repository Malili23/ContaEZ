import Decimal from 'decimal.js';
import type { InventoryRow, Issue, JournalEntry, JournalLine, Operation, ProcessingResult, Project, TaxSummary, TrialBalanceRow } from './types';
import { calculateIndividualIsr, RULE_SET } from './rules';

Decimal.set({ precision: 32, rounding: Decimal.ROUND_HALF_UP });
const D = (value: Decimal.Value) => new Decimal(value);
const money = (value: Decimal.Value) => D(value).toDecimalPlaces(2).toFixed(2);
const cents = (value: Decimal.Value) => D(value).toDecimalPlaces(2);
const taxOn = (base: Decimal.Value, rate: Decimal.Value) => cents(D(base).mul(rate));
const qty = (value: Decimal.Value) => D(value).toDecimalPlaces(6).toString();
const sum = (values: Decimal.Value[]) => values.reduce<Decimal>((a,v)=>a.add(v),D(0));
const nonnegative = (v:string) => typeof v==='string' && /^(?:\d+(?:\.\d+)?|\.\d+)$/.test(v) && v===v.trim() && D(v).isFinite() && D(v).gte(0);
const moneyInput = (value: string) => nonnegative(value) && cents(value).eq(value);
const bankAmountValid = (value: string) => value===value.trim() && moneyInput(value.replace(/^-/,''));
const validDate = (date:string) => /^\d{4}-\d{2}-\d{2}$/.test(date)&&!Number.isNaN(Date.parse(date))&&new Date(`${date}T00:00:00Z`).toISOString().slice(0,10)===date;
const inPeriod = (date:string,period:string) => validDate(date)&&date.slice(0,7)===period;
interface Lot { id:string; quantity:Decimal; cost:Decimal; }
interface Allocation { lotId:string; quantity:Decimal; cost:Decimal; }
type EntryItem = [accountCode: string, debit: Decimal.Value, credit: Decimal.Value, sourceAmount?: JournalLine['sourceAmount']];

function issue(code:string,title:string,detail:string,suggestion:string, severity:Issue['severity']='error',operationId?:string): Issue {
  return {id:[code,operationId??'',detail].join(':'),code,title,detail,suggestion,severity,operationId};
}
function createEntry(op: Operation,items:EntryItem[],kind:JournalEntry['kind']='diary'):JournalEntry {
  const lines: JournalLine[] = [];
  for (const [accountCode, debit, credit, sourceAmount] of items) {
    if (cents(debit).isZero() && cents(credit).isZero()) continue;
    const item: JournalLine = {id: `${op.id}:${lines.length}`, accountCode, debit: money(debit), credit: money(credit)};
    if (sourceAmount) item.sourceAmount = sourceAmount;
    lines.push(item);
  }
  return {id:`op:${op.id}`,operationId:op.id,date:op.date,concept:op.description,kind,sourceIds:op.sourceIds??[],lines};
}

const PENDING_REVIEW_CODES = new Set(['OPERATION_PENDING','DOCUMENT_PENDING','ENTRY_SOURCE_PENDING','OPERATION_SOURCE_PENDING']);

function taxSummary(project:Project, entries:JournalEntry[], operations:Operation[], issues:Issue[]):TaxSummary {
  const notes = ['Papel de trabajo preliminar. Confirmar acreditamiento, deducibilidad, retenciones, acumulados y ajustes del contribuyente antes de presentar.'];
  const amounts=(code:string,side:'debit'|'credit')=>sum(entries.filter(e=>e.kind!=='opening').flatMap(e=>e.lines).filter(l=>l.accountCode===code).map(l=>l[side]));
  const collected=amounts('208.01','credit').minus(amounts('208.01','debit'));
  const paid=amounts('118.01','debit').minus(amounts('118.01','credit'));
  let currentRevenue=D(0), currentDeductions=D(0);
  for(const op of operations){
    const a=cents(op.amount);
    if(project.mode==='business') {
      if(op.type==='sale') currentRevenue=currentRevenue.add(a);
      if(op.type==='sale_return') currentRevenue=currentRevenue.minus(a);
    } else {
      if((op.type==='sale'&&op.paymentMethod!=='credit')||op.type==='collection') currentRevenue=currentRevenue.add(a);
      if(op.type==='sale_return'&&op.paymentMethod!=='credit') currentRevenue=currentRevenue.minus(a);
    }
    if(op.taxDeductible===true&&((['purchase','expense'].includes(op.type)&&op.paymentMethod!=='credit')||op.type==='payment'))currentDeductions=currentDeductions.add(a);
    if(op.taxDeductible===true&&op.type==='purchase_return'&&op.paymentMethod!=='credit') currentDeductions=currentDeductions.minus(a);
  }
  const result:TaxSummary={vatCollected:money(collected),vatPaid:money(paid),vatDue:money(collected.minus(paid)),taxableRevenue:money(currentRevenue),deductions:money(currentDeductions),isr:null,isrBase:null,status:'incomplete',notes};
  if(project.mode==='student') {notes.push('Modo académico: los impuestos se muestran para la práctica; no constituye determinación fiscal del contribuyente.');return result;}
  const t=project.taxConfig;
  if(t.retentionsConfirmed && nonnegative(t.vatRetentions??''))result.vatDue=money(collected.minus(paid).minus(t.vatRetentions!));
  else notes.push('Falta confirmar el IVA retenido al contribuyente (un cero confirmado es válido).');
  if(!t.openingBalancesConfirmed)notes.push('Falta confirmar saldos iniciales y continuidad del ejercicio.');
  const month=Number(project.period.slice(5,7)),year=Number(project.period.slice(0,4));
  if(year!==2026 || project.ruleSetId!==RULE_SET.id){notes.push('ISR automático disponible únicamente con el paquete fiscal 2026. Seleccionar el paquete correspondiente al ejercicio.');return result;}
  const priorKeys=['priorTaxableIncome','priorDeductions','priorRetentions','previousIsr'] as const;
  const priorValid=priorKeys.every(k=>nonnegative(t[k]??''));
  if(!priorValid){notes.push('Faltan acumulados fiscales anteriores y pagos provisionales/retenciones; capturar cero si realmente no existen.');return result;}
  if(month>1&&!t.priorPeriodConfirmed){notes.push('Confirmar que los acumulados anteriores cubren de enero al mes anterior.');return result;}
  if(issues.some(i=>PENDING_REVIEW_CODES.has(i.code)))notes.push('Quedan documentos, asientos u operaciones por confirmar antes de completar el papel de trabajo.');
  if(!t.retentionsConfirmed||!nonnegative(t.vatRetentions??'')||!t.openingBalancesConfirmed||issues.some(i=>i.severity==='error'||PENDING_REVIEW_CODES.has(i.code)))return result;
  if(operations.some(o=>['purchase','expense','payment','purchase_return'].includes(o.type)&&o.taxDeductible===undefined)){
    notes.push('Falta confirmar la deducibilidad de uno o más gastos/pagos.');return result;
  }
  const revenue=D(t.priorTaxableIncome).add(currentRevenue),deductions=D(t.priorDeductions).add(currentDeductions);
  let base:Decimal,gross:Decimal;
  if(project.mode==='business'){
    if(!nonnegative(t.coefficient)||D(t.coefficient).gt(1)){notes.push('Falta un coeficiente de utilidad válido (0 a 1), sustentado en el ejercicio correspondiente.');return result;}
    base=Decimal.max(0,revenue.mul(t.coefficient));gross=base.mul('.30');
    notes.push('Régimen general PM: ingresos nominales acumulados × coeficiente × 30%, menos pagos provisionales y retenciones capturados. Capturar PTU, pérdidas fiscales u otros ajustes mediante revisión profesional antes de utilizar el resultado.');
  } else {
    base=Decimal.max(0,revenue.minus(deductions));gross=D(calculateIndividualIsr(money(base),month));
    notes.push('PF actividad empresarial/profesional: utilidad fiscal acumulada y tarifa B.VI del Anexo 8 de 2026, menos pagos y retenciones anteriores capturados. No incluye RESICO.');
  }
  result.isrBase=money(base);result.isr=money(Decimal.max(0,gross.minus(t.previousIsr).minus(t.priorRetentions)));result.status='draft';
  return result;
}

export function processProject(project:Project):ProcessingResult {
  const issues:Issue[]=[],entries:JournalEntry[]=[],inventory:InventoryRow[]=[],committed:Operation[]=[];
  const accounts = new Map<string, Project['accounts'][number]>();
  for (const account of project.accounts) {
    if (accounts.has(account.code)) {
      issues.push(issue('DUPLICATE_ACCOUNT','Código repetido en el catálogo',account.code,'Conservar un solo registro por código para no duplicar sus saldos.'));
      continue;
    }
    accounts.set(account.code, account);
  }
  const firstDay=`${project.period}-01`;
  const validPeriod = validDate(firstDay);
  if(project.jurisdiction!=='MX'||project.currency!=='MXN')issues.push(issue('JURISDICTION','Jurisdicción no compatible','Este proyecto no está configurado para México y MXN.','Crear un proyecto mexicano compatible.'));
  if(!validPeriod)issues.push(issue('PERIOD','Periodo inválido',project.period,'Elegir año y mes.'));
  if(!project.operations.length&&!project.manualEntries.length)issues.push(issue('EMPTY','No hay operaciones para comprobar','Un reporte vacío no demuestra que una contabilidad esté completa.','Agregar apertura y operaciones o importar sus documentos.'));
  if(!project.taxConfig.openingBalancesConfirmed)issues.push(issue('OPENING_UNCONFIRMED','Saldos iniciales sin confirmar','Falta confirmar la apertura o que la entidad realmente inicia sin saldos.','Revisar y confirmar los saldos iniciales.','warning'));
  const sourceHashes=new Set<string>(),sourceUuids=new Set<string>();
  const documents = new Map<string, Project['documents'][number]>();
  for(const doc of project.documents){
    if (documents.has(doc.id)) issues.push(issue('DUPLICATE_DOCUMENT_ID','Identificador de documento repetido',doc.name,'Revisar a qué archivo corresponde este identificador.'));
    else documents.set(doc.id, doc);
    const uuid = doc.uuid?.trim().toUpperCase();
    if((doc.hash&&sourceHashes.has(doc.hash))||(uuid&&sourceUuids.has(uuid)))issues.push(issue('DUPLICATE_SOURCE','Documento duplicado',doc.name,'Relacionar los documentos con una misma operación; no registrarla dos veces.','warning'));
    if(doc.hash)sourceHashes.add(doc.hash);if(uuid)sourceUuids.add(uuid);
    if(doc.status==='pending')issues.push(issue('DOCUMENT_PENDING','Documento pendiente de confirmar',doc.name,'Confirmar sus datos extraídos antes de usarlos.','warning'));
  }
  const validateEntry=(entry:JournalEntry):boolean=>{
    let ok=true;
    const add=(code:string,title:string,detail:string,suggestion:string)=>{issues.push({...issue(code,title,detail,suggestion),location:entry.id});ok=false;};
    if(!validPeriod||!validDate(entry.date)||(entry.kind==='opening'?entry.date>firstDay:!inPeriod(entry.date,project.period)))add('ENTRY_PERIOD','Asiento fuera del periodo',`${entry.concept}: ${entry.date}`,'Corregir o confirmar el periodo del asiento.');
    if(entry.lines.length<2)add('ENTRY_LINES','Asiento incompleto',entry.concept,'Capturar al menos dos renglones que representen la operación.');
    for(const l of entry.lines){
      if(!accounts.has(l.accountCode))add('ACCOUNT_UNKNOWN','Cuenta inexistente',l.accountCode,'Agregar la cuenta al catálogo o corregir su código.');
      if(!moneyInput(l.debit)||!moneyInput(l.credit))add('ENTRY_AMOUNT','Importe inválido',`${l.accountCode}: ${l.debit} / ${l.credit}`,'Usar importes no negativos con precisión de centavos.');
      else if(D(l.debit).gt(0)&&D(l.credit).gt(0))add('ENTRY_BOTH','Cargo y abono en el mismo renglón',l.accountCode,'Separar el movimiento en sus renglones correctos.');
    }
    if(ok){const debit=sum(entry.lines.map(l=>l.debit)),credit=sum(entry.lines.map(l=>l.credit));if(!debit.eq(credit))add('UNBALANCED','Asiento descuadrado',`${entry.concept}: debe ${money(debit)}, haber ${money(credit)}`,'Corregir la operación y sus documentos; no agregar una cuenta de cuadre.');}
    return ok;
  };
  const entryIds=new Set<string>();
  for(const entry of project.manualEntries){
    if(entryIds.has(entry.id)){issues.push(issue('DUPLICATE_ENTRY','Identificador de asiento repetido',entry.id,'Eliminar el duplicado después de revisar su origen.'));continue;}
    entryIds.add(entry.id);
    if(entry.sourceIds.some(id=>!documents.has(id))){issues.push({...issue('ENTRY_SOURCE_MISSING','Falta un documento del asiento',entry.concept,'Recuperar su documento de origen o corregir la relación.'),location:entry.id});continue;}
    if(entry.sourceIds.some(id=>documents.get(id)?.status==='pending')){issues.push({...issue('ENTRY_SOURCE_PENDING','Asiento importado sin confirmar',entry.concept,'Confirmar los datos del documento de origen antes de registrar este asiento.','warning'),location:entry.id});continue;}
    if(validateEntry(entry))entries.push(structuredClone(entry));
  }

  let stock = new Map<string,Lot[]>();
  const pushLot=(productId:string,id:string,quantity:Decimal,cost:Decimal)=>{
    const lots=stock.get(productId)??[];
    if(project.valuation==='average'&&lots.length){const totalQty=sum(lots.map(l=>l.quantity)).add(quantity),value=sum(lots.map(l=>l.quantity.mul(l.cost))).add(quantity.mul(cost));stock.set(productId,[{id:`avg:${productId}`,quantity:totalQty,cost:totalQty.isZero()?D(0):value.div(totalQty)}]);}
    else {lots.push({id,quantity,cost});stock.set(productId,lots);}
  };
  const cloneStock=()=>new Map([...stock].map(([k,lots])=>[k,lots.map(l=>({...l,quantity:D(l.quantity),cost:D(l.cost)}))]));
  const stockQuantity=(id:string)=>sum((stock.get(id)??[]).map(l=>l.quantity));
  const stockValue=(id:string)=>sum((stock.get(id)??[]).map(l=>l.quantity.mul(l.cost)));
  const consume=(productId:string,quantity:Decimal,lotId?:string):Allocation[]=>{
    const lots=stock.get(productId)??[];
    const eligible=lotId&&project.valuation==='fifo'?lots.filter(l=>l.id===lotId):lots;
    if(sum(eligible.map(l=>l.quantity)).lt(quantity))throw new Error('No hay existencias suficientes con el origen y cantidades indicados.');
    let remain=quantity;const allocations:Allocation[]=[];
    for(const l of eligible){if(remain.lte(0))break;const used=Decimal.min(l.quantity,remain);if(used.gt(0)){allocations.push({lotId:l.id,quantity:used,cost:D(l.cost)});l.quantity=l.quantity.minus(used);remain=remain.minus(used);}}
    return allocations;
  };
  const lotIds = new Set<string>();
  for(const initial of [...project.inventoryInitial].sort((a,b)=>a.date.localeCompare(b.date))){
    if (lotIds.has(initial.id)) {
      issues.push(issue('DUPLICATE_LOT','Identificador de inventario repetido',initial.productId,'Revisar el lote repetido antes de contabilizar sus unidades.'));
      continue;
    }
    if(!validDate(initial.date)||!nonnegative(initial.quantity)||!nonnegative(initial.unitCost)||D(initial.quantity).isZero()){issues.push(issue('INITIAL_INVENTORY','Inventario inicial inválido',initial.productId,'Capturar una fecha real, cantidades positivas y costos no negativos.'));continue;}
    if(initial.date>firstDay){issues.push(issue('INITIAL_INVENTORY_DATE','Inventario inicial posterior al inicio',initial.date,'Separar las compras del mes del inventario inicial.'));continue;}
    lotIds.add(initial.id);
    pushLot(initial.productId,initial.id,D(initial.quantity),D(initial.unitCost));
    inventory.push({operationId:initial.id,productId:initial.productId,date:initial.date,description:'Inventario inicial',incoming:qty(initial.quantity),outgoing:'0',quantity:qty(stockQuantity(initial.productId)),unitCost:qty(initial.unitCost),cost:'0.00',balance:money(stockValue(initial.productId))});
  }
  const saleAllocations=new Map<string,Allocation[]>(),returnedQuantities=new Map<string,Decimal>(),returnedBases=new Map<string,Decimal>(),creditReturnedBases=new Map<string,Decimal>(),cashReturnedBases=new Map<string,Decimal>(),settledBases=new Map<string,Decimal>(),operationIds=new Set<string>(),invoiceIds=new Set<string>();
  const settledVat = new Map<string, Decimal>(), cashReturnedVat = new Map<string, Decimal>();
  const openingMovements = new Map<string, Decimal>();
  const registeredOps = new Map<string, Operation>();
  for(const op of [...project.operations].sort((a,b)=>a.date.localeCompare(b.date))){
    const fail=(code:string,title:string,detail:string,suggestion:string)=>issues.push(issue(code,title,detail,suggestion,'error',op.id));
    if(operationIds.has(op.id)){fail('DUPLICATE_OPERATION','Operación repetida',op.description,'Revisar el identificador y el documento de origen.');continue;}operationIds.add(op.id);
    if(!op.confirmed){issues.push(issue('OPERATION_PENDING','Operación pendiente de confirmar',op.description,'Confirmar sus datos antes de registrarla.','warning',op.id));continue;}
    if (op.sourceIds.some(id=>!documents.has(id))) {fail('OPERATION_SOURCE_MISSING','Falta un documento de la operación',op.description,'Recuperar su documento de origen o corregir la relación.');continue;}
    if (op.sourceIds.some(id=>documents.get(id)?.status==='pending')) {issues.push(issue('OPERATION_SOURCE_PENDING','Documento de la operación sin confirmar',op.description,'Confirmar el documento relacionado antes de registrar esta operación.','warning',op.id));continue;}
    const invoice = ['purchase','sale','expense'].includes(op.type) ? op.invoiceId?.trim().toUpperCase() : undefined;
    if (invoice && invoiceIds.has(invoice)) {fail('DUPLICATE_UUID','Comprobante ya registrado',invoice,'Relacionar los archivos con la operación existente.');continue;}
    if(!nonnegative(op.amount)||cents(op.amount).isZero()||!nonnegative(op.vatRate)||D(op.vatRate).gt(1)){fail('OPERATION_AMOUNT','Importe o tasa inválidos',op.description,'Capturar base sin IVA de al menos un centavo y tasa decimal entre 0 y 1.');continue;}
    if(op.referenceOnly){
      if(!validPeriod||!validDate(op.date)||op.date>=firstDay||!['purchase','sale','expense'].includes(op.type)||op.paymentMethod!=='credit'||!moneyInput(op.openingOutstandingBase??'')||D(op.openingOutstandingBase!).gt(cents(op.amount))) {
        fail('REFERENCE_OPENING','Documento anterior sin saldo confirmado',op.description,'Confirmar base pendiente al inicio, documento a crédito anterior y su relación con los saldos de apertura.');
      } else {
        registeredOps.set(op.id, op);
        if (invoice) invoiceIds.add(invoice);
      }
      continue;
    }
    if(!inPeriod(op.date,project.period)){fail('OPERATION_PERIOD','Operación fuera del periodo',`${op.description}: ${op.date}`,'Confirmar el mes o corregir la fecha.');continue;}
    if (lotIds.has(op.id)) {fail('INVENTORY_ID_CONFLICT','Identificador compartido con el inventario inicial',op.description,'Conservar identificadores distintos para cada operación y lote inicial.');continue;}
    if((op.productId&&!op.quantity)||(!op.productId&&op.quantity)){fail('PRODUCT_QUANTITY','Producto o cantidad faltante',op.description,'Capturar ambos datos para controlar inventario.');continue;}
    if(op.quantity&&(!nonnegative(op.quantity)||D(op.quantity).lte(0))){fail('QUANTITY','Cantidad inválida',op.quantity,'Usar una cantidad positiva.');continue;}
    const beforeStock=cloneStock(),rowCount=inventory.length;
    try {
      const base=cents(op.amount), initialVat=taxOn(base,op.vatRate),total=base.add(initialVat),cash=op.paymentMethod==='cash'?'101.01':'102.01',credit=op.paymentMethod==='credit';
      let entry:JournalEntry;
      let saleRestoration:{originalId:string;items:Allocation[]}|undefined;
      let movedVat = initialVat;
      let appliedToOpening: [string, Decimal][] = [];
      if(op.type==='purchase'){
        const inventoryAccount=project.inventorySystem==='analytical'?'502.01':'115.01';
        if(op.productId&&op.quantity){
          const q=D(op.quantity),unit=base.div(q);
          if(op.unitCost&&D(op.unitCost).mul(q).minus(base).abs().gt('.01'))throw new Error('Cantidad × costo unitario no coincide con la base de la compra.');
          pushLot(op.productId,op.id,q,unit);
          inventory.push({operationId:op.id,productId:op.productId,date:op.date,description:op.description,incoming:qty(q),outgoing:'0',quantity:qty(stockQuantity(op.productId)),unitCost:qty(unit),cost:money(base),balance:money(stockValue(op.productId))});
        }
        entry=createEntry(op,[[inventoryAccount,base,0,'base'],[credit?'119.01':'118.01',initialVat,0,'vat'],[credit?(op.counterpartyCode||'201.01'):cash,0,total,'gross']],credit?'diary':'expense');
      } else if(op.type==='sale'){
        const lines:EntryItem[]=[[credit?(op.counterpartyCode||'105.01'):cash,total,0,'gross'],['401.01',0,base,'base'],[credit?'209.01':'208.01',0,initialVat,'vat']];
        if(op.productId&&op.quantity){const q=D(op.quantity),allocations=consume(op.productId,q),cost=sum(allocations.map(a=>a.quantity.mul(a.cost))).toDecimalPlaces(2);saleAllocations.set(op.id,allocations);
          if(project.inventorySystem==='perpetual')lines.push(['501.01',cost,0,'inventory'],['115.01',0,cost,'inventory']);
          inventory.push({operationId:op.id,productId:op.productId,date:op.date,description:op.description,incoming:'0',outgoing:qty(q),quantity:qty(stockQuantity(op.productId)),unitCost:qty(cost.div(q)),cost:money(cost),balance:money(stockValue(op.productId))});}
        entry=createEntry(op,lines,credit?'diary':'income');
      } else if(op.type==='collection'||op.type==='payment'){
        const original=op.relatedOperationId?registeredOps.get(op.relatedOperationId):undefined;
        const collecting=op.type==='collection';
        if(credit)throw new Error('Un cobro o pago necesita caja o banco como medio de liquidación.');
        if(!original||original.paymentMethod!=='credit'||(collecting?original.type!=='sale':!['purchase','expense'].includes(original.type)))throw new Error('Relacionar este cobro/pago con la venta, compra o gasto a crédito original.');
        const previous=original.referenceOnly===true;
        if(previous&&!project.taxConfig.openingBalancesConfirmed)throw new Error('La operación a crédito relacionada carece de un saldo de apertura confirmado.');
        if(!D(op.vatRate).eq(original.vatRate))throw new Error('La tasa de IVA del cobro/pago no coincide con la operación original.');
        const settled=settledBases.get(original.id)??D(0),returned=creditReturnedBases.get(original.id)??D(0);
        const allocatedBase=settled.add(returned);
        if(allocatedBase.add(base).gt(previous?original.openingOutstandingBase!:cents(original.amount)))throw new Error('El cobro/pago supera la base pendiente de la operación relacionada.');
        // Move only the rounded difference so several partial payments allocate the same VAT as one full payment.
        movedVat=taxOn(allocatedBase.add(base),op.vatRate).minus(taxOn(allocatedBase,op.vatRate));
        const paidTotal=base.add(movedVat);
        const counter=original.counterpartyCode||(collecting?'105.01':'201.01');
        const pendingVatAccount=collecting?'209.01':'119.01';
        if(previous){
          const openingLines=entries.filter(e=>e.kind==='opening').flatMap(e=>e.lines);
          appliedToOpening=[[counter,paidTotal],[pendingVatAccount,movedVat]];
          for (const [accountCode, amount] of appliedToOpening) {
            const isDebit = accountCode===counter ? collecting : !collecting;
            const outstanding=sum(openingLines.filter(l=>l.accountCode===accountCode).map(l=>isDebit?D(l.debit).minus(l.credit):D(l.credit).minus(l.debit)));
            if ((openingMovements.get(accountCode)??D(0)).add(amount).gt(outstanding)) throw new Error('El saldo de apertura de la cuenta o del IVA pendiente no respalda este cobro o pago.');
          }
        }
        entry=collecting?createEntry(op,[[cash,paidTotal,0],[counter,0,paidTotal],['209.01',movedVat,0],['208.01',0,movedVat]],'income'):createEntry(op,[[counter,paidTotal,0],[cash,0,paidTotal],['118.01',movedVat,0],['119.01',0,movedVat]],'expense');
      } else if(op.type==='purchase_return'||op.type==='sale_return'){
        const original=op.relatedOperationId?registeredOps.get(op.relatedOperationId):undefined;
        const saleReturn=op.type==='sale_return';
        if(!original||original.referenceOnly||original.type!==(saleReturn?'sale':'purchase'))throw new Error('Relacionar la devolución con su compra o venta original registrada.');
        if(!D(op.vatRate).eq(original.vatRate))throw new Error('La tasa de la devolución debe coincidir con el comprobante original.');
        const originalBase=cents(original.amount);
        const returned=returnedBases.get(original.id)??D(0),settled=settledBases.get(original.id)??D(0),creditReturned=creditReturnedBases.get(original.id)??D(0),cashReturned=cashReturnedBases.get(original.id)??D(0);
        if(returned.add(base).gt(originalBase))throw new Error('La devolución supera la base de la operación original.');
        if(credit && (original.paymentMethod!=='credit'||creditReturned.add(base).add(settled).gt(originalBase)))throw new Error('La devolución a crédito supera el saldo pendiente; confirmar la forma de reembolso.');
        if(!credit&&original.paymentMethod==='credit'&&settled.lt(cashReturned.add(base)))throw new Error('No hay un pago/cobro suficiente para justificar el reembolso en efectivo; confirmar si corresponde reducir la cuenta pendiente.');
        if (credit) {
          const allocatedBase=settled.add(creditReturned);
          movedVat=taxOn(allocatedBase.add(base),op.vatRate).minus(taxOn(allocatedBase,op.vatRate));
        } else {
          const paidBase=original.paymentMethod==='credit'?settled:originalBase;
          const paidVat=original.paymentMethod==='credit'?(settledVat.get(original.id)??D(0)):taxOn(originalBase,op.vatRate);
          const refundBase=cashReturned.add(base);
          const previousRefundVat=cashReturnedVat.get(original.id)??D(0);
          const refundVat=refundBase.eq(paidBase)?paidVat:Decimal.min(paidVat,taxOn(refundBase,op.vatRate));
          movedVat=Decimal.max(0,refundVat.minus(previousRefundVat));
        }
        const refundTotal=base.add(movedVat);
        const lines:EntryItem[]=saleReturn?[
          ['402.01',base,0],[credit?'209.01':'208.01',movedVat,0],[credit?(original.counterpartyCode||'105.01'):cash,0,refundTotal]
        ]:[
          [credit?(original.counterpartyCode||'201.01'):cash,refundTotal,0],[project.inventorySystem==='analytical'?'504.01':'115.01',0,base],[credit?'119.01':'118.01',0,movedVat]
        ];
        if(original.productId&&original.quantity){
          if(op.productId!==original.productId||!op.quantity)throw new Error('Identificar el producto y la cantidad devuelta.');
          const q=D(op.quantity),oldReturned=returnedQuantities.get(original.id)??D(0);
          if(oldReturned.add(q).gt(original.quantity))throw new Error('La cantidad devuelta excede la operación original.');
          const expectedBase=cents(originalBase.mul(oldReturned.add(q)).div(original.quantity)).minus(cents(originalBase.mul(oldReturned).div(original.quantity)));
          if(!base.eq(expectedBase))throw new Error('La base de la devolución no coincide con su cantidad y precio originales.');
          let cost:Decimal;
          if(saleReturn){
            const allocations=saleAllocations.get(original.id)??[];
            const costs=new Set(allocations.map(a=>a.cost.toString()));
            if(costs.size>1&&!op.unitCost&&!q.eq(D(original.quantity).minus(oldReturned)))throw new Error('La venta consumió capas con costos distintos. Confirmar el costo de las unidades devueltas.');
            let remain=q;const restored:Allocation[]=[];
            for(const a of allocations){if(remain.lte(0))break;if(op.unitCost&&!a.cost.eq(op.unitCost))continue;const used=Decimal.min(a.quantity,remain);if(used.gt(0)){restored.push({lotId:a.lotId,quantity:used,cost:a.cost});remain=remain.minus(used);}}
            if(remain.gt(0))throw new Error('El costo confirmado no corresponde a suficientes unidades de la venta original.');
            cost=sum(restored.map(a=>a.quantity.mul(a.cost))).toDecimalPlaces(2);
            saleRestoration={originalId:original.id,items:restored};
            for(const a of restored){
              const originalLot=project.valuation==='fifo'?(stock.get(op.productId)??[]).find(l=>l.id===a.lotId&&l.cost.eq(a.cost)):undefined;
              if(originalLot)originalLot.quantity=originalLot.quantity.add(a.quantity);else pushLot(op.productId,a.lotId,a.quantity,a.cost);
            }
            if(project.inventorySystem==='perpetual')lines.push(['115.01',cost,0,'inventory'],['501.01',0,cost,'inventory']);
          } else {
            cost=base;
            consume(op.productId,q,original.id);
            if(project.valuation==='average'){
              // A return to the supplier reverses its original purchase cost, not the current average.
              const lots=stock.get(op.productId)??[],remaining=stockQuantity(op.productId),beforeValue=sum((beforeStock.get(op.productId)??[]).map(l=>l.quantity.mul(l.cost)));
              if(beforeValue.lt(cost))throw new Error('La devolución excede el valor disponible del inventario.');
              if(remaining.gt(0))stock.set(op.productId,[{id:`avg:${op.productId}`,quantity:remaining,cost:beforeValue.minus(cost).div(remaining)}]);else if(!beforeValue.eq(cost))throw new Error('La devolución deja un valor sin unidades; requiere ajuste confirmado.');else stock.set(op.productId,[]);
              void lots;
            }
          }
          inventory.push({operationId:op.id,productId:op.productId,date:op.date,description:op.description,incoming:saleReturn?qty(q):'0',outgoing:saleReturn?'0':qty(q),quantity:qty(stockQuantity(op.productId)),unitCost:qty(cost.div(q)),cost:money(cost),balance:money(stockValue(op.productId))});
        }
        entry=createEntry(op,lines,saleReturn?(credit?'diary':'expense'):(credit?'diary':'income'));
      } else if(op.type==='expense'){
        const expenseAccount=op.accountCode||'601.01';
        if(expenseAccount==='115.01')throw new Error('La capitalización de fletes requiere confirmar el reparto entre existencias y costo vendido; registrar un ajuste respaldado.');
        entry=createEntry(op,[[expenseAccount,base,0,'base'],[credit?'119.01':'118.01',initialVat,0,'vat'],[credit?(op.counterpartyCode||'201.01'):cash,0,total,'gross']],credit?'diary':'expense');
      } else if(op.type==='contribution'){
        if(credit||!D(op.vatRate).isZero())throw new Error('El registro automático de capital requiere efectivo o banco y tasa cero.');
        entry=createEntry(op,[[cash,base,0,'base'],['301.01',0,base,'base']],'income');
      } else {throw new Error('El ajuste requiere un asiento manual respaldado con sus cargos y abonos.');}
      if (entryIds.has(entry.id)) throw new Error('El asiento automático comparte identificador con otro asiento. Revisar sus orígenes.');
      if(!validateEntry(entry)){stock=beforeStock;inventory.splice(rowCount);continue;}
      entryIds.add(entry.id);
      entries.push(entry);committed.push(op);
      registeredOps.set(op.id,op);
      if(saleRestoration){
        const remaining=saleAllocations.get(saleRestoration.originalId)??[];
        for(const restored of saleRestoration.items){let pending=restored.quantity;for(const a of remaining){if(a.lotId!==restored.lotId||!a.cost.eq(restored.cost)||pending.lte(0))continue;const used=Decimal.min(a.quantity,pending);a.quantity=a.quantity.minus(used);pending=pending.minus(used);}}
      }
      if(invoice)invoiceIds.add(invoice);
      for (const [accountCode, amount] of appliedToOpening) openingMovements.set(accountCode,(openingMovements.get(accountCode)??D(0)).add(amount));
      if(['collection','payment'].includes(op.type)&&op.relatedOperationId){
        settledBases.set(op.relatedOperationId,(settledBases.get(op.relatedOperationId)??D(0)).add(base));
        settledVat.set(op.relatedOperationId,(settledVat.get(op.relatedOperationId)??D(0)).add(movedVat));
      }
      if(['purchase_return','sale_return'].includes(op.type)&&op.relatedOperationId){
        returnedBases.set(op.relatedOperationId,(returnedBases.get(op.relatedOperationId)??D(0)).add(base));
        const byMethod=credit?creditReturnedBases:cashReturnedBases;byMethod.set(op.relatedOperationId,(byMethod.get(op.relatedOperationId)??D(0)).add(base));
        if(!credit)cashReturnedVat.set(op.relatedOperationId,(cashReturnedVat.get(op.relatedOperationId)??D(0)).add(movedVat));
        if(op.quantity)returnedQuantities.set(op.relatedOperationId,(returnedQuantities.get(op.relatedOperationId)??D(0)).add(op.quantity));
      }
    } catch(error){stock=beforeStock;inventory.splice(rowCount);fail('OPERATION_INCOMPLETE','No se registró una operación',`${op.description}: ${error instanceof Error?error.message:String(error)}`,'Aclarar el dato señalado o capturar un asiento manual respaldado.');}
  }

  if(validPeriod&&project.inventorySystem==='analytical'){
    const purchases=sum(entries.flatMap(e=>e.lines).filter(l=>l.accountCode==='502.01'||l.accountCode==='503.01').map(l=>D(l.debit).minus(l.credit))).minus(sum(entries.flatMap(e=>e.lines).filter(l=>l.accountCode==='504.01').map(l=>D(l.credit).minus(l.debit))));
    const opening=sum(entries.filter(e=>e.kind==='opening').flatMap(e=>e.lines).filter(l=>l.accountCode==='115.01').map(l=>D(l.debit).minus(l.credit)));
    if(!moneyInput(project.taxConfig.finalInventory))issues.push(issue('FINAL_INVENTORY','Inventario final pendiente','El método analítico requiere inventario final confirmado para determinar el costo del periodo.','Capturar su valuación en centavos o confirmar un inventario final de cero.'));
    else {
      const closing=D(project.taxConfig.finalInventory),cogs=opening.add(purchases).minus(closing);
      if(cogs.lt(0))issues.push(issue('ANALYTIC_COST','Costo de ventas negativo','El inventario final supera apertura más compras netas.','Revisar el inventario físico, su valuación y las compras.'));
      else if(!opening.isZero()||!purchases.isZero()||!closing.isZero()){
        const changeInStock=closing.minus(opening);
        const items:EntryItem[]=[['501.01',cogs,0],['115.01',Decimal.max(0,changeInStock),Decimal.max(0,changeInStock.neg())]];
        for(const code of ['502.01','503.01','504.01']){const n=sum(entries.flatMap(e=>e.lines).filter(l=>l.accountCode===code).map(l=>D(l.debit).minus(l.credit)));if(n.gt(0))items.push([code,0,n]);else if(n.lt(0))items.push([code,n.neg(),0]);}
        const end=new Date(`${firstDay}T00:00:00Z`);
        end.setUTCMonth(end.getUTCMonth()+1,0);
        const last=end.toISOString().slice(0,10);
        const fake:Operation={id:`analytical:${project.period}`,date:last,type:'adjustment',description:'Determinación de costo de ventas e inventario final (analítico)',amount:'0',vatRate:'0',paymentMethod:'bank',sourceIds:[],confirmed:true};
        const entry=createEntry(fake,items,'adjustment');
        if(entryIds.has(entry.id)) issues.push(issue('DUPLICATE_ENTRY','Identificador de asiento repetido',entry.id,'Revisar el asiento de ajuste y el generado al determinar el costo.'));
        else if(entry.lines.length&&validateEntry(entry)){entryIds.add(entry.id);entries.push(entry);}
      }
    }
  }

  for(const asset of validPeriod?project.assets:[]){
    if(!validDate(asset.startDate)||!moneyInput(asset.cost)||!moneyInput(asset.residual)||D(asset.cost).lt(asset.residual)||!Number.isSafeInteger(asset.usefulLifeMonths)||asset.usefulLifeMonths<=0){issues.push(issue('ASSET_INPUT','Activo con datos incompletos',asset.name,'Capturar una fecha real, costo y valor residual en centavos, y vida útil en meses completos.'));continue;}
    const start=asset.startDate.slice(0,7),offset=(Number(project.period.slice(0,4))-Number(start.slice(0,4)))*12+Number(project.period.slice(5,7))-Number(start.slice(5,7));
    if(offset<0||offset>=asset.usefulLifeMonths)continue;
    const monthly=D(asset.cost).minus(asset.residual).div(asset.usefulLifeMonths);
    const charge=cents(monthly.mul(offset+1)).minus(cents(monthly.mul(offset)));
    const fake:Operation={id:`asset:${asset.id}:${project.period}`,date:firstDay,type:'adjustment',description:`${asset.type==='amortization'?'Amortización':'Depreciación'}: ${asset.name}`,amount:charge.toString(),vatRate:'0',paymentMethod:'bank',sourceIds:[],confirmed:true};
    const entry=createEntry(fake,[[asset.expenseAccountCode||'603.01',charge,0],[asset.type==='amortization'?'179.01':'159.01',0,charge]],'adjustment');
    if(entryIds.has(entry.id))issues.push(issue('DUPLICATE_ASSET','Identificador de depreciación repetido',asset.name,'Revisar los activos repetidos antes de registrar el cargo.'));
    else{
      entryIds.add(entry.id);
      if(entry.lines.length&&validateEntry(entry))entries.push(entry);
    }
    issues.push(issue('ASSET_POLICY','Revisar política de depreciación/amortización',`${asset.name}: línea recta por mes completo desde el mes de inicio; cargo contable ${money(charge)}.`,'Confirmar fecha disponible para uso, vida útil y política; el cálculo fiscal se revisa por separado.','info'));
  }

  const trialBalance:TrialBalanceRow[]=[...accounts.values()].map(account=>{
    const selected=entries.flatMap(e=>e.lines.filter(l=>l.accountCode===account.code).map(l=>({...l,opening:e.kind==='opening'})));
    const openingDebit=sum(selected.filter(l=>l.opening).map(l=>l.debit)),openingCredit=sum(selected.filter(l=>l.opening).map(l=>l.credit)),debit=sum(selected.filter(l=>!l.opening).map(l=>l.debit)),credit=sum(selected.filter(l=>!l.opening).map(l=>l.credit)),net=openingDebit.add(debit).minus(openingCredit).minus(credit);
    return {account,openingDebit:money(openingDebit),openingCredit:money(openingCredit),debit:money(debit),credit:money(credit),balanceDebit:money(Decimal.max(0,net)),balanceCredit:money(Decimal.max(0,net.neg()))};
  });
  const netBy=(type:string)=>sum(trialBalance.filter(r=>r.account.type===type).map(r=>D(r.balanceDebit).minus(r.balanceCredit)));
  const revenue=netBy('income').neg(),costs=netBy('cost'),expenses=netBy('expense'),profit=revenue.minus(costs).minus(expenses),assets=netBy('asset'),liabilities=netBy('liability').neg(),equity=netBy('equity').neg(),difference=assets.minus(liabilities).minus(equity).minus(profit);
  if(!difference.isZero())issues.push(issue('BALANCE_DIFFERENCE','Diferencia en balance',money(difference),'Revisar asientos omitidos y clasificación de las cuentas.'));
  for(const r of trialBalance){const contrary=r.account.nature==='debit'?D(r.balanceCredit).gt(0):D(r.balanceDebit).gt(0);if(contrary)issues.push(issue('CONTRARY_BALANCE','Saldo contrario a la naturaleza habitual',`${r.account.code} ${r.account.name}`,'Revisar el soporte; puede corresponder a un anticipo o ajuste válido. No se corrige automáticamente.','warning'));}
  if(project.inventorySystem==='perpetual'&&inventory.length){const expected=sum([...stock.keys()].map(k=>stockValue(k))),ledger=sum(trialBalance.filter(r=>r.account.code==='115.01').map(r=>D(r.balanceDebit).minus(r.balanceCredit)));if(expected.toDecimalPlaces(2).minus(ledger).abs().gt('.01'))issues.push(issue('INVENTORY_LEDGER','Inventario auxiliar y mayor no coinciden',`Auxiliar ${money(expected)}, mayor ${money(ledger)}.`,'Relacionar el inventario inicial con la apertura y revisar compras, ventas y ajustes.'));}
  const ledgerBalance=sum(trialBalance.filter(r=>r.account.code==='102.01').map(r=>D(r.balanceDebit).minus(r.balanceCredit)));
  const initialBank=sum(entries.filter(e=>e.kind==='opening').flatMap(e=>e.lines).filter(l=>l.accountCode==='102.01').map(l=>D(l.debit).minus(l.credit)));
  const bankIds=new Set<string>();
  const statements=project.bankTransactions.filter(t=>{
    if (!inPeriod(t.date,project.period)) {
      issues.push(issue('BANK_PERIOD','Movimiento bancario fuera del periodo',`${t.date}: ${t.description}`,'Revisar el mes del extracto y recuperar la fecha correcta.'));
      return false;
    }
    if (!bankAmountValid(t.amount)) {
      issues.push(issue('BANK_AMOUNT','Importe bancario inválido',t.description,'Confirmar el importe con signo y precisión de centavos.'));
      return false;
    }
    if (bankIds.has(t.id)) {
      issues.push(issue('DUPLICATE_BANK','Identificador de movimiento bancario repetido',t.description,'Revisar el extracto para evitar duplicar sus movimientos.'));
      return false;
    }
    bankIds.add(t.id);
    return true;
  });
  const statementBalance=initialBank.add(sum(statements.map(t=>t.amount))),unmatchedCount=statements.filter(t=>!t.matchedOperationId||!registeredOps.has(t.matchedOperationId)||registeredOps.get(t.matchedOperationId)?.referenceOnly).length;
  if(!statements.length&&ledgerBalance.minus(initialBank).abs().gt(0))issues.push(issue('BANK_STATEMENT','Falta estado de cuenta','Hay movimientos en bancos sin extracto importado.','Importar el estado de cuenta para comprobar la conciliación.','warning'));
  if(unmatchedCount)issues.push(issue('BANK_UNMATCHED','Movimientos bancarios sin relacionar',`${unmatchedCount} movimientos requieren relación con sus operaciones.`,'Revisar coincidencias, fechas, comisiones y partidas en tránsito.','warning'));
  if(statements.length&&!ledgerBalance.eq(statementBalance))issues.push(issue('BANK_DIFFERENCE','Diferencia en conciliación bancaria',`Mayor ${money(ledgerBalance)}, extracto calculado ${money(statementBalance)}.`,'Revisar partidas en tránsito, comisiones, movimientos omitidos y fechas.','warning'));
  const bankMatches=new Map<string,Decimal>();
  for(const t of statements){if(t.matchedOperationId)bankMatches.set(t.matchedOperationId,(bankMatches.get(t.matchedOperationId)??D(0)).add(t.amount));}
  for(const [operationId,bankAmount] of bankMatches){const ledgerAmount=sum(entries.filter(e=>e.operationId===operationId).flatMap(e=>e.lines).filter(l=>l.accountCode==='102.01').map(l=>D(l.debit).minus(l.credit)));if(!bankAmount.eq(ledgerAmount))issues.push(issue('BANK_MATCH_MISMATCH','Relación bancaria con importe diferente',`Movimiento relacionado ${money(bankAmount)}, asiento ${money(ledgerAmount)}.`,'Corregir la relación del movimiento o confirmar el pago parcial; relacionar por identificador no comprueba el importe.','warning',operationId));}
  if(!entries.length&&!issues.some(i=>i.code==='EMPTY'))issues.push(issue('NO_POSTED_ENTRIES','Todavía no hay asientos registrados','Las fuentes y propuestas pendientes no se han incorporado al cálculo.','Confirmar datos válidos y resolver las operaciones excluidas.'));
  const taxes=taxSummary(project,entries,committed,issues);
  return {entries,trialBalance,inventory,issues,incomeStatement:{revenue:money(revenue),costOfSales:money(costs),expenses:money(expenses),profit:money(profit)},balanceSheet:{assets:money(assets),liabilities:money(liabilities),equity:money(equity),profit:money(profit),difference:money(difference)},taxes,bankReconciliation:{ledgerBalance:money(ledgerBalance),statementBalance:money(statementBalance),difference:money(ledgerBalance.minus(statementBalance)),unmatchedCount}};
}
