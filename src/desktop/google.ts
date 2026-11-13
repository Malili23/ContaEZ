import type { Project, ProcessingResult } from '../core/types';
import { isDesktop } from '../platform';

export interface GoogleCell { userEnteredValue?: { stringValue?: string; numberValue?: number; boolValue?: boolean; formulaValue?: string }; userEnteredFormat?: Record<string, unknown>; }
export function excelAddress(address: string): { row: number; column: number } {
  const match = /^\$?([A-Z]+)\$?(\d+)$/i.exec(address);
  if (!match) throw new Error(`Referencia no compatible: ${address}`);
  let column = 0; for (const ch of match[1].toUpperCase()) column = column * 26 + ch.charCodeAt(0) - 64;
  return { row: Number(match[2]) - 1, column: column - 1 };
}
export function googleValue(value: unknown, formula?: string): GoogleCell {
  if (formula) return { userEnteredValue: { formulaValue: formula.startsWith('=') ? formula : `=${formula}` } };
  if (typeof value === 'number') return Number.isFinite(value) ? { userEnteredValue: { numberValue: value } } : { userEnteredValue: { stringValue: 'Dato no disponible' } };
  if (typeof value === 'boolean') return { userEnteredValue: { boolValue: value } };
  if (value instanceof Date) return { userEnteredValue: { numberValue: (value.getTime() - Date.UTC(1899,11,30)) / 86400000 }, userEnteredFormat: { numberFormat: { type: 'DATE', pattern: 'dd/mm/yyyy' } } };
  if (value == null) return {};
  if (typeof value === 'object') {
    const v = value as Record<string, unknown>;
    if ('result' in v) return googleValue(v.result);
    if (Array.isArray(v.richText)) return { userEnteredValue: { stringValue: (v.richText as { text: string }[]).map(p => p.text).join('') } };
    if ('text' in v) return { userEnteredValue: { stringValue: String(v.text ?? '') } };
    if ('error' in v) return { userEnteredValue: { stringValue: String(v.error) } };
  }
  return { userEnteredValue: { stringValue: String(value) } };
}
export async function exportToGoogleSheets(project: Project, result: ProcessingResult, clientId: string): Promise<string> {
  if (!isDesktop()) throw new Error('La exportación a tu cuenta de Google requiere la aplicación de escritorio. También puedes descargar el Excel y abrirlo en Google Sheets.');
  if (!clientId.trim()) throw new Error('Configura un cliente OAuth de Google de tipo aplicación de escritorio. Puedes pegar su client ID o el JSON de credenciales de tu proyecto de Google Cloud.');
  const { buildWorkbook } = await import('../io');
  const workbook = await buildWorkbook(project, result);
  const sheets = workbook.worksheets.map((sheet, index) => {
    const rows: { values: GoogleCell[] }[] = [];
    sheet.eachRow({ includeEmpty: true }, row => {
      const values: GoogleCell[] = [];
      row.eachCell({ includeEmpty: true }, cell => {
        const value = googleValue(cell.value, cell.formula || undefined);
        if (row.number === 1) value.userEnteredFormat = { ...value.userEnteredFormat, textFormat: { bold: true }, backgroundColor: { red: 0.87, green: 0.94, blue: 0.91 } };
        if (value.userEnteredValue?.numberValue !== undefined && cell.numFmt && cell.numFmt !== 'General') {
          const pattern = cell.numFmt;
          const type = pattern.includes('%') ? 'PERCENT' : /[$€£]/.test(pattern) ? 'CURRENCY' : /^(yyyy|dd|mm|m\/d|d\/m)/i.test(pattern) ? 'DATE' : 'NUMBER';
          value.userEnteredFormat = { ...value.userEnteredFormat, numberFormat: { type, pattern } };
        }
        values[excelAddress(cell.address).column] = value;
      }); rows[row.number - 1] = { values };
    });
    const merges = (sheet.model.merges ?? []).map(range => {
      const [first,last] = range.split(':'); const start = excelAddress(first); const end = excelAddress(last ?? first);
      return { sheetId: index, startRowIndex: start.row, startColumnIndex: start.column, endRowIndex: end.row + 1, endColumnIndex: end.column + 1 };
    });
    return { properties: { sheetId: index, title: sheet.name, gridProperties: { rowCount: Math.max(100, sheet.rowCount + 5), columnCount: Math.max(12, sheet.columnCount + 1), frozenRowCount: 1 } }, merges, data: [{ startRow: 0, startColumn: 0, rowData: rows }] };
  });
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<string>('google_export', { clientConfig: clientId.trim(), title: `${project.name} · ${project.period} · ContaEZ`, sheets });
}
