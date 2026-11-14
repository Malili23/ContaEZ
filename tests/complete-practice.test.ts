import ExcelJS from 'exceljs';
import { unzipSync } from 'fflate';
import { describe, expect, test } from 'vitest';
import { completePracticeWorkbook, createPracticeCompletionTemplate } from '../src/io/completePractice';
import { auditRawWorkbook } from '../src/io/audit';
import { readRawWorkbook } from '../src/io/workbook';

async function editExample(edit: (workbook: ExcelJS.Workbook) => void) {
  const workbook = new ExcelJS.Workbook();
  const example = await createPracticeCompletionTemplate(true);
  await workbook.xlsx.load(Buffer.from(example) as unknown as ExcelJS.Buffer);
  edit(workbook);
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

describe('contabilidad completa a partir de datos confirmados', () => {
  test('conserva el mismo libro y enlaza los seis reportes con importes comprobables', async () => {
    const input = await editExample(book => { book.addWorksheet('Notas de clase').getCell('A1').value = 'Conservar mi formato'; });
    const original = readRawWorkbook(input);
    const result = await completePracticeWorkbook(input);
    expect(result.entries).toBe(3);
    expect(result.accounts).toBe(7);
    expect(result.totals).toEqual({debit:'1080.00',credit:'1080.00',profit:'220.00',assets:'1520.00',liabilities:'300.00',equity:'1220.00'});
    const raw = readRawWorkbook(result.data);
    const parts = unzipSync(result.data);
    for (const sheet of original.sheets) expect(parts[sheet.path]).toEqual(original.files[sheet.path]);
    expect(parts['xl/styles.xml']).toEqual(original.files['xl/styles.xml']);
    expect(raw.sheets.map(sheet => sheet.name)).toEqual([...original.sheets.map(sheet => sheet.name), ...result.reports]);
    const byName = (name: string) => raw.sheets.find(sheet => sheet.name === `ContaEZ · ${name}`)!.cells;
    expect(byName('Mayor').get('F6')?.formula).toMatch(/^'Diario'!\$E\$/);
    expect(byName('Cuentas T').get('B7')?.formula).toBe("'ContaEZ · Mayor'!F6");
    expect(byName('Balanza').get('F5')?.formula).toBe("SUM('ContaEZ · Mayor'!F6:F7)");
    expect(byName('Resultados').get('B5')?.formula).toContain("'ContaEZ · Balanza'!");
    expect(byName('Balance').get('B8')?.formula).toBe("'ContaEZ · Resultados'!B9");
    expect(byName('Balance').get('B11')?.value).toBe('0.00');
    expect(byName('Control').get('E7')?.value).toBe('0.00');
    expect(auditRawWorkbook(raw,'contabilidad.xlsx').findings.some(item => item.severity === 'error')).toBe(false);
    const reopened = new ExcelJS.Workbook();
    await reopened.xlsx.load(Buffer.from(result.data) as unknown as ExcelJS.Buffer);
    expect(reopened.getWorksheet('ContaEZ · Resultados')!.getCell('B9').result).toBe(220);
    expect(reopened.getWorksheet('Notas de clase')!.getCell('A1').value).toBe('Conservar mi formato');
    await expect(completePracticeWorkbook(result.data)).rejects.toThrow('ya contiene');
  });

  test('requiere un catálogo y una apertura con ambos lados explícitos', async () => {
    const empty = await createPracticeCompletionTemplate();
    await expect(completePracticeWorkbook(empty)).rejects.toThrow('Catálogo» está vacía');
    const unknownOpening = await editExample(book => { book.getWorksheet('Catálogo')!.getCell('E2').value = null; });
    await expect(completePracticeWorkbook(unknownOpening)).rejects.toThrow('Para confirmar que no hay saldo inicial, escribe 0');
    const openingMismatch = await editExample(book => { book.getWorksheet('Catálogo')!.getCell('D2').value = 999; });
    await expect(completePracticeWorkbook(openingMismatch)).rejects.toThrow('La apertura no cuadra');
    const missingAccount = await editExample(book => { book.getWorksheet('Diario')!.getCell('C2').value = '999'; });
    await expect(completePracticeWorkbook(missingAccount)).rejects.toThrow('no existe en Catálogo');
  });

  test('verifica cada asiento por separado y rechaza fórmulas como importes de entrada', async () => {
    const offsetting = await editExample(book => {
      const diary = book.getWorksheet('Diario')!;
      diary.getCell('E2').value = 301;
      diary.getCell('E4').value = 499;
    });
    await expect(completePracticeWorkbook(offsetting)).rejects.toThrow('El asiento 1 no cuadra');
    const guessed = await editExample(book => { book.getWorksheet('Diario')!.getCell('E2').value = {formula:'100+200',result:300}; });
    await expect(completePracticeWorkbook(guessed)).rejects.toThrow('sin fórmulas');
  });

  test('lee las fechas de Excel Mac con calendario 1904', async () => {
    const mac = await editExample(book => {
      book.properties.date1904 = true;
      const diary = book.getWorksheet('Diario')!;
      for (let row=2;row<=9;row++) diary.getCell(`B${row}`).value = new Date(`${diary.getCell(`B${row}`).value}T00:00:00Z`);
    });
    const result = await completePracticeWorkbook(mac);
    const control = readRawWorkbook(result.data).sheets.find(sheet => sheet.name === 'ContaEZ · Control')!;
    expect(control.cells.get('B5')?.value).toBe('2026-01-05');
    expect(control.cells.get('B7')?.value).toBe('2026-01-11');
  });
});
