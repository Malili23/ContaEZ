import Decimal from 'decimal.js';

export const MEXICO_NOTICE = 'ContaEZ está diseñada exclusivamente para contabilidad y obligaciones fiscales de México, dentro de los regímenes, ejercicios y módulos indicados.';
export interface RuleSource { id: string; title: string; issuer: string; url: string; reference: string; publication: string; effectiveFrom: string; status: 'current'|'future'|'project'|'licensed'; scope: string; }
export const RULE_SOURCES: RuleSource[] = [
  {id:'nif-2026',title:'NIF 2026',issuer:'CINIF',url:'https://cinif.org.mx/normatividad_NIF2026.php',reference:'Reconocimiento, valuación, presentación y revelación',publication:'2025-12-18',effectiveFrom:'2026-01-01',status:'licensed',scope:'Consulta autorizada; el texto íntegro no se redistribuye. El registro de una fuente no implica implementar íntegramente todas sus disposiciones.'},
  {id:'nif-2025-errata',title:'Aclaración editorial NIF 2025',issuer:'CINIF',url:'https://cinif.org.mx/uploads/Libro_NIF_2025-Aclaracion_editorial.pdf',reference:'A-2, C-9 y C-20',publication:'2025-03-28',effectiveFrom:'2026-01-01',status:'current',scope:'A-2 entra en vigor en ejercicios iniciados a partir de 2026.'},
  {id:'nif-b1-b3-2028',title:'Nuevas NIF B-1 y B-3',issuer:'CINIF',url:'https://www.cinif.org.mx/uploads/NIF_2026_Carta_PROMULGACION.pdf',reference:'Carta de promulgación',publication:'2025-12-18',effectiveFrom:'2028-01-01',status:'future',scope:'Aplicación anticipada permitida en 2027; no se activa en 2026.'},
  {id:'nif-mejoras-2027',title:'Proyecto Mejoras 2027',issuer:'CINIF',url:'https://cinif.org.mx/normatividad_nifenauscultacion.php',reference:'Auscultación',publication:'2026-01-01',effectiveFrom:'2027-01-01',status:'project',scope:'En seguimiento; no se aplica automáticamente.'},
  {id:'cff-2026',title:'Código Fiscal de la Federación',issuer:'Congreso de la Unión',url:'https://www.diputados.gob.mx/LeyesBiblio/pdf/CFF.pdf',reference:'Arts. 28, 29 y 29-A',publication:'2026-04-09',effectiveFrom:'2026-04-09',status:'current',scope:'Contabilidad, documentación soporte y comprobantes fiscales; vigencia de cada reforma sujeta a sus transitorios.'},
  {id:'rcff-33',title:'Reglamento del CFF',issuer:'Ejecutivo Federal',url:'https://www.diputados.gob.mx/LeyesBiblio/regley/Reg_CFF.pdf',reference:'Art. 33',publication:'2014-04-02',effectiveFrom:'2014-04-03',status:'current',scope:'Registros, catálogo, pólizas y documentación soporte.'},
  {id:'lisr-14-106',title:'Ley del Impuesto sobre la Renta',issuer:'Congreso de la Unión',url:'https://www.diputados.gob.mx/LeyesBiblio/pdf/LISR.pdf',reference:'Arts. 9, 14 y 106',publication:'2024-04-01',effectiveFrom:'2024-04-01',status:'current',scope:'Papel de trabajo provisional de régimen general PM y actividad empresarial/profesional PF; no incluye todos los ajustes, estímulos o tratamientos sectoriales.'},
  {id:'liva-1b-5',title:'Ley del Impuesto al Valor Agregado',issuer:'Congreso de la Unión',url:'https://www.ordenjuridico.gob.mx/Documentos/Federal/html/wo22.html',reference:'Arts. 1-B y 5',publication:'2021-11-12',effectiveFrom:'2022-01-01',status:'current',scope:'IVA efectivamente cobrado/pagado y requisitos de acreditamiento que requieren confirmación.'},
  {id:'rmf-4-2026',title:'Cuarta modificación RMF 2026',issuer:'SAT / DOF',url:'https://dof.gob.mx/nota_detalle.php?codigo=5802597&fecha=30/10/2026',reference:'Regla 2.8.1.6',publication:'2026-10-30',effectiveFrom:'2026-10-30',status:'current',scope:'Conservar versión de reglas y revisar obligaciones de envío según régimen.'},
  {id:'anexo24-2026',title:'Anexo 24 RMF 2026',issuer:'SAT / DOF',url:'https://www.sat.gob.mx/minisitio/NormatividadRMFyRGCE/documentos2026/rmf/anexos/Anexo_24_RMF2026-13012026.pdf',reference:'Contabilidad en medios electrónicos',publication:'2026-01-13',effectiveFrom:'2026-01-13',status:'current',scope:'Catálogo, balanza, pólizas y auxiliares; no confundir con Anexo 24 de RGCE.'},
  {id:'anexo8-2026',title:'Tarifas ISR 2026',issuer:'SAT / DOF',url:'https://sat.gob.mx/minisitio/NormatividadRMFyRGCE/documentos2026/rmf/anexos/Anexo-8-RMF-2026_DOF-28122025.pdf',reference:'Apartado B, VI; art. 106 LISR',publication:'2025-12-28',effectiveFrom:'2026-01-01',status:'current',scope:'Tarifas acumuladas enero-diciembre de actividad empresarial y profesional; no aplicar a RESICO ni a sueldos.'},
];
export const RULE_SET = { id: 'mx-2026-v1', jurisdiction: 'MX', reviewedAt: '2026-11-12', isrYear: 2026, sources: RULE_SOURCES.map(s=>s.id) };

