import { useRef, useState } from 'react';
import { ArrowDownToLine, BookOpen, FileSpreadsheet, ListChecks, Upload } from 'lucide-react';
import { exportBytes } from './platform';
import type { PracticeCompletion } from './io/completePractice';
import './practice-completion.css';

export default function PracticeCompletionPanel({ reviewedFile }: { reviewedFile?: { name: string; data: () => Uint8Array } }) {
  const input = useRef<HTMLInputElement>(null);
  const actionInProgress = useRef(false);
  const [file, setFile] = useState<File | null>(null);
  const [outputName, setOutputName] = useState('ContaEZ');
  const [result, setResult] = useState<PracticeCompletion | null>(null);
  const [working, setWorking] = useState('');
  const [error, setError] = useState('');

  async function run(label: string, task: () => Promise<void>) {
    if (actionInProgress.current) return;
    actionInProgress.current = true;
    setError('');
    setWorking(label);
    try {
      await task();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setWorking('');
      actionInProgress.current = false;
    }
  }

  function template(example: boolean) {
    return run('Preparando Excel…', async () => {
      const { createPracticeCompletionTemplate } = await import('./io/completePractice');
      await exportBytes(await createPracticeCompletionTemplate(example), example ? 'ContaEZ-Ejemplo-practica.xlsx' : 'ContaEZ-Plantilla-practica.xlsx');
    });
  }

  function selectFile(next: File | undefined) {
    if (!next || actionInProgress.current) return;
    setResult(null);
    if (!/\.xlsx$/i.test(next.name) || next.name.startsWith('~$') || !next.size || next.size > 15 * 1024 * 1024) {
      setFile(null);
      setError('Elige un libro .xlsx de hasta 15 MB.');
      return;
    }
    setError('');
    setFile(next);
  }

  function generate(source: { name: string; read: () => Promise<Uint8Array> }) {
    void run('Generando la práctica…', async () => {
      setResult(null);
      const { completePracticeWorkbook } = await import('./io/completePractice');
      setResult(await completePracticeWorkbook(await source.read()));
      setOutputName(source.name.replace(/\.xlsx$/i, ''));
    });
  }

  return <section className="completion-panel" id="completar-practica" aria-labelledby="completion-heading">
    <div className="completion-intro">
      <span className="completion-icon"><ListChecks size={23} aria-hidden="true" /></span>
      <div><h2 id="completion-heading">Generar una práctica completa</h2>
        <p>Tu diario y catálogo son el punto de partida. ContaEZ prepara las cuentas T, el mayor, la balanza de comprobación, el estado de resultados y el balance general.</p></div>
    </div>
    <details>
      <summary>Preparar mi Excel y generar los reportes</summary>
      <ol className="completion-steps">
        <li><strong>Descarga la plantilla.</strong> También puedes abrir el ejemplo para ver qué datos necesita.</li>
        <li><strong>Completa el diario y el catálogo.</strong> Captura el debe, el haber, los grupos y los saldos de apertura, incluso si son cero.</li>
        <li><strong>Sube el Excel.</strong> Una vez validado, podrás descargar el mismo libro con los reportes vinculados en hojas nuevas.</li>
      </ol>
      <div className="completion-actions">
        <button className="student-button secondary" disabled={!!working} onClick={() => void template(false)}><ArrowDownToLine size={16} /> Plantilla</button>
        <button className="student-button secondary" disabled={!!working} onClick={() => void template(true)}><ArrowDownToLine size={16} /> Descargar ejemplo</button>
        <button className="student-button secondary" disabled={!!working} onClick={() => generate({ name: 'ContaEZ-Ejemplo', read: async () => {
          const { createPracticeCompletionTemplate } = await import('./io/completePractice');
          return createPracticeCompletionTemplate(true);
        } })}><BookOpen size={16} /> Probar con el ejemplo</button>
      </div>
      <div className="completion-file">
        <input ref={input} hidden type="file" accept=".xlsx" aria-label="Seleccionar Excel para completar la práctica" onChange={event => { selectFile(event.target.files?.[0]); event.target.value = ''; }} />
        <button className="student-button secondary" disabled={!!working} onClick={() => input.current?.click()}><Upload size={16} /> Elegir Excel</button>
        {file && <span><FileSpreadsheet size={16} /> {file.name}</span>}
        <button className="student-button primary" disabled={!file || !!working} onClick={() => file && generate({ name: file.name, read: async () => new Uint8Array(await file.arrayBuffer()) })}>Generar mi práctica</button>
        {reviewedFile && <button className="student-button secondary" disabled={!!working} onClick={() => generate({ name: reviewedFile.name, read: async () => reviewedFile.data() })}>Usar esta copia revisada</button>}
      </div>
      {working && <p role="status">{working}</p>}
      {error && <p className="completion-error" role="alert">{error}</p>}
      {result && <div className="completion-result" aria-live="polite">
        <h3>Tu práctica está lista</h3>
        <p>{result.entries} asientos · {result.accounts} cuentas. Los reportes recalculan al cambiar los importes. Si agregas filas o cambias códigos, genera el libro de nuevo.</p>
        <ul>{result.reports.map(name => <li key={name}>{name}</li>)}</ul>
        <dl className="completion-totals">
          {([['Activo', result.totals.assets], ['Pasivo', result.totals.liabilities], ['Capital con resultado', result.totals.equity], ['Resultado', result.totals.profit]] as const).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(Number(value))}</dd></div>)}
        </dl>
        <button className="student-button primary" disabled={!!working} onClick={() => void run('Preparando descarga…', () => exportBytes(result.data, `${outputName}__practica_completa.xlsx`))}><ArrowDownToLine size={16} /> Descargar práctica completa</button>
      </div>}
    </details>
  </section>;
}
