import Decimal from 'decimal.js';
import ExcelJS from 'exceljs';
import { appendWorksheetXml, cellParts, columnName, escapeXml, readRawWorkbook, writeRawWorkbook, type RawCell, type RawSheet } from './workbook';

const descriptions = ['Activo', 'Pasivo', 'Capital', 'Ingreso', 'Costo', 'Gasto'] as const;
type Group = typeof descriptions[number];
const columns = {
  journal: ['Asiento', 'Fecha', 'Código', 'Cuenta', 'Debe', 'Haber'],
  catalog: ['Código', 'Cuenta', 'Grupo', 'Apertura debe', 'Apertura haber'],
};
const names = {
  mayor: 'ContaEZ · Mayor',
  accountsT: 'ContaEZ · Cuentas T',
  trial: 'ContaEZ · Balanza',
  results: 'ContaEZ · Resultados',
  balance: 'ContaEZ · Balance',
  control: 'ContaEZ · Control',
};
const note = 'Las fórmulas se actualizan al cambiar importes. Para agregar filas o cambiar códigos, fechas o grupos, vuelve a generar desde el Excel de entrada.';
const zero = new Decimal(0);
const accountLimit = 500;
const journalLimit = 5000;

export interface PracticeCompletion {
  data: Uint8Array;
  entries: number;
  accounts: number;
  reports: string[];
  totals: { debit: string; credit: string; profit: string; assets: string; liabilities: string; equity: string };
}

interface Account {
  row: number;
  code: string;
  name: string;
  group: Group;
  debit: Decimal;
  credit: Decimal;
  lines: Line[];
}
interface Line { row: number; id: string; date: string; debit: Decimal; credit: Decimal; }
interface Table { sheet: RawSheet; indices: number[]; rows: number[]; }
interface Formula { expression: string; value: Decimal | string; }
type Cell = string | Decimal | Formula | undefined;
const normalized = (value: string) => value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim().replace(/\s+/g, ' ');
const quote = (name: string) => `'${name.replace(/'/g, "''")}'`;
const range = (column: string, first: number, last: number) => `${column}${first}:${column}${last}`;
const formula = (expression: string, value: Decimal | string): Formula => ({ expression, value });

function table(sheet: RawSheet, headers: string[], limit: number): Table {
  const expected = headers.map(normalized);
  const rows = new Map<number, RawCell[]>();
  for (const cell of sheet.cells.values()) {
    if (!cell.formula && !cell.value.trim()) continue;
    const [, row] = cellParts(cell.address);
    if (!row) continue;
    const prior = rows.get(row);
    if (prior) prior.push(cell); else rows.set(row, [cell]);
  }
  const possible = [...rows.entries()].filter(([row, cells]) => row <= 25 && expected.every(label => cells.some(cell => !cell.formula && normalized(cell.value) === label)));
  if (possible.length !== 1) throw new Error(`En «${sheet.name}» se necesita un encabezado con ${headers.join(', ')}. Descarga la plantilla para ver el formato.`);
  const [[header, cells]] = possible;
  const indices = expected.map(label => {
    const matches = cells.filter(cell => !cell.formula && normalized(cell.value) === label);
    if (matches.length !== 1) throw new Error(`«${sheet.name}» tiene dos columnas llamadas ${label}. Usa una sola.`);
    return cellParts(matches[0].address)[0];
  });
  const dataRows = [...rows.entries()].filter(([row, list]) => row > header && list.some(cell => indices.includes(cellParts(cell.address)[0]))).map(([row]) => row).sort((a,b) => a-b);
  if (!dataRows.length) throw new Error(`«${sheet.name}» está vacía. Completa los datos de entrada y vuelve a cargar el Excel.`);
  if (dataRows.length > limit) throw new Error(`«${sheet.name}» supera el límite de ${limit} filas para generar esta práctica.`);
  return { sheet, indices, rows: dataRows };
}

function source(table: Table, column: number, row: number): string {
  return `${quote(table.sheet.name)}!$${columnName(table.indices[column])}$${row}`;
}

