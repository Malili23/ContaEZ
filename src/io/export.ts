import ExcelJS from 'exceljs';
import Decimal from 'decimal.js';
import type { Project, ProcessingResult } from '../core/types';

const TEAL='103F36', PALE='E9F1ED', LIME='D6F2A0', GREY='65766F';
const money='#,##0.00;[Red](#,##0.00)';
const quote=(name:string)=>`'${name.replace(/'/g,"''")}'`;
const n=(v:string|undefined)=>Number(v||0);
export async function buildWorkbook(project:Project,result:ProcessingResult):Promise<ExcelJS.Workbook>{
  const book=new ExcelJS.Workbook();book.creator='ContaEZ · @betcover_ii';book.lastModifiedBy='ContaEZ';book.created=new Date();book.calcProperties.fullCalcOnLoad=true;
  const names=['Ingreso','Egreso','Diario','Esquemas de mayor','Balaza de comprobación','Tarjeta de almacen PEPS','Tarjet de almacen C.P.','Estados de resultados','Balance general','Conciliación Bancaria','Operaciones','Catálogo','Inventario','Papeles fiscales','Documentos','Revisión ContaEZ'];
  const sheets=Object.fromEntries(names.map(name=>[name,book.addWorksheet(name)]));
  const headers=(name:string,values:string[],widths:number[])=>{
    const sheet=sheets[name];sheet.views=[{state:'frozen',ySplit:4}];sheet.properties.defaultRowHeight=20;
    sheet.columns=widths.map(width=>({width}));sheet.mergeCells(1,1,1,Math.max(values.length,2));sheet.getCell('A1').value=`${project.name} · ${name}`;sheet.getCell('A1').font={name:'Calibri',size:17,bold:true,color:{argb:'FFFFFFFF'}};sheet.getRow(1).height=32;sheet.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:TEAL}};
    sheet.mergeCells(2,1,2,Math.max(values.length,2));sheet.getCell('A2').value=`México · ${project.period} · ${project.currency} · ${project.inventorySystem==='analytical'?'Analítico':project.valuation==='fifo'?'Perpetuos / PEPS':'Perpetuos / promedio móvil'} · ${project.ruleSetId}`;sheet.getCell('A2').font={size:10,color:{argb:GREY}};
    sheet.getRow(4).values=values;sheet.getRow(4).font={bold:true,color:{argb:TEAL}};sheet.getRow(4).fill={type:'pattern',pattern:'solid',fgColor:{argb:LIME}};sheet.getRow(4).height=26;
    sheet.pageSetup={paperSize:9,orientation:'landscape',fitToPage:true,fitToWidth:1,fitToHeight:0,printTitlesRow:'1:4'};sheet.headerFooter.oddFooter='ContaEZ · México · Página &P de &N';return sheet;
  };
  const formula=(sheet:ExcelJS.Worksheet,row:number,col:number,expression:string,value:number|string)=>{sheet.getCell(row,col).value={formula:expression,result:value};if(typeof value==='number')sheet.getCell(row,col).numFmt=money;};
  const ops=headers('Operaciones',['ID','Fecha','Tipo','Concepto','Base sin IVA','Tasa IVA','Medio','Cantidad','Costo unitario','Producto','Confirmada','Origen'],[38,14,20,54,20,14,15,16,18,22,16,38]);
  const opRows=new Map<string,number>();
  const operationsById = new Map(project.operations.map(operation => [operation.id, operation]));
  project.operations.forEach((op,i)=>{const r=i+5;opRows.set(op.id,r);ops.addRow([op.id,op.date,op.type,op.description,n(op.amount),n(op.vatRate),op.paymentMethod,op.quantity===undefined?'':n(op.quantity),op.unitCost===undefined?'':n(op.unitCost),op.productId??'',op.confirmed?'Sí':'Pendiente',op.sourceIds.join(', ')]);ops.getCell(r,5).numFmt=money;ops.getCell(r,6).numFmt='0.00%';ops.getCell(r,9).numFmt='#,##0.000000';});
  ops.getCell('A3').value='Entradas editables. Al agregar registros o modificar estructura/método, regenerar desde ContaEZ. No alterar los identificadores.';
  const catalog=headers('Catálogo',['Código','Cuenta','Tipo','Naturaleza','Código SAT'],[18,48,20,18,18]);project.accounts.forEach(a=>catalog.addRow([a.code,a.name,a.type,a.nature,a.satCode??'']));
  const inv=headers('Inventario',['Operación','Producto','Fecha','Concepto','Entradas','Salidas','Existencia','Costo unitario','Costo movimiento','Saldo calculado','Costo validado motor'],[38,22,14,48,16,16,17,20,22,22,22]);
  const invRows=new Map<string,number[]>();
  const previousInventoryRow = new Map<string,number>();
  result.inventory.forEach((movement,i)=>{
    const r=i+5;const op=operationsById.get(movement.operationId),source=opRows.get(movement.operationId);inv.addRow([movement.operationId,movement.productId,movement.date,movement.description,0,0,0,n(movement.unitCost),0,0,n(movement.cost)]);
    const incoming=new Decimal(movement.incoming||0).gt(0),outgoing=new Decimal(movement.outgoing||0).gt(0);
    if(source&&incoming&&op?.quantity)formula(inv,r,5,`${quote('Operaciones')}!H${source}`,n(movement.incoming));else inv.getCell(r,5).value=n(movement.incoming);
    if(source&&outgoing&&op?.quantity)formula(inv,r,6,`${quote('Operaciones')}!H${source}`,n(movement.outgoing));else inv.getCell(r,6).value=n(movement.outgoing);
    const previous=previousInventoryRow.get(movement.productId);
    formula(inv,r,7,`${previous?`G${previous}`:'0'}+E${r}-F${r}`,n(movement.quantity));
    // The movement cost is the engine's allocation. Unit cost is derived from that amount,
    // avoiding loss of cents when a 6-decimal display cost is multiplied by large quantities.
    const initial=project.inventoryInitial.find(l=>l.id===movement.operationId);
    if(initial)formula(inv,r,9,`ROUND(E${r}*${initial.unitCost},2)`,new Decimal(initial.quantity).times(initial.unitCost).toDecimalPlaces(2).toNumber());
    else if(source&&op?.type==='purchase')formula(inv,r,9,`ROUND(${quote('Operaciones')}!E${source},2)`,n(movement.cost));
    else inv.getCell(r,9).value=new Decimal(movement.cost||0).abs().toNumber();
    formula(inv,r,8,`I${r}/(E${r}+F${r})`,n(movement.unitCost));inv.getCell(r,8).numFmt='#,##0.000000';
    formula(inv,r,10,`${previous?`J${previous}`:'0'}+IF(E${r}>0,I${r},-I${r})`,n(movement.balance));
    previousInventoryRow.set(movement.productId,r);
    invRows.set(movement.operationId,[...(invRows.get(movement.operationId)??[]),r]);
  });
  inv.getCell('A3').value='Asignaciones de costo verificadas por ContaEZ. Cambiar cantidades, costos, capas PEPS o método exige regenerar para reasignar costos de salidas y devoluciones.';
  const journal=headers('Diario',['Fecha','Tipo póliza','Código','Cuenta','Concepto','Parcial','Debe','Haber','Asiento ID','Operación ID'],[14,18,18,42,52,18,20,20,38,38]);
  let jr=5;const classified:{row:number;kind:string}[]=[];
  for(const entry of result.entries)for(const line of entry.lines){
    const opRow=entry.operationId?opRows.get(entry.operationId):undefined;
    journal.addRow([entry.date,entry.kind,line.accountCode,project.accounts.find(a=>a.code===line.accountCode)?.name??line.accountCode,entry.concept,'',0,0,entry.id,entry.operationId??'']);
    for(const [col,value]of [[7,line.debit],[8,line.credit]] as const){
      let expr:string|undefined;const amount=new Decimal(value||0);
      if(entry.operationId&&opRow&&amount.gt(0)){
        const base = `ROUND(${quote('Operaciones')}!E${opRow},2)`;
        const tax = `ROUND(${base}*${quote('Operaciones')}!F${opRow},2)`;
        switch(line.sourceAmount) {
          case 'base': expr=base;break;
          case 'vat': expr=tax;break;
          case 'gross': expr=`${base}+${tax}`;break;
          case 'inventory': expr=invRows.get(entry.operationId)?.map(r=>`${quote('Inventario')}!I${r}`).join('+');break;
        }
      }
      if(expr)formula(journal,jr,col,expr,amount.toNumber());else{journal.getCell(jr,col).value=amount.toNumber();journal.getCell(jr,col).numFmt=money;}
    }
    classified.push({row:jr,kind:entry.kind});jr++;
  }
  const lastJournal=Math.max(5,jr-1),totalRow=jr+1;journal.getCell(totalRow,5).value='SUMAS IGUALES';formula(journal,totalRow,7,`SUM(G5:G${lastJournal})`,result.entries.reduce((s,e)=>s+e.lines.reduce((a,l)=>a+n(l.debit),0),0));formula(journal,totalRow,8,`SUM(H5:H${lastJournal})`,result.entries.reduce((s,e)=>s+e.lines.reduce((a,l)=>a+n(l.credit),0),0));formula(journal,totalRow+1,7,`ROUND(G${totalRow}-H${totalRow},2)`,0);
  for(const [name,kind]of [['Ingreso','income'],['Egreso','expense']] as const){const s=headers(name,['Fecha','Póliza','Código','Cuenta','Concepto','Parcial','Debe','Haber'],[14,18,18,42,52,18,20,20]);let r=5;for(const source of classified.filter(c=>c.kind===kind)){for(let c=1;c<=8;c++){const original=journal.getCell(source.row,c);const val=original.value;formula(s,r,c,`${quote('Diario')}!${String.fromCharCode(64+c)}${source.row}`,typeof val==='object'&&val&&'result'in val?(val.result as number|string):typeof val==='number'?val:String(val??''));}r++;}}
  const mayor=headers('Esquemas de mayor',['Código','Cuenta','Debe','Haber','Saldo deudor','Saldo acreedor'],[20,50,22,22,22,22]);
  const balance=headers('Balaza de comprobación',['Código','Cuenta','Tipo','Debe','Haber','Saldo deudor','Saldo acreedor'],[20,50,18,22,22,22,22]);
  const accountRows=new Map<string,number>();
  project.accounts.forEach((a,i)=>{const r=i+5;accountRows.set(a.code,r);const cached=result.trialBalance.find(t=>t.account.code===a.code);mayor.addRow([a.code,a.name,0,0,0,0]);
    formula(mayor,r,3,`SUMIF(${quote('Diario')}!$C$5:$C$${lastJournal},A${r},${quote('Diario')}!$G$5:$G$${lastJournal})`,new Decimal(cached?.debit||0).plus(cached?.openingDebit||0).toNumber());formula(mayor,r,4,`SUMIF(${quote('Diario')}!$C$5:$C$${lastJournal},A${r},${quote('Diario')}!$H$5:$H$${lastJournal})`,new Decimal(cached?.credit||0).plus(cached?.openingCredit||0).toNumber());formula(mayor,r,5,`MAX(0,ROUND(C${r}-D${r},2))`,n(cached?.balanceDebit));formula(mayor,r,6,`MAX(0,ROUND(D${r}-C${r},2))`,n(cached?.balanceCredit));
    balance.addRow([a.code,a.name,a.type,0,0,0,0]);for(const [col,source,cachedValue]of [[4,'C',new Decimal(cached?.debit||0).plus(cached?.openingDebit||0).toString()],[5,'D',new Decimal(cached?.credit||0).plus(cached?.openingCredit||0).toString()],[6,'E',cached?.balanceDebit],[7,'F',cached?.balanceCredit]] as const)formula(balance,r,col,`${quote('Esquemas de mayor')}!${source}${r}`,n(cachedValue));
  });
  const endAccounts=Math.max(5,project.accounts.length+4);const br=endAccounts+2;balance.getCell(br,2).value='SUMAS';for(let c=4;c<=7;c++){const col=String.fromCharCode(64+c);formula(balance,br,c,`SUM(${col}5:${col}${endAccounts})`,result.trialBalance.reduce((s,t)=>s+n(c===4?new Decimal(t.debit).plus(t.openingDebit).toString():c===5?new Decimal(t.credit).plus(t.openingCredit).toString():c===6?t.balanceDebit:t.balanceCredit),0));}balance.getCell(br+1,2).value='Diferencia';formula(balance,br+1,4,`ROUND(D${br}-E${br},2)`,0);formula(balance,br+1,6,`ROUND(F${br}-G${br},2)`,0);
  const sumType=(type:string,debit:boolean)=>`SUMIF(${quote('Balaza de comprobación')}!$C$5:$C$${endAccounts},"${type}",${quote('Balaza de comprobación')}!$${debit?'F':'G'}$5:$${debit?'F':'G'}$${endAccounts})`;
  const er=headers('Estados de resultados',['Concepto','Importe'],[55,28]);er.addRow(['Ingresos netos',0]);formula(er,5,2,`${sumType('income',false)}-${sumType('income',true)}`,n(result.incomeStatement.revenue));er.addRow(['Costo de ventas',0]);formula(er,6,2,`${sumType('cost',true)}-${sumType('cost',false)}`,n(result.incomeStatement.costOfSales));er.addRow(['Utilidad bruta',0]);formula(er,7,2,'B5-B6',n(result.incomeStatement.revenue)-n(result.incomeStatement.costOfSales));er.addRow(['Gastos',0]);formula(er,8,2,`${sumType('expense',true)}-${sumType('expense',false)}`,n(result.incomeStatement.expenses));er.addRow(['Resultado contable antes de impuestos',0]);formula(er,9,2,'B7-B8',n(result.incomeStatement.profit));
  const bs=headers('Balance general',['Concepto','Importe'],[55,28]);bs.addRow(['Activo',0]);formula(bs,5,2,`${sumType('asset',true)}-${sumType('asset',false)}`,n(result.balanceSheet.assets));bs.addRow(['Pasivo',0]);formula(bs,6,2,`${sumType('liability',false)}-${sumType('liability',true)}`,n(result.balanceSheet.liabilities));bs.addRow(['Capital antes del resultado',0]);formula(bs,7,2,`${sumType('equity',false)}-${sumType('equity',true)}`,n(result.balanceSheet.equity));bs.addRow(['Resultado del periodo',0]);formula(bs,8,2,`${quote('Estados de resultados')}!B9`,n(result.balanceSheet.profit));bs.addRow(['Pasivo más capital',0]);formula(bs,9,2,'SUM(B6:B8)',n(result.balanceSheet.liabilities)+n(result.balanceSheet.equity)+n(result.balanceSheet.profit));bs.addRow(['Diferencia',0]);formula(bs,10,2,'ROUND(B5-B9,2)',n(result.balanceSheet.difference));
  for(const name of ['Tarjeta de almacen PEPS','Tarjet de almacen C.P.']){const s=headers(name,['Operación','Producto','Fecha','Concepto','Entradas','Salidas','Existencia','Costo unitario','Costo movimiento','Saldo'],[38,22,14,48,16,16,17,20,22,22]);const selected=(name.includes('PEPS')&&project.valuation==='fifo')||(!name.includes('PEPS')&&project.valuation==='average');s.getCell('A3').value=selected?'Método seleccionado; datos vinculados al auxiliar de inventarios.':'Método alternativo no aplicado. Cambiar método en ContaEZ y generar una revisión para comparar.';if(selected)result.inventory.forEach((m,i)=>{const r=i+5;s.addRow([]);for(let c=1;c<=10;c++){const v=inv.getCell(r,c).value;formula(s,r,c,`${quote('Inventario')}!${String.fromCharCode(64+c)}${r}`,typeof v==='object'&&v&&'result'in v?v.result as number|string:typeof v==='number'?v:String(v??''));}});}
  const bank=headers('Conciliación Bancaria',['Fecha','Concepto','Importe firmado','Operación relacionada','Estado'],[16,60,24,38,22]);
  const validBankDate = (date:string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date.slice(0,7) !== project.period) return false;
    const parsed = new Date(`${date}T12:00:00Z`);
    return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0,10) === date;
  };
  const postedOperations = new Set(result.entries.map(entry => entry.operationId));
  for(const transaction of project.bankTransactions.filter(t => validBankDate(t.date))) {
    const amount = Number(transaction.amount);
    if(!Number.isFinite(amount))continue;
    bank.addRow([transaction.date,transaction.description,amount,transaction.matchedOperationId??'',postedOperations.has(transaction.matchedOperationId)?'Relacionado':'Por conciliar']);
    bank.getCell(bank.rowCount,3).numFmt=money;
  }
  const lastBankRow = bank.rowCount;
  const bankRow=Math.max(6,lastBankRow+2);bank.getCell(bankRow,2).value='Saldo en libros';const bankAccountRow=accountRows.get('102.01');formula(bank,bankRow,3,bankAccountRow?`${quote('Esquemas de mayor')}!E${bankAccountRow}-${quote('Esquemas de mayor')}!F${bankAccountRow}`:'0',n(result.bankReconciliation.ledgerBalance));
  const openingBank=result.entries.filter(e=>e.kind==='opening').flatMap(e=>e.lines).filter(l=>l.accountCode==='102.01').reduce((s,l)=>s.plus(l.debit).minus(l.credit),new Decimal(0));
  bank.getCell(bankRow+4,2).value='Apertura contable usada como saldo inicial por confirmar';formula(bank,bankRow+4,3,`SUMIFS(${quote('Diario')}!G5:G${lastJournal},${quote('Diario')}!C5:C${lastJournal},"102.01",${quote('Diario')}!B5:B${lastJournal},"opening")-SUMIFS(${quote('Diario')}!H5:H${lastJournal},${quote('Diario')}!C5:C${lastJournal},"102.01",${quote('Diario')}!B5:B${lastJournal},"opening")`,openingBank.toNumber());
  bank.getCell(bankRow+1,2).value='Apertura más movimientos del periodo';formula(bank,bankRow+1,3,`C${bankRow+4}${lastBankRow>=5?`+SUM(C5:C${lastBankRow})`:''}`,n(result.bankReconciliation.statementBalance));bank.getCell(bankRow+2,2).value='Diferencia / pendiente';formula(bank,bankRow+2,3,`ROUND(C${bankRow}-C${bankRow+1},2)`,n(result.bankReconciliation.difference));bank.getCell(bankRow+3,2).value='Confirmar saldo inicial y final con el estado bancario; esta estimación usa la apertura contable.';
  const tax=headers('Papeles fiscales',['Concepto','Importe / estado','Observación'],[46,30,90]);[['IVA trasladado efectivamente cobrado',result.taxes.vatCollected],['IVA acreditable efectivamente pagado',result.taxes.vatPaid],['IVA neto preliminar',result.taxes.vatDue],['Ingresos fiscales',result.taxes.taxableRevenue],['Deducciones consideradas',result.taxes.deductions],['Base ISR',result.taxes.isrBase??'Falta información'],['ISR provisional',result.taxes.isr??'Falta información'],['Estado',result.taxes.status==='incomplete'?'Pendiente de información':'Borrador para revisión']].forEach(([label,value])=>tax.addRow([label,value&&Number.isFinite(Number(value))?n(value):value,'']));for(const note of result.taxes.notes)tax.addRow(['Observación','',note]);tax.addRow(['Alcance','','Papeles de trabajo; revisar régimen, acumulados y obligaciones antes de presentar.']);
  const docs=headers('Documentos',['ID','Archivo','SHA-256','UUID','Importado','Estado'],[38,55,68,40,28,22]);project.documents.forEach(d=>docs.addRow([d.id,d.name,d.hash,d.uuid??'',d.importedAt,d.status]));
  const review=headers('Revisión ContaEZ',['Nivel','Código','Ubicación','Hallazgo','Explicación','Cómo resolver'],[16,28,32,48,72,72]);for(const issue of result.issues)review.addRow([issue.severity,issue.code,issue.location??'',issue.title,issue.detail,issue.suggestion]);review.addRow(['Información','MEXICO_ONLY','','ContaEZ está diseñada exclusivamente para contabilidad y obligaciones fiscales de México, dentro de los regímenes, ejercicios y módulos indicados.','','']);review.addRow(['Información','RECALCULATION','','Las fórmulas incluyen resultados del motor.','El recálculo en Excel/Sheets debe verificarse en su motor nativo.','Cambios en cantidades, métodos, capas de inventario y nuevos registros requieren regeneración.']);review.addRow(['Créditos','','','Creada por @betcover_ii','https://www.instagram.com/betcover_ii/','gallardoquirozd4@gmail.com']);
  for(const sheet of book.worksheets){sheet.eachRow((row,r)=>{if(r>=5){row.eachCell(cell=>{cell.font={name:'Calibri',size:11,color:{argb:TEAL}};cell.alignment={vertical:'top',wrapText:typeof cell.value==='string'&&String(cell.value).length>50};if(r%2===0)cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:PALE}};});}});if(sheet.rowCount>=5)sheet.autoFilter={from:{row:4,column:1},to:{row:sheet.rowCount,column:sheet.columnCount}};}
  return book;
}
export async function exportWorkbook(project:Project,result:ProcessingResult):Promise<Uint8Array>{const book=await buildWorkbook(project,result);return new Uint8Array(await book.xlsx.writeBuffer());}

export async function exportAuditSummary(rows:{filename:string;changes:number;errors:number;warnings:number;pending:number;output:string;nativeVerified?:boolean}[]):Promise<Uint8Array>{
  const book=new ExcelJS.Workbook();book.creator='ContaEZ';const sheet=book.addWorksheet('Resumen de revisión');sheet.columns=[{header:'Práctica',key:'filename',width:70},{header:'Cambios verificables',key:'changes',width:24},{header:'Errores restantes',key:'errors',width:24},{header:'Advertencias',key:'warnings',width:22},{header:'Pendientes',key:'pending',width:22},{header:'Copia revisada',key:'output',width:80},{header:'Recálculo nativo',key:'native',width:38}];rows.forEach(r=>sheet.addRow({...r,native:r.nativeVerified?'Comprobado en Excel para Windows':'No verificado'}));sheet.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};sheet.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:TEAL}};sheet.views=[{state:'frozen',ySplit:1}];sheet.addRow({filename:'Alcance: correcciones demostrables y comprobaciones indicadas. No certifica auditoría contable integral ni operaciones omitidas.'});return new Uint8Array(await book.xlsx.writeBuffer());
}
