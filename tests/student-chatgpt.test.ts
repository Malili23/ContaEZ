import { describe, expect, it } from 'vitest';
import { buildStudentConsultation } from '../src/StudentChatGPT';

describe('Consulta opcional de una práctica', () => {
  it('incluye solo la pregunta escrita y el tipo y dirección de la observación elegida', () => {
    const finding = {
      id: 'interno', code: 'BROKEN_REFERENCE', cell: 'c2',
      sheet: 'Cliente privado', message: 'Factura 4000.00', replacement: 'Privada!A1',
      attachments: ['CFDI con datos privados'],
    };
    const consultation = buildStudentConsultation(' ¿Cómo confirmo el total?  ', finding);
    expect(consultation).toEqual({
      question: '¿Cómo confirmo el total?',
      context: 'Práctica de contabilidad mexicana revisada en Excel.\nObservación: Referencia eliminada.\nCelda: C2.\nExplica el procedimiento y los datos que necesito para verificar el resultado.',
    });
  });

  it('omite una dirección inválida y el texto de un código desconocido', () => {
    const result = buildStudentConsultation('¿Qué falta?', {
      id: 'interno', code: 'Información que no debe salir', cell: 'A2 con información del libro',
    });
    expect(result.context).toContain('Observación: Observación de la revisión.');
    expect(result.context).not.toContain('A2');
    expect(result.context).not.toContain('Información');
  });
});