function input(table: Table, column: number, row: number): RawCell | undefined {
  const address = `${columnName(table.indices[column])}${row}`;
  const cell = table.sheet.cells.get(address);
  if (cell && (cell.formula !== undefined || cell.type === 'e' || cell.type === 'b')) throw new Error(`${table.sheet.name}!${address} debe contener un dato confirmado, sin fórmulas, errores ni valores lógicos.`);
  return cell;
}

function text(table: Table, column: number, row: number, label: string): string {
  const cell = input(table, column, row);
  const value = cell?.value ?? '';
  if (!value || value !== value.trim() || value.length > 140 || /[\u0000-\u001f]/.test(value)) throw new Error(`${table.sheet.name}, fila ${row}: completa ${label} sin espacios al inicio o al final.`);
  return value;
}

function amount(table: Table, column: number, row: number, required: boolean): Decimal {
  const cell = input(table, column, row);
  if (!cell?.value.trim() && !required) return zero;
  if (!cell || cell.type !== 'n' || !/^(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?$/i.test(cell.value)) throw new Error(`${table.sheet.name}!${cell?.address ?? `${columnName(table.indices[column])}${row}`}: captura un número positivo o cero. Para confirmar que no hay saldo inicial, escribe 0.`);
  const value = new Decimal(cell.value);
  if (!value.isFinite() || value.decimalPlaces() > 2 || value.gte(10 ** 12)) throw new Error(`${table.sheet.name}!${cell.address}: usa un importe menor a un billón y con máximo dos decimales.`);
  return value;
}

function date(table: Table, row: number, date1904: boolean): string {
  const cell = input(table, 1, row);
  let value = cell?.value ?? '';
  if (cell?.type === 'n' && /^\d+$/.test(value)) {
    const serial = Number(value);
    if (serial >= (date1904 ? 0 : 61) && serial <= 2_950_000) {
      const epoch = date1904 ? Date.UTC(1904,0,1) : Date.UTC(1899,11,30);
      value = new Date(epoch + serial * 86_400_000).toISOString().slice(0,10);
    }
  } else if (cell?.type === 'd') value = value.replace(/T00:00:00(?:\.0+)?Z$/, '');
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(parsed.valueOf()) || parsed.toISOString().slice(0,10) !== value) throw new Error(`${table.sheet.name}, fila ${row}: indica una fecha válida (AAAA-MM-DD).`);
  return value;
}

function sum(values: Decimal[]): Decimal { return values.reduce((total, value) => total.plus(value), zero); }
function withTotal(rows: Cell[][], label: string, first: number, columns: [number, Decimal][]): number {
  const last = rows.length;
  const row: Cell[] = [label];
  for (const [index, value] of columns) {
    const column = columnName(index);
    row[index - 1] = formula(`ROUND(SUM(${range(column, first, last)}),2)`,value);
  }
  return rows.push(row);
}

