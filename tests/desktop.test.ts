import { describe, expect, it } from 'vitest';
import { excelAddress, googleValue } from '../src/desktop/google';
describe('Exportación nativa y Google Sheets', () => {
  it('conserva fórmulas y mantiene texto importado como texto', () => {
    expect(googleValue(2, 'SUM(A1:A2)')).toEqual({ userEnteredValue: { formulaValue: '=SUM(A1:A2)' } });
    expect(googleValue('=HYPERLINK("https://example.com")')).toEqual({ userEnteredValue: { stringValue: '=HYPERLINK("https://example.com")' } });
    expect(googleValue({ richText: [{ text: 'IVA ' }, { text: 'pagado' }] })).toEqual({ userEnteredValue: { stringValue: 'IVA pagado' } });
  });
  it('interpreta referencias completas sin confundir columnas posteriores a Z', () => {
    expect(excelAddress('$AA$101')).toEqual({ row: 100, column: 26 });
    expect(() => excelAddress('A0:A1')).toThrow();
  });
});
