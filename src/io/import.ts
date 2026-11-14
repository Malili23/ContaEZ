import { XMLParser } from 'fast-xml-parser';
import Decimal from 'decimal.js';
import type { Project, SourceDocument, Operation, JournalEntry, BankTransaction, Issue } from '../core/types';
import { auditWorkbook, type WorkbookAudit } from './audit';
import { readRawWorkbook, asArray, cellParts } from './workbook';

export interface ImportResult { documents:SourceDocument[]; operations:Operation[]; entries:JournalEntry[]; bankTransactions:BankTransaction[]; issues:Issue[]; audit?:WorkbookAudit; }
const id=()=>crypto.randomUUID();
const norm=(s:string)=>s.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().trim();
const issue=(code:string,title:string,detail:string,suggestion:string,sourceId:string,severity:Issue['severity']='warning'):Issue=>({id:id(),code,title,detail,suggestion,sourceId,severity});
const numeric=(v:string)=>{let s=v.trim().replace(/[$\s]/g,'').replace(/^\((.*)\)$/,'-$1');if(s.includes(',')){if(/^-?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(s))s=s.replace(/,/g,'');else if(/^-?\d+(?:,\d{1,2})$/.test(s))s=s.replace(',','.');else if(/^-?\d{1,3}(?:\.\d{3})+,\d{1,2}$/.test(s))s=s.replace(/\./g,'').replace(',','.');else return null;}if(!/^-?\d*(?:\.\d+)?$/.test(s)||s==='')return null;try{return new Decimal(s).toString();}catch{return null;}};
const date=(v:string,period:string):string|null=>{
  const clean=v.trim();const isoPrefix=clean.match(/^(20\d{2}-\d{2}-\d{2})(?:$|[ T])/);if(isoPrefix){const parsed=new Date(isoPrefix[1]+'T12:00:00Z');return !Number.isNaN(parsed.valueOf())&&parsed.toISOString().slice(0,10)===isoPrefix[1]?isoPrefix[1]:null;}
  const m=clean.match(/^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?$/);if(!m)return null;
  const year=m[3]?(m[3].length===2?`20${m[3]}`:m[3]):period.slice(0,4);const iso=`${year}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;const d=new Date(iso+'T12:00:00Z');return !Number.isNaN(d.valueOf())&&d.toISOString().slice(0,10)===iso?iso:null;
};
const excelDate=(v:string,period:string,date1904=false):string|null=>{const serial=numeric(v);return serial&&new Decimal(serial).gt(40000)&&new Decimal(serial).lt(80000)?new Date(Date.UTC(date1904?1904:1899,date1904?0:11,date1904?1:30)+Number(serial)*86400000).toISOString().slice(0,10):date(v,period);};
export function parseCsv(text:string):string[][]{
  const firstLine=text.split(/\r?\n/)[0]??'';const candidates=[',',';','\t'];const delimiter=candidates.sort((a,b)=>firstLine.split(b).length-firstLine.split(a).length)[0];
  const rows:string[][]=[];let row:string[]=[],value='',quoted=false;
  for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){value+='"';i++;}else quoted=!quoted;}else if(c===delimiter&&!quoted){row.push(value);value='';}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(value);if(row.some(x=>x.trim()!==''))rows.push(row);row=[];value='';}else value+=c;}
  row.push(value);if(row.some(x=>x.trim()!==''))rows.push(row);return rows;
}
function importCsv(text:string,p:Project,document:SourceDocument,result:ImportResult){
  const rows=parseCsv(text.replace(/^\uFEFF/,''));if(rows.length<2){result.issues.push(issue('CSV_EMPTY','No hay movimientos para importar','El archivo no contiene encabezado y registros.','Usa columnas Fecha, Concepto e Importe; alternativamente Cargo y Abono.',document.id));return;}
  const headers=rows[0].map(norm);const find=(patterns:RegExp[])=>headers.findIndex(h=>patterns.some(r=>r.test(h)));
  const dateCol=find([/^fecha$/, /fecha.*operacion/,/^date$/]),descCol=find([/concepto|descripcion|detalle|description/]),amountCol=find([/^importe$|^monto$|^amount$/]),debitCol=find([/^cargo$|^retiro$|^debit$/]),creditCol=find([/^abono$|^deposito$|^credit$/]);
  if(dateCol<0||(amountCol<0&&(debitCol<0||creditCol<0))){result.issues.push(issue('CSV_MAPPING','Falta identificar columnas','No se detectó Fecha e Importe, o Fecha/Cargo/Abono.','Renombra las columnas; los cargos serán negativos y los abonos positivos.',document.id));document.text=text.slice(0,30_000);return;}
  let rejected=0;for(const [index,row]of rows.slice(1).entries()){
    const iso=date(row[dateCol]??'',p.period),creditText=(row[creditCol]??'').trim(),debitText=(row[debitCol]??'').trim(),credit=creditText?numeric(creditText):'0',debit=debitText?numeric(debitText):'0';
    const amount=amountCol>=0?numeric(row[amountCol]??''):!creditText&&!debitText||credit===null||debit===null?null:new Decimal(credit).minus(debit).toString();
    if(!iso||amount===null){rejected++;continue;}
    result.bankTransactions.push({id:id(),date:iso,description:row[descCol]||`Movimiento ${index+1}`,amount,sourceId:document.id});
  }
  if(rejected)result.issues.push(issue('CSV_ROWS_PENDING','Hay filas sin fecha o importe válido',`${rejected} filas necesitan revisión. Los movimientos válidos se conservaron.`, 'Corrige las filas en el archivo original y vuelve a importarlo como una revisión.',document.id));
  result.issues.push(issue('BANK_RECONCILIATION','Movimientos bancarios por relacionar',`${result.bankTransactions.length} movimientos importados. Un movimiento bancario no genera automáticamente otro ingreso o gasto.`, 'Relaciona cada movimiento con la factura, pago u operación correspondiente.',document.id,'info'));
}
export function parseCfdi(text:string,p:Project,document:SourceDocument):Pick<ImportResult,'operations'|'issues'>{
  const operations:Operation[]=[],issues:Issue[]=[];
  if(/<!DOCTYPE|<!ENTITY/i.test(text))throw new Error('El XML contiene declaraciones externas no admitidas.');
  const xml=new XMLParser({ignoreAttributes:false,attributeNamePrefix:'',removeNSPrefix:true,parseTagValue:false,parseAttributeValue:false,processEntities:false}).parse(text);
  const cfdi=xml.Comprobante;if(!cfdi){issues.push(issue('XML_NOT_CFDI','XML sin comprobante CFDI','No se encontró el elemento Comprobante.','Carga un CFDI 4.0 o captura los datos manualmente.',document.id));return {operations,issues};}
  const version=String(cfdi.Version??cfdi.version??'');if(version!=='4.0')issues.push(issue('CFDI_VERSION','Versión CFDI fuera del alcance inicial',`Versión detectada: ${version||'desconocida'}.`,'Revisa el comprobante antes de confirmar.',document.id));
  const stamp=cfdi.Complemento?.TimbreFiscalDigital;const uuid=String(stamp?.UUID??'').toUpperCase();document.uuid=uuid||undefined;
  if(uuid&&p.documents.some(d=>d.uuid?.toUpperCase()===uuid)){document.status='duplicate';issues.push(issue('DUPLICATE_UUID','Comprobante ya registrado',`El UUID ${uuid} ya forma parte del proyecto.`,'Conserva una sola operación con sus documentos relacionados.',document.id));return {operations,issues};}
  const issuer=String(cfdi.Emisor?.Rfc??'').toUpperCase(),recipient=String(cfdi.Receptor?.Rfc??'').toUpperCase();const own=p.rfc.toUpperCase().trim();const outgoing=own&&own===issuer;const incoming=own&&own===recipient;
  const invoiceType=String(cfdi.TipoDeComprobante??'');
  if(invoiceType!=='P'&&String(cfdi.Moneda??'MXN')!=='MXN'){
    issues.push(issue('CFDI_CURRENCY','Comprobante en moneda fuera del alcance inicial',`Moneda ${cfdi.Moneda}; se conserva el documento sin interpretar sus importes como pesos.`, 'Captura una operación en MXN con el tipo de cambio y soporte revisados; no hay conversión automática.',document.id,'error'));return {operations,issues};
  }
  if(invoiceType==='P'){
    const payments=cfdi.Complemento?.Pagos; if(String(payments?.Version??'')!=='2.0')issues.push(issue('REP_VERSION','Complemento de pagos por revisar','No se identificó Pagos versión 2.0.','Verifica versión y documentos relacionados.',document.id));
    for(const payment of asArray(payments?.Pago))for(const related of asArray(payment.DoctoRelacionado)){
      if(String(payment.MonedaP??'MXN')!=='MXN'||String(related.MonedaDR??'MXN')!=='MXN'){issues.push(issue('REP_CURRENCY','Pago en moneda fuera del alcance inicial','El complemento incluye una moneda distinta de MXN.','Revisa tipo de cambio y base/impuesto convertidos antes de registrar el pago.',document.id,'error'));continue;}
      const relatedUuid=String(related.IdDocumento??'').toUpperCase();const relatedOp=p.operations.find(o=>o.invoiceId?.toUpperCase()===relatedUuid);const paid=numeric(String(related.ImpPagado??''));
      if(!relatedOp||paid===null){issues.push(issue('REP_INVOICE_MISSING','Pago sin factura relacionada disponible',`Factura ${relatedUuid||'sin UUID'}; importe ${related.ImpPagado??'sin importe'}.`,'Importa la factura y vuelve a relacionar el complemento; no se inventó la base del pago.',document.id));continue;}
      const rate=new Decimal(relatedOp.vatRate||0);const base=new Decimal(paid).div(rate.plus(1)).toDecimalPlaces(2).toFixed(2);
      operations.push({id:id(),date:String(payment.FechaPago??cfdi.Fecha??`${p.period}-01`).slice(0,10),type:relatedOp.type==='sale'?'collection':'payment',description:`Pago de CFDI ${relatedUuid}`,amount:base,vatRate:rate.toString(),paymentMethod:'bank',relatedOperationId:relatedOp.id,invoiceId:uuid,sourceIds:[document.id],confirmed:false});
    }
    issues.push(issue('REP_CONFIRM','Confirma la relación del complemento','Los pagos propuestos conservan factura y fecha de pago por separado.','Verifica importe, tasa, parcialidad y saldo antes de confirmar.',document.id));return {operations,issues};
  }
  if(!['I','E'].includes(invoiceType)){issues.push(issue('CFDI_TYPE','Tipo de CFDI requiere revisión',`Tipo ${invoiceType||'desconocido'} no se convierte automáticamente en una operación.`,'Revisa el documento y registra su tratamiento mediante captura manual.',document.id));return {operations,issues};}
  const subtotal=numeric(String(cfdi.SubTotal??''));const discount=numeric(String(cfdi.Descuento??'0'));
  if(subtotal===null){issues.push(issue('CFDI_SUBTOTAL','Falta el subtotal del comprobante','No se usará el total como base sin IVA.','Verifica SubTotal en el XML.',document.id,'error'));return {operations,issues};}
  const base=new Decimal(subtotal).minus(discount??0);const transfers=asArray(cfdi.Impuestos?.Traslados?.Traslado);const vat=transfers.filter(t=>String(t.Impuesto)==='002');const rates=[...new Set(vat.filter(t=>t.TipoFactor!=='Exento').map(t=>String(t.TasaOCuota??'')))];
  const otherTax=transfers.some(t=>String(t.Impuesto)!=='002')||asArray(cfdi.Impuestos?.Retenciones?.Retencion).length>0;
  const rate=rates.length===1&&numeric(rates[0])!==null?rates[0]:'0';
  const actualVat=vat.reduce((sum,t)=>sum.plus(numeric(String(t.Importe??'0'))??0),new Decimal(0));
  if(rates.length>1||otherTax||(!actualVat.isZero()&&base.times(rate).minus(actualVat).abs().gt('0.02'))){issues.push(issue('CFDI_TAX_SPLIT','Impuestos que requieren desglose','El CFDI contiene bases mixtas, retenciones u otros impuestos; se conserva su texto original.','Desglosa las bases e impuestos antes de confirmar esta propuesta.',document.id));}
  if(!outgoing&&!incoming)issues.push(issue('CFDI_RFC_MATCH','Confirma a quién pertenece la factura',own?'El RFC del proyecto no coincide con emisor ni receptor.':'Configura el RFC del proyecto para identificar ingreso o egreso.','Indica tu RFC y confirma la clasificación del comprobante.',document.id));
  const descriptions=asArray(cfdi.Conceptos?.Concepto).map(c=>String(c.Descripcion??'')).filter(Boolean);
  const type:Operation['type']=invoiceType==='E'?(outgoing?'sale_return':'purchase_return'):(outgoing?'sale':'expense');
  operations.push({id:id(),date:String(cfdi.Fecha??`${p.period}-01`).slice(0,10),type,description:descriptions.join('; ').slice(0,400)||`${invoiceType==='E'?'Nota de crédito':'Factura'} ${cfdi.Serie??''}${cfdi.Folio??''}`,amount:base.toFixed(2),vatRate:rate,paymentMethod:cfdi.MetodoPago==='PPD'?'credit':'bank',invoiceId:uuid||undefined,sourceIds:[document.id],confirmed:false,taxDeductible:false});
  issues.push(issue('CFDI_CONFIRM','Comprobante listo para revisión','Se separaron subtotal, descuento, IVA y total. El estado fiscal actual del CFDI no se ha consultado en SAT.','Confirma clasificación, pago real, cuenta e impuestos. PUE no demuestra por sí solo que ya se haya cobrado.',document.id));
  document.text=JSON.stringify({version,issuer,recipient,subtotal:cfdi.SubTotal,discount:cfdi.Descuento??'0',vat:actualVat.toFixed(2),total:cfdi.Total,method:cfdi.MetodoPago,concepts:descriptions});return {operations,issues};
}
async function importExcel(bytes:Uint8Array,p:Project,document:SourceDocument,result:ImportResult){
  const book=readRawWorkbook(bytes);result.audit=await auditWorkbook(bytes,document.name);for(const finding of result.audit.findings)result.issues.push({...issue(`XLSX_${finding.code}`,finding.message,`${finding.sheet}!${finding.cell}${finding.original?`: ${finding.original}`:''}`,finding.suggestion,document.id,finding.severity),location:`${finding.sheet}!${finding.cell}`});
  // Prefer the stable ContaEZ operations table. Other workbooks are diagnostic until mapping is confirmed.
  const ops=book.sheets.find(s=>norm(s.name)==='operaciones');
  if(ops){
    const headerA=norm(ops.cells.get('A4')?.value??'');if(headerA==='id'){
      const rows=new Set([...ops.cells.keys()].map(a=>cellParts(a)[1]).filter(r=>r>=5));
      for(const r of rows){const get=(col:string)=>ops.cells.get(`${col}${r}`)?.value??'';const opType=get('C') as Operation['type'];if(!['purchase','sale','expense','collection','payment','purchase_return','sale_return','contribution','adjustment'].includes(opType))continue;
        const amount=numeric(get('E')),vatRate=numeric(get('F'));if(amount===null||vatRate===null)continue;
        const originalId=get('A');const old=p.operations.find(o=>o.id===originalId);
        if(old){result.issues.push(issue('OPERATION_REVISION','Una operación ya existe',`${originalId}: se conserva el registro vigente; el archivo se trata como evidencia de otra revisión.`,'Compara cambios en el proyecto antes de reemplazar registros.',document.id));continue;}
        const iso=excelDate(get('B'),p.period,book.date1904);if(!iso){result.issues.push(issue('WORKBOOK_DATE','Fecha de operación pendiente',`Fila ${r}: no se pudo interpretar la fecha.`, 'Confirma la fecha; no se sustituyó por el primer día del mes.',document.id));continue;}
        result.operations.push({id:originalId||id(),date:iso,type:opType,description:get('D'),amount,vatRate,paymentMethod:['cash','bank','credit'].includes(get('G'))?get('G') as Operation['paymentMethod']:'credit',quantity:numeric(get('H'))??undefined,unitCost:numeric(get('I'))??undefined,productId:get('J')||undefined,sourceIds:[document.id],confirmed:false});
      }
    }
  }
  if(!ops){
    for(const sheet of book.sheets.filter(s=>['ingresos','gastos'].includes(norm(s.name)))){
      const sales=norm(sheet.name)==='ingresos';const rows=[...new Set([...sheet.cells.keys()].map(a=>cellParts(a)[1]).filter(r=>r>=2))].sort((a,b)=>a-b);let missing=0;
      for(const r of rows){const get=(col:string)=>sheet.cells.get(`${col}${r}`)?.value??'';const concept=get(sales?'G':'D');if(!concept)continue;
        const base=numeric(get(sales?'J':'G')),tax=numeric(get(sales?'K':'J')),gross=numeric(get(sales?'L':'K'));if(base===null||new Decimal(base).lte(0)||tax===null||gross===null){missing++;continue;}
        const discountedBase=new Decimal(base).minus(sales?0:numeric(get('H'))??0);const rate=discountedBase.isZero()?new Decimal(0):new Decimal(tax).div(discountedBase);
        const simpleVat=['0','0.08','0.16'].find(v=>rate.minus(v).abs().lte('0.00001'));
        if(simpleVat===undefined||discountedBase.plus(tax).minus(gross).abs().gt('0.02')){missing++;continue;}
        const iso=excelDate(get('A'),p.period,book.date1904);
        if(!iso){missing++;continue;}
        const invoiceId=sales?get('E').toUpperCase():undefined;
        if(invoiceId&&p.operations.some(o=>o.invoiceId===invoiceId))continue;
        const payment=norm(get(sales?'M':'L'));const credit=/credito|ppd/.test(`${payment} ${norm(get('N'))}`);
        const quantity=sales?numeric(get('H')):undefined;
        const productId=sales&&/cemento/.test(norm(concept))?(/25/.test(concept)?'CEMENTO_25KG':/50/.test(concept)?'CEMENTO_50KG':undefined):undefined;
        result.operations.push({id:id(),date:iso,type:sales?'sale':'expense',description:concept.slice(0,400),amount:discountedBase.toFixed(2),vatRate:simpleVat,paymentMethod:credit?'credit':/efectivo|cash/.test(payment)?'cash':'bank',productId,quantity:quantity??undefined,invoiceId,sourceIds:[document.id],confirmed:false,taxDeductible:false});
      }
      if(missing)result.issues.push(issue('SOURCE_ROWS_PENDING',`${sheet.name}: registros que requieren captura`,`${missing} conceptos no tienen base/impuesto/total inequívocos o contienen impuestos mixtos. Se conserva su texto sin convertirlos en ceros.`, 'Completa o desglosa cada operación con las instrucciones del ejercicio.',document.id));
    }
  }
  // Reimport ContaEZ journal opening/manual entries without importing generated operation entries twice.
  const journal=book.sheets.find(s=>norm(s.name)==='diario');
  if(journal&&norm(journal.cells.get('C4')?.value??'')==='codigo'){
    const groups=new Map<string,JournalEntry>();for(const c of journal.cells.values())if(c.address.startsWith('I')){const r=cellParts(c.address)[1];if(r<5||!c.value||journal.cells.get(`J${r}`)?.value)continue;const code=journal.cells.get(`C${r}`)?.value??'';if(!p.accounts.some(a=>a.code===code))continue;
      const entry=groups.get(c.value)??{id:c.value,date:journal.cells.get(`A${r}`)?.value||`${p.period}-01`,kind:'opening' as const,concept:journal.cells.get(`E${r}`)?.value||'Asiento importado',sourceIds:[document.id],lines:[]};entry.lines.push({id:id(),accountCode:code,debit:numeric(journal.cells.get(`G${r}`)?.value??'')??'0',credit:numeric(journal.cells.get(`H${r}`)?.value??'')??'0'});groups.set(c.value,entry);
    }result.entries.push(...[...groups.values()].filter(e=>!p.manualEntries.some(x=>x.id===e.id)));
  }
  document.text=book.sheets.map(s=>`${s.name}: ${[...s.cells.values()].filter(c=>c.type==='s'||c.type==='inlineStr').slice(0,200).map(c=>`${c.address} ${c.value}`).join(' | ')}`).join('\n').slice(0,100_000);
  result.issues.push(issue('WORKBOOK_MAPPING','Libro recibido y revisado',result.operations.length?`${result.operations.length} operaciones propuestas; requieren confirmación.`:'La estructura no es una tabla de operaciones ContaEZ. El diagnóstico está disponible; sus cifras no se incorporaron automáticamente al diario.','Revisa la copia reparada y confirma los datos mediante captura o el chat. No se usará una respuesta posiblemente equivocada como enunciado.',document.id,'info'));
}
export async function importFile(file:File,p:Project):Promise<ImportResult>{
  if(file.size>80_000_000)throw new Error('El archivo supera el límite de 80 MB.');const bytes=new Uint8Array(await file.arrayBuffer());const digest=await crypto.subtle.digest('SHA-256',bytes);const hash=[...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
  const document:SourceDocument={id:id(),name:file.name,mime:file.type||'application/octet-stream',hash,importedAt:new Date().toISOString(),status:'pending'};
  const result:ImportResult={documents:[document],operations:[],entries:[],bankTransactions:[],issues:[]};
  if(p.documents.some(d=>d.hash===hash)){document.status='duplicate';result.issues.push(issue('DUPLICATE_FILE','Archivo ya importado','Su contenido coincide exactamente con un documento existente.','Se conserva como duplicado; no se agregan operaciones.',document.id));return result;}
  const ext=file.name.split('.').at(-1)?.toLowerCase();
  if(ext==='xlsx'||ext==='xlsm'){await importExcel(bytes,p,document,result);return result;}
  const text=new TextDecoder().decode(bytes);
  if(ext==='xml'){const parsed=parseCfdi(text,p,document);result.operations=parsed.operations;result.issues=parsed.issues;return result;}
  if(ext==='csv'||ext==='tsv'){importCsv(text,p,document,result);return result;}
  if(ext==='pdf'){
    try{const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs');const worker=await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url');pdfjs.GlobalWorkerOptions.workerSrc=worker.default;const loading=pdfjs.getDocument({data:bytes,useSystemFonts:true});const pdf=await loading.promise;const pages:string[]=[];const max=Math.min(pdf.numPages,40);for(let i=1;i<=max;i++){const page=await pdf.getPage(i);const content=await page.getTextContent();pages.push(content.items.map(item=>'str'in item?item.str:'').join(' '));}document.text=pages.join('\n').slice(0,100_000);await loading.destroy();result.issues.push(issue('PDF_CONFIRM','PDF leído; falta confirmar datos',document.text.trim()?`Texto extraído de ${max} páginas${max<pdf.numPages?' (lectura inicial limitada a 40 páginas)':''}.`:'El PDF parece escaneado y no contiene texto extraíble.','Confirma fechas, importes y operaciones mediante captura o chat; para un PDF escaneado adjunta sus páginas como imagen.',document.id));}catch(error){result.issues.push(issue('PDF_READ','PDF pendiente de lectura',error instanceof Error?error.message:String(error),'Usa un PDF sin contraseña o adjunta la página como imagen.',document.id));}return result;
  }
  if(file.type.startsWith('image/')||['png','jpg','jpeg','webp','bmp'].includes(ext??'')){
    try{const {createWorker,OEM}=await import('tesseract.js');const assets=new URL('./ocr/',globalThis.document.baseURI).href.replace(/\/$/,'');const worker=await createWorker('spa',OEM.LSTM_ONLY,{workerPath:`${assets}/worker.min.js`,corePath:assets,langPath:assets,workerBlobURL:false,gzip:true});try{const response=await worker.recognize(file);document.text=response.data.text;}finally{await worker.terminate();}result.issues.push(issue('OCR_CONFIRM','Texto reconocido; necesita confirmación',document.text?.slice(0,500)||'No se identificó texto suficiente.','Verifica importes y fechas. El reconocimiento usa los recursos incluidos con la app; las operaciones no se inventan.',document.id));}catch(error){result.issues.push(issue('OCR_PENDING','Imagen conservada como evidencia',error instanceof Error?error.message:String(error),'Verifica que el paquete OCR local esté instalado. Puedes capturar los datos manualmente sin IA.',document.id));}return result;
  }
  if(['txt','json','md'].includes(ext??'')){document.text=text.slice(0,100_000);result.issues.push(issue('TEXT_CONFIRM','Información adjunta','Se conserva el texto como evidencia del proyecto.','Indica los datos relevantes mediante el chat o captura manual.',document.id,'info'));return result;}
  result.issues.push(issue('UNSUPPORTED_FILE','Formato no compatible',`No se interpreta el formato .${ext??'desconocido'}.`,'Usa XLSX, XML CFDI, CSV, PDF, imagen o texto.',document.id));return result;
}