function sheetXml(rows: Cell[][], widths: number[]): string {
  const content = rows.map((row,i) => `<row r="${i+1}">${row.map((value,j) => {
    if (value === undefined) return '';
    const address = `${columnName(j+1)}${i+1}`;
    if (typeof value === 'string') return `<c r="${address}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
    if (value instanceof Decimal) return `<c r="${address}"><v>${value.toFixed(2)}</v></c>`;
    const numeric = value.value instanceof Decimal;
    return `<c r="${address}"${numeric ? '' : ' t="str"'}><f>${escapeXml(value.expression)}</f><v>${escapeXml(numeric ? (value.value as Decimal).toFixed(2) : value.value)}</v></c>`;
  }).join('')}</row>`).join('');
  const sizes = widths.map((width,i) => `<col min="${i+1}" max="${i+1}" width="${width}" customWidth="1"/>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${columnName(widths.length)}${rows.length}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="4" topLeftCell="A5" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="18"/><cols>${sizes}</cols><sheetData>${content}</sheetData></worksheet>`;
}

export async function createPracticeCompletionTemplate(withExample = false): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'ContaEZ · @betcover_ii';
  const instructions = workbook.addWorksheet('Instrucciones');
  instructions.getColumn(1).width = 105;
  for (const message of [
    'Completar práctica de contabilidad · ContaEZ México',
    '1. En Catálogo, registra cada código una sola vez y elige su grupo contable.',
    '2. Captura ambos saldos de apertura. Si una cuenta inicia en cero, escribe 0 en sus dos columnas.',
    '3. En Diario, registra cada partida con asiento, fecha, código y nombre de la cuenta. Usa un solo lado por partida.',
    '4. Cada asiento debe tener el mismo total en Debe y Haber. Las fechas deben pertenecer a un mismo mes.',
    '5. Guarda como .xlsx y súbelo a Completar una práctica en ContaEZ.',
    'En registros con IVA, inventarios, depreciación o ajustes, agrega sus partidas ya calculadas dentro del Diario.',
    withExample ? 'Este libro contiene una apertura y movimientos de ejemplo. Sustitúyelos por los de tu práctica o descarga la plantilla vacía.' : 'La plantilla está vacía. Escribe los datos de tu ejercicio en las hojas Diario y Catálogo.',
  ]) instructions.addRow([message]);
  const journal = workbook.addWorksheet('Diario');
  const catalog = workbook.addWorksheet('Catálogo');
  for (const [sheet, headers, widths] of [[journal, columns.journal, [20,16,20,46,19,19]],[catalog, columns.catalog,[20,46,18,21,21]]] as const) {
    sheet.columns = headers.map((header,i) => ({header, width: widths[i]}));
    sheet.getRow(1).font = {bold:true,color:{argb:'FFFFFFFF'}};
    sheet.getRow(1).fill = {type:'pattern',pattern:'solid',fgColor:{argb:'FF17533D'}};
    sheet.views = [{state:'frozen',ySplit:1}];
  }
  journal.getColumn('A').numFmt = '@'; journal.getColumn('B').numFmt = 'yyyy-mm-dd'; journal.getColumn('C').numFmt = '@';
  catalog.getColumn('A').numFmt = '@';
  if (withExample) {
    catalog.addRows([['100','Bancos','Activo',1000,0],['200','Proveedores','Pasivo',0,0],['300','Capital social','Capital',0,1000],['400','Ventas','Ingreso',0,0],['500','Costo de ventas','Costo',0,0],['600','Gastos de administración','Gasto',0,0],['110','Almacén','Activo',0,0]]);
    journal.addRows([['1','2026-01-05','110','Almacén',300,0],['1','2026-01-05','200','Proveedores',0,300],['2','2026-01-08','100','Bancos',500,0],['2','2026-01-08','400','Ventas',0,500],['2','2026-01-08','500','Costo de ventas',200,0],['2','2026-01-08','110','Almacén',0,200],['3','2026-01-11','600','Gastos de administración',80,0],['3','2026-01-11','100','Bancos',0,80]]);
  }
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

export async function completePracticeWorkbook(data: Uint8Array): Promise<PracticeCompletion> {
  const book = readRawWorkbook(data);
  const journalSheet = book.sheets.find(sheet => normalized(sheet.name) === 'diario');
  const catalogSheet = book.sheets.find(sheet => normalized(sheet.name) === 'catalogo');
  if (!journalSheet || !catalogSheet) throw new Error('Se necesitan las hojas Diario y Catálogo. Usa la plantilla o añade esas dos tablas a tu práctica.');
  const reports = Object.values(names);
  if (book.sheets.some(sheet => reports.some(name => normalized(name) === normalized(sheet.name)))) throw new Error('Este Excel ya contiene hojas de una práctica completa. Para regenerar los reportes, abre la copia de entrada que guardaste antes de generarlos.');
  const catalog = table(catalogSheet, columns.catalog, accountLimit);
  const journal = table(journalSheet, columns.journal, journalLimit);
  const accounts = new Map<string, Account>();
  for (const row of catalog.rows) {
    const code = text(catalog,0,row,'el código');
    const name = text(catalog,1,row,'la cuenta');
    const groupText = text(catalog,2,row,'el grupo').toLowerCase();
    const group = descriptions.find(item => item.toLowerCase() === groupText);
    if (!group) throw new Error(`Catálogo, fila ${row}: usa el grupo Activo, Pasivo, Capital, Ingreso, Costo o Gasto.`);
    const debit = amount(catalog,3,row,true);
    const credit = amount(catalog,4,row,true);
    if (debit.gt(0) && credit.gt(0)) throw new Error(`Catálogo, fila ${row}: anota el saldo de apertura de ${code} en un solo lado.`);
    if ((group === 'Ingreso' || group === 'Costo' || group === 'Gasto') && debit.plus(credit).gt(0)) throw new Error(`Catálogo, fila ${row}: ${name} es una cuenta de resultados. Captura su ajuste o movimiento en el Diario.`);
    if (accounts.has(code.toLowerCase())) throw new Error(`Catálogo, fila ${row}: el código ${code} está repetido.`);
    accounts.set(code.toLowerCase(),{row,code,name,group,debit,credit,lines:[]});
  }
  const list = [...accounts.values()];
  const openingDebit = sum(list.map(account => account.debit));
  const openingCredit = sum(list.map(account => account.credit));
  if (!openingDebit.eq(openingCredit)) throw new Error(`La apertura no cuadra: Debe ${openingDebit.toFixed(2)}, Haber ${openingCredit.toFixed(2)}. Confirma los saldos iniciales en Catálogo.`);
  const entries = new Map<string,{date:string;lines:Line[]}>();
  let period = '';
  for (const row of journal.rows) {
    const id = text(journal,0,row,'el número de asiento');
    const day = date(journal,row,!!book.date1904);
    const code = text(journal,2,row,'el código de cuenta');
    const account = accounts.get(code.toLowerCase());
    if (!account) throw new Error(`Diario, fila ${row}: el código ${code} no existe en Catálogo.`);
    if (normalized(text(journal,3,row,'la cuenta')) !== normalized(account.name)) throw new Error(`Diario, fila ${row}: la cuenta no coincide con el código ${code} en Catálogo (${account.name}).`);
    if (period && day.slice(0,7) !== period) throw new Error('El Diario contiene fechas de más de un mes. Genera una práctica por periodo con su apertura correspondiente.');
    period = day.slice(0,7);
    const debit = amount(journal,4,row,false), credit = amount(journal,5,row,false);
    if (debit.gt(0) === credit.gt(0)) throw new Error(`Diario, fila ${row}: registra un importe en Debe o Haber, en un solo lado.`);
    const line = {row,id,date:day,debit,credit};
    const prior = entries.get(id);
    if (prior && prior.date !== day) throw new Error(`El asiento ${id} tiene fechas diferentes. Verifica su número y fecha.`);
    if (prior) prior.lines.push(line); else entries.set(id,{date:day,lines:[line]});
    account.lines.push(line);
  }
  let debit = zero, credit = zero;
  for (const [id,entry] of entries) {
    const deb = sum(entry.lines.map(line => line.debit));
    const cre = sum(entry.lines.map(line => line.credit));
    if (!deb.eq(cre)) throw new Error(`El asiento ${id} no cuadra: Debe ${deb.toFixed(2)}, Haber ${cre.toFixed(2)}. Corrige sus partidas en Diario.`);
    debit = debit.plus(deb); credit = credit.plus(cre);
  }
  if (debit.plus(openingDebit).gte(10 ** 13)) throw new Error('La práctica supera el total permitido para conservar la precisión de centavos en Excel.');

  const heading = (title: string, labels: string[]): Cell[][] => [[`${title} · ${period} · MXN`],[note],[],labels];
  const mayor = heading('Mayor por cuenta', ['Código','Cuenta','Asiento','Fecha','Tipo','Debe','Haber','Saldo neto']);
  const accountsT = heading('Esquemas de mayor · cuentas T',['Asiento','Debe','Cuenta','Haber','Asiento']);
  const trial = heading('Balanza de comprobación',['Código','Cuenta','Grupo','Apertura debe','Apertura haber','Movimiento debe','Movimiento haber','Saldo deudor','Saldo acreedor']);
  const sourceRows = new Map<number, number>();
  const totalsByGroup = new Map<Group, Decimal>();
  const finalDebits: Decimal[] = [], finalCredits: Decimal[] = [];
  for (const account of list) {
    const codeSource = source(catalog,0,account.row);
    const nameSource = source(catalog,1,account.row);
    const openingRow = mayor.length+1;
    let net = account.debit.minus(account.credit);
    mayor.push([formula(`${codeSource}&""`,account.code),formula(nameSource,account.name),undefined,undefined,'Apertura',formula(source(catalog,3,account.row),account.debit),formula(source(catalog,4,account.row),account.credit),formula(`ROUND(F${openingRow}-G${openingRow},2)`,net)]);
    accountsT.push([undefined,undefined,formula(nameSource,account.name)]);
    const tOpening = accountsT.push(['Apertura',formula(`${quote(names.mayor)}!F${openingRow}`,account.debit),'│',formula(`${quote(names.mayor)}!G${openingRow}`,account.credit),'Apertura']);
    for (const line of account.lines) {
      const row = mayor.length+1;
      net = net.plus(line.debit).minus(line.credit);
      const dateCell = source(journal,1,line.row);
      const dateFormula = `IF(ISNUMBER(${dateCell}),TEXT(${dateCell},"yyyy-mm-dd"),${dateCell})`;
      mayor.push([formula(`${source(journal,2,line.row)}&""`,account.code),formula(source(journal,3,line.row),account.name),formula(`${source(journal,0,line.row)}&""`,line.id),formula(dateFormula,line.date),'Movimiento',formula(source(journal,4,line.row),line.debit),formula(source(journal,5,line.row),line.credit),formula(`ROUND(H${row-1}+F${row}-G${row},2)`,net)]);
      sourceRows.set(line.row,row);
      const prefix = `${quote(names.mayor)}!`;
      accountsT.push([line.debit.gt(0)?formula(`${prefix}C${row}`,line.id):undefined,formula(`${prefix}F${row}`,line.debit),'│',formula(`${prefix}G${row}`,line.credit),line.credit.gt(0)?formula(`${prefix}C${row}`,line.id):undefined]);
    }
    const last = mayor.length;
    const movementDebit = sum(account.lines.map(line => line.debit));
    const movementCredit = sum(account.lines.map(line => line.credit));
    const endDebit = Decimal.max(0,net), endCredit = Decimal.max(0,net.negated());
    const total = withTotal(accountsT,'Totales',tOpening,[[2,account.debit.plus(movementDebit)],[4,account.credit.plus(movementCredit)]]);
    accountsT.push(['Saldo deudor',formula(`MAX(0,ROUND(B${total}-D${total},2))`,endDebit),'│',formula(`MAX(0,ROUND(D${total}-B${total},2))`,endCredit),'Saldo acreedor'],[]);
    const row = trial.length+1;
    const m = `${quote(names.mayor)}!`;
    const movement = (col: string) => account.lines.length ? `SUM(${m}${range(col,openingRow+1,last)})` : '0';
    trial.push([formula(`${codeSource}&""`,account.code),formula(nameSource,account.name),formula(source(catalog,2,account.row),account.group),formula(`${m}F${openingRow}`,account.debit),formula(`${m}G${openingRow}`,account.credit),formula(movement('F'),movementDebit),formula(movement('G'),movementCredit),formula(`MAX(0,ROUND(D${row}+F${row}-E${row}-G${row},2))`,endDebit),formula(`MAX(0,ROUND(E${row}+G${row}-D${row}-F${row},2))`,endCredit)]);
    finalDebits.push(endDebit); finalCredits.push(endCredit);
    totalsByGroup.set(account.group,(totalsByGroup.get(account.group) ?? zero).plus(net));
  }
  const trialLast = trial.length;
  const trialTotal = withTotal(trial,'Totales',5,[[4,openingDebit],[5,openingCredit],[6,debit],[7,credit],[8,sum(finalDebits)],[9,sum(finalCredits)]]);
  trial.push(['Diferencias',undefined,undefined,formula(`ROUND(D${trialTotal}-E${trialTotal},2)`,zero),undefined,formula(`ROUND(F${trialTotal}-G${trialTotal},2)`,zero),undefined,formula(`ROUND(H${trialTotal}-I${trialTotal},2)`,zero)]);
  const groupTotal = (group: Group, creditNature = false): Decimal => (totalsByGroup.get(group) ?? zero).times(creditNature ? -1 : 1);
  const groupFormula = (group:Group,creditNature = false) => {
    const prefix = `${quote(names.trial)}!`;
    const side = (col: string) => `SUMIF(${prefix}$C$5:$C$${trialLast},"${group}",${prefix}$${col}$5:$${col}$${trialLast})`;
    return `ROUND(${side(creditNature?'I':'H')}-${side(creditNature?'H':'I')},2)`;
  };
  const income = groupTotal('Ingreso',true), cost = groupTotal('Costo'), expense = groupTotal('Gasto');
  const profit = income.minus(cost).minus(expense);
  const assets = groupTotal('Activo'), liabilities = groupTotal('Pasivo',true), capital = groupTotal('Capital',true), equity = capital.plus(profit);
  const results = heading('Estado de resultados',['Concepto','Importe']);
  results.push(['Ingresos',formula(groupFormula('Ingreso',true),income)],['Costo de ventas',formula(groupFormula('Costo'),cost)],['Utilidad bruta',formula('ROUND(B5-B6,2)',income.minus(cost))],['Gastos',formula(groupFormula('Gasto'),expense)],['Resultado antes de impuestos',formula('ROUND(B7-B8,2)',profit)]);
  const balance = heading('Balance general',['Concepto','Importe']);
  balance.push(['Activo',formula(groupFormula('Activo'),assets)],['Pasivo',formula(groupFormula('Pasivo',true),liabilities)],['Capital antes del resultado',formula(groupFormula('Capital',true),capital)],['Resultado del periodo',formula(`${quote(names.results)}!B9`,profit)],['Capital al cierre',formula('ROUND(B7+B8,2)',equity)],['Pasivo más capital',formula('ROUND(B6+B9,2)',liabilities.plus(equity))],['Diferencia',formula('ROUND(B5-B10,2)',assets.minus(liabilities).minus(equity))]);
  const control = heading('Comprobación de asientos',['Asiento','Fecha','Debe','Haber','Diferencia']);
  for (const [id,entry] of entries) {
    const journalRows = entry.lines.map(line => sourceRows.get(line.row)!);
    const prefix = `${quote(names.mayor)}!`;
    const total = (col: string) => `ROUND(SUM(${journalRows.map(row => `${prefix}${col}${row}`).join(',')}),2)`;
    if (journalRows.length > 250) throw new Error(`El asiento ${id} supera 250 partidas. Divide sus partidas en asientos que cuadren individualmente.`);
    const first = journalRows[0];
    const row = control.length+1;
    control.push([formula(`${prefix}C${first}`,id),formula(`${prefix}D${first}`,entry.date),formula(total('F'),sum(entry.lines.map(line=>line.debit))),formula(total('G'),sum(entry.lines.map(line=>line.credit))),formula(`ROUND(C${row}-D${row},2)`,zero)]);
  }
  for (const row of control) for (const value of row) {
    if (value && typeof value === 'object' && 'expression' in value && value.expression.length > 7800) throw new Error('Hay demasiadas partidas en un asiento para enlazarlo en Excel. Divide sus partidas en asientos que cuadren individualmente.');
  }
  control.push([],['Alcance','Los asientos y saldos vienen de las tablas confirmadas. Los ajustes, IVA e inventarios deben estar registrados en el Diario.'],['Créditos','ContaEZ · @betcover_ii']);
  const output: [string, Cell[][], number[]][] = [
    [names.mayor,mayor,[16,42,18,16,17,18,18,20]], [names.accountsT,accountsT,[19,18,42,18,19]],
    [names.trial,trial,[16,40,18,19,19,22,22,19,19]], [names.results,results,[42,24]],
    [names.balance,balance,[42,24]], [names.control,control,[22,42,22,22,22]],
  ];
  for (const [name, rows, widths] of output) appendWorksheetXml(book,name,sheetXml(rows,widths));
  return {data:writeRawWorkbook(book),entries:entries.size,accounts:accounts.size,reports,totals:{debit:debit.toFixed(2),credit:credit.toFixed(2),profit:profit.toFixed(2),assets:assets.toFixed(2),liabilities:liabilities.toFixed(2),equity:equity.toFixed(2)}};
}