// Datos normativos del Anexo 8, B.VI, publicados en DOF. En diciembre el SAT
// publica una tabla anual específica, que NO coincide exactamente con enero×12.
const january = [
  ['844.59','0','1.92'],['7168.51','16.22','6.40'],['12598.02','420.95','10.88'],
  ['14644.64','1011.68','16'],['17533.64','1339.14','17.92'],['35362.83','1856.84','21.36'],
  ['55736.68','5665.16','23.52'],['106410.50','10457.09','30'],['141880.66','25659.23','32'],
  ['425641.99','37009.69','34'],[null,'133488.54','35'],
] as const;
const december = [
  ['10135.11','0','1.92'],['86022.11','194.59','6.40'],['151176.19','5051.37','10.88'],
  ['175735.66','12140.13','16'],['210403.69','16069.64','17.92'],['424353.97','22282.14','21.36'],
  ['668840.14','67981.92','23.52'],['1276925.98','125485.07','30'],['1702567.97','307910.81','32'],
  ['5107703.92','444116.23','34'],[null,'1601862.46','35'],
] as const;
export interface TaxBracket { lower: string; upper: string|null; fixed: string; rate: string; }
export function getIsrBrackets(month: number): TaxBracket[] {
  if (!Number.isInteger(month) || month<1 || month>12) throw new Error('El mes fiscal debe estar entre 1 y 12.');
  let lastUpper = new Decimal(0);
  return (month===12 ? december : january).map((row)=>{
    const upper = row[0]===null ? null : new Decimal(row[0]).mul(month===12 ? 1 : month);
    const bracket = {lower:lastUpper.add('.01').toFixed(2), upper:upper?.toFixed(2)??null, fixed:new Decimal(row[1]).mul(month===12?1:month).toFixed(2),rate:new Decimal(row[2]).div(100).toString()};
    if(upper) lastUpper=upper;
    return bracket;
  });
}
export function calculateIndividualIsr(base: string, month: number): string {
  const amount = new Decimal(base).toDecimalPlaces(2,Decimal.ROUND_HALF_UP);
  if(amount.lte(0)) return '0.00';
  const bracket=getIsrBrackets(month).find(b=>b.upper===null || amount.lte(b.upper));
  if(!bracket) throw new Error('No se encontró el rango de ISR.');
  return amount.minus(bracket.lower).mul(bracket.rate).add(bracket.fixed).toDecimalPlaces(2,Decimal.ROUND_HALF_UP).toFixed(2);
}
