import { describe, expect, it } from 'vitest';
import { applyChatProposal, calculateIndividualIsr, closeProject, createProject, createRevision, getIsrBrackets, makeDemoProject, parseProject, processProject, proposeChat, restoreRevision } from '../src/core';
import type { Operation, Project } from '../src/core';

function operation(id:string,type:Operation['type'],amount:string,extra:Partial<Operation>={}):Operation {return {id,type,amount,date:'2026-01-20',description:id,vatRate:'.16',paymentMethod:'bank',sourceIds:[],confirmed:true,taxDeductible:true,...extra};}
function errors(p:Project){return processProject(p).issues.filter(i=>i.severity==='error');}

describe('Contabilidad compartida por las tres modalidades',()=>{
  it('un libro vacío no obtiene una revisión saludable por cuadrar cero con cero',()=>{
    const result=processProject(createProject('student'));
    expect(result.balanceSheet.difference).toBe('0.00');
    expect(result.issues.some(i=>i.code==='EMPTY')).toBe(true);
  });
  it('la práctica PEPS cuadra y concilia contra controles calculados independientemente',()=>{
    const p=makeDemoProject('student'),r=processProject(p);
    expect(errors(p)).toEqual([]);
    expect(r.incomeStatement).toEqual({revenue:'16000.00',costOfSales:'8000.00',expenses:'2000.00',profit:'6000.00'});
    expect(r.inventory.at(-1)?.quantity).toBe('70');
    expect(r.inventory.at(-1)?.balance).toBe('8000.00');
    expect(r.bankReconciliation.ledgerBalance).toBe('109280.00');
    expect(r.bankReconciliation.difference).toBe('0.00');
    expect(r.balanceSheet.difference).toBe('0.00');
  });
  it('promedio móvil cambia costo y utilidad sin alterar cantidades ni efectivo',()=>{
    const p=makeDemoProject('student');p.valuation='average';const r=processProject(p);
    expect(errors(p)).toEqual([]);
    expect(r.incomeStatement.costOfSales).toBe('8533.33');
    expect(r.incomeStatement.profit).toBe('5466.67');
    expect(r.inventory.at(-1)?.balance).toBe('7466.67');
    expect(r.inventory.at(-1)?.quantity).toBe('70');
    expect(r.bankReconciliation.difference).toBe('0.00');
  });
  it('no inventa existencias ni registra una venta sin unidades disponibles',()=>{
    const p=makeDemoProject('student');p.operations.push(operation('oversell','sale','100000',{productId:'OMEGA',quantity:'1000'}));
    const r=processProject(p);
    expect(r.issues.some(i=>i.operationId==='oversell'&&i.severity==='error')).toBe(true);
    expect(r.entries.some(e=>e.operationId==='oversell')).toBe(false);
    expect(r.inventory.at(-1)?.quantity).toBe('70');
  });
  it('el cobro parcial mueve únicamente su IVA y un sobrecobro no se registra',()=>{
    const p=makeDemoProject('business');p.operations=p.operations.filter(o=>o.id!=='demo-collection');
    p.operations.push(operation('partial','collection','8000',{relatedOperationId:'demo-sale'}));
    let r=processProject(p);
    expect(r.taxes.vatCollected).toBe('1280.00');
    const pending=r.trialBalance.find(t=>t.account.code==='209.01');
    expect(pending?.balanceCredit).toBe('1280.00');
    p.operations.push(operation('too-much','collection','9000',{relatedOperationId:'demo-sale'}));
    r=processProject(p);
    expect(r.entries.some(e=>e.operationId==='too-much')).toBe(false);
    expect(r.taxes.vatCollected).toBe('1280.00');
  });
  it('devolver una venta conserva su costo original y devuelve el IVA correspondiente',()=>{
    const p=makeDemoProject('student');p.operations.push(operation('sale-return','sale_return','4000',{productId:'OMEGA',quantity:'20',relatedOperationId:'demo-sale'}));
    const r=processProject(p);
    expect(errors(p)).toEqual([]);
    expect(r.incomeStatement).toEqual({revenue:'12000.00',costOfSales:'6000.00',expenses:'2000.00',profit:'4000.00'});
    expect(r.inventory.at(-1)?.quantity).toBe('90');
    expect(r.inventory.at(-1)?.cost).toBe('2000.00');
    expect(r.taxes.vatCollected).toBe('1920.00');
  });
  it('analítico requiere inventario final y produce el mismo costo con un cierre confirmado',()=>{
    const p=makeDemoProject('student');p.inventorySystem='analytical';
    expect(processProject(p).issues.some(i=>i.code==='FINAL_INVENTORY')).toBe(true);
    p.taxConfig.finalInventory='8000';const r=processProject(p);
    expect(errors(p)).toEqual([]);
    expect(r.incomeStatement.costOfSales).toBe('8000.00');
    expect(r.balanceSheet.difference).toBe('0.00');
    expect(r.trialBalance.find(a=>a.account.code==='502.01')?.balanceDebit).toBe('0.00');
  });
  it('omitir una cuenta o descuadrar una apertura bloquea su registro',()=>{
    const p=makeDemoProject('business');p.manualEntries[0].lines[0].accountCode='NO-EXISTE';
    expect(errors(p).some(i=>i.code==='ACCOUNT_UNKNOWN')).toBe(true);
    p.manualEntries[0].lines[0].accountCode='102.01';p.manualEntries[0].lines[0].debit='100001';
    expect(errors(p).some(i=>i.code==='UNBALANCED')).toBe(true);
  });
  it('una factura repetida no duplica ventas aunque los identificadores de operación difieran',()=>{
    const p=makeDemoProject('individual');p.operations[0].invoiceId='AAAA-1111';p.operations.push({...p.operations[0],id:'duplicate'});
    const r=processProject(p);
    expect(r.incomeStatement.revenue).toBe('20000.00');
    expect(r.issues.some(i=>i.code==='DUPLICATE_UUID')).toBe(true);
  });
  it('puede cobrar un comprobante anterior sin volver a reconocer su venta',()=>{
    const p=createProject('individual');p.taxConfig={...makeDemoProject('individual').taxConfig};
    p.manualEntries=[{id:'opening',date:'2025-12-31',concept:'Saldo de factura pendiente',kind:'opening',sourceIds:[],lines:[{id:'a',accountCode:'105.01',debit:'1160',credit:'0'},{id:'b',accountCode:'209.01',debit:'0',credit:'160'},{id:'c',accountCode:'301.01',debit:'0',credit:'1000'}]}];
    p.operations=[operation('old-sale','sale','1000',{date:'2025-12-15',paymentMethod:'credit',referenceOnly:true,openingOutstandingBase:'1000'}),operation('collection','collection','1000',{relatedOperationId:'old-sale'})];
    const r=processProject(p);
    expect(errors(p)).toEqual([]);expect(r.entries.some(e=>e.operationId==='old-sale')).toBe(false);
    expect(r.incomeStatement.revenue).toBe('0.00');expect(r.taxes.taxableRevenue).toBe('1000.00');expect(r.taxes.vatCollected).toBe('160.00');
    expect(r.trialBalance.find(t=>t.account.code==='105.01')?.balanceDebit).toBe('0.00');
  });
  it('la devolución en efectivo no consume otra vez el saldo que sigue pendiente a crédito',()=>{
    const p=createProject('individual');p.taxConfig={...makeDemoProject('individual').taxConfig};
    p.operations=[operation('sale','sale','100',{date:'2026-01-02',paymentMethod:'credit'}),operation('collect','collection','40',{date:'2026-01-03',relatedOperationId:'sale'}),operation('cash-return','sale_return','20',{date:'2026-01-04',relatedOperationId:'sale'}),operation('credit-return','sale_return','60',{date:'2026-01-05',relatedOperationId:'sale',paymentMethod:'credit'})];
    const r=processProject(p);expect(errors(p)).toEqual([]);
    expect(r.trialBalance.find(a=>a.account.code==='105.01')?.balanceDebit).toBe('0.00');
    expect(r.incomeStatement.revenue).toBe('20.00');
    expect(r.taxes.taxableRevenue).toBe('20.00');
  });
  it('varios reembolsos no pueden superar el cobro realizado de una venta a crédito',()=>{
    const p=createProject('individual');p.taxConfig={...makeDemoProject('individual').taxConfig};
    p.operations=[operation('sale','sale','100',{date:'2026-01-02',paymentMethod:'credit'}),operation('collect','collection','40',{date:'2026-01-03',relatedOperationId:'sale'}),operation('return-a','sale_return','30',{date:'2026-01-04',relatedOperationId:'sale'}),operation('return-b','sale_return','30',{date:'2026-01-05',relatedOperationId:'sale'})];
    const r=processProject(p);expect(r.entries.some(e=>e.operationId==='return-b')).toBe(false);
    expect(r.issues.some(i=>i.operationId==='return-b'&&i.severity==='error')).toBe(true);
  });
  it('PEPS restaura la capa de origen al devolver y no reutiliza unidades ya devueltas',()=>{
    const p=makeDemoProject('student');p.operations=p.operations.filter(o=>o.type!=='sale'&&o.type!=='collection');
    p.operations.push(operation('mixed-sale','sale','24000',{date:'2026-01-10',productId:'OMEGA',quantity:'120'}));
    p.operations.push(operation('partial-return','sale_return','4000',{date:'2026-01-12',productId:'OMEGA',quantity:'20',unitCost:'120',relatedOperationId:'mixed-sale'}));
    p.operations.push(operation('same-layer-again','sale_return','2000',{date:'2026-01-13',productId:'OMEGA',quantity:'10',unitCost:'120',relatedOperationId:'mixed-sale'}));
    const r=processProject(p);
    expect(r.inventory.find(i=>i.operationId==='partial-return')?.cost).toBe('2400.00');
    expect(r.entries.some(e=>e.operationId==='same-layer-again')).toBe(false);
  });
  it('un asiento de un documento pendiente espera su confirmación antes de afectar cifras',()=>{
    const p=makeDemoProject('student');p.documents=[{id:'doc',name:'Apertura.xlsx',mime:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',hash:'abc',importedAt:'2026-01-01',status:'pending'}];p.manualEntries[0].sourceIds=['doc'];
    const r=processProject(p);expect(r.entries.some(e=>e.kind==='opening')).toBe(false);expect(r.issues.some(i=>i.code==='ENTRY_SOURCE_PENDING')).toBe(true);
    p.documents[0].status='confirmed';expect(processProject(p).entries.some(e=>e.kind==='opening')).toBe(true);
  });
});

describe('Papeles de trabajo fiscales 2026',()=>{
  it('PM y PF usan bases diferentes y no mezclan deducción fiscal con costo contable',()=>{
    const pm=processProject(makeDemoProject('business'));
    expect(pm.taxes.isrBase).toBe('1920.00');
    expect(pm.taxes.isr).toBe('576.00');
    const pf=processProject(makeDemoProject('individual'));
    expect(pf.taxes.vatDue).toBe('2720.00');
    expect(pf.taxes.isrBase).toBe('17000.00');
    expect(pf.taxes.isr).toBe('1761.22');
    expect(pf.taxes.status).toBe('draft');
  });
  it('un cero de coeficiente confirmado es distinto de un dato vacío',()=>{
    const p=makeDemoProject('business');p.taxConfig.coefficient='';
    expect(processProject(p).taxes.isr).toBeNull();
    p.taxConfig.coefficient='0';expect(processProject(p).taxes.isr).toBe('0.00');
  });
  it('cambiar a otro ejercicio no reutiliza silenciosamente tarifas 2026',()=>{
    const p=makeDemoProject('individual');p.period='2025-01';
    expect(processProject(p).taxes.isr).toBeNull();
  });
  it('las tablas acumuladas respetan límites y la tabla especial de diciembre',()=>{
    expect(getIsrBrackets(2)[1].lower).toBe('1689.19');
    expect(getIsrBrackets(12)[1]).toEqual({lower:'10135.12',upper:'86022.11',fixed:'194.59',rate:'0.064'});
    expect(calculateIndividualIsr('0',1)).toBe('0.00');
    expect(calculateIndividualIsr('844.60',1)).toBe('16.22');
    expect(calculateIndividualIsr('10135.12',12)).toBe('194.59');
  });
  it('la deducibilidad sin confirmar mantiene el papel de trabajo pendiente',()=>{
    const p=makeDemoProject('individual');delete p.operations[1].taxDeductible;
    expect(processProject(p).taxes.status).toBe('incomplete');
    expect(processProject(p).taxes.isr).toBeNull();
  });
});

describe('Chat, confirmaciones e historial',()=>{
  it('rechaza un archivo ajeno o dañado y acepta una copia íntegra del proyecto',()=>{
    expect(()=>parseProject({schemaVersion:1})).toThrow(/compatible/);
    const project=makeDemoProject('student');expect(parseProject(JSON.parse(JSON.stringify(project)))).toEqual(project);
    const broken=structuredClone(project);(broken.operations[0] as unknown as {amount:number}).amount=123;
    expect(()=>parseProject(broken)).toThrow(/compatible/);
    const mismatched=structuredClone(project);mismatched.regime='612';expect(()=>parseProject(mismatched)).toThrow(/régimen/);
    const unknownType=structuredClone(project);(unknownType.operations[0] as unknown as {type:string}).type='wire_anything';expect(()=>parseProject(unknownType)).toThrow(/compatible/);
    const untrustedStatus=structuredClone(project);untrustedStatus.documents=[{id:'a',name:'Documento',mime:'text/plain',hash:'a',importedAt:'2026-01-01',status:'confirmed'}];(untrustedStatus.documents[0] as unknown as {status:string}).status='anything';expect(()=>parseProject(untrustedStatus)).toThrow(/compatible/);
  });
  it('proponer un periodo no cambia el proyecto y aplicarlo conserva documentos y fechas',()=>{
    const p=makeDemoProject('student'),proposal=proposeChat(p,'El periodo correcto es febrero de 2026');
    expect(p.period).toBe('2026-01');expect(proposal.patch?.period).toBe('2026-02');
    const changed=applyChatProposal(p,proposal);
    expect(changed.period).toBe('2026-02');expect(changed.operations[0].date).toBe('2026-01-03');expect(changed.revisions.length).toBe(1);
    expect(processProject(changed).issues.some(i=>i.code==='OPERATION_PERIOD')).toBe(true);
  });
  it('un total con IVA incluido se transforma una sola vez en base al proponerlo',()=>{
    const p=createProject('individual');const proposal=proposeChat(p,'Agrega gasto por $1,160.00 con IVA incluido 16% pagado por banco');
    expect(proposal.operation?.amount).toBe('1000.00');
    expect(proposal.operation?.vatRate).toBe('0.16');
    expect(proposal.operation?.taxDeductible).toBeUndefined();
    expect(p.operations).toEqual([]);
  });
  it('un mensaje ambiguo pide información en vez de inventar una operación',()=>{
    expect(proposeChat(createProject('student'),'Haz todo lo que falta').kind).toBe('clarification');
    expect(proposeChat(createProject('student'),'Agrega gasto por $500').operation).toBeUndefined();
  });
  it('las revisiones restauran datos y los cierres impiden cambios del chat',()=>{
    const p=makeDemoProject('student');const snap=createRevision(p,'Estado probado');snap.name='Otro nombre';
    const restored=restoreRevision(snap,snap.revisions[0].id);
    expect(restored.name).toBe(p.name);
    const closed=closeProject(p);expect(closed.closed).toBe(true);
    expect(()=>applyChatProposal(closed,proposeChat(closed,'Usa promedio'))).toThrow(/Reabrir/);
  });
  it('el cuadre no permite cerrar cuando todavía hay una operación sin confirmar',()=>{
    const p=makeDemoProject('student');p.operations.push(operation('pending','expense','100',{confirmed:false}));
    expect(processProject(p).balanceSheet.difference).toBe('0.00');
    expect(()=>closeProject(p)).toThrow(/pendientes/);
  });
  it('una relación bancaria por identificador no oculta una diferencia de importes',()=>{
    const p=makeDemoProject('student');p.bankTransactions[0].amount='-6000';
    const r=processProject(p);expect(r.issues.some(i=>i.code==='BANK_MATCH_MISMATCH')).toBe(true);
    expect(()=>closeProject(p)).toThrow(/conciliación/);
  });
});
