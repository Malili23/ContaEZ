import { useEffect, useId, useRef, useState } from 'react';
import { ArrowUpRight, Copy, Sparkles } from 'lucide-react';
import { askChatGPT, connectChatGPT, disconnectChatGPT, getChatGPTStatus, manageChatGPTUsage, type ChatGPTStatus } from './desktop/ai';
import type { WorkbookFinding } from './io/audit';
import { isDesktop, openExternal } from './platform';
import chatGPTLogo from './desktop/chatgpt-logo-black.svg';
import './student-chatgpt.css';

type Finding = Pick<WorkbookFinding, 'id' | 'code' | 'cell'>;

const issueLabels: Readonly<Record<string, string>> = {
  BROKEN_REFERENCE: 'Referencia eliminada',
  CIRCULAR_REFERENCE: 'Dependencia circular',
  SELF_REFERENCE: 'La fórmula se refiere a su propia celda',
  SELF_SUM: 'La suma incluye su propia celda',
  CACHED_ERROR: 'La celda contiene un resultado de error',
  HARDCODED_CHECK: 'Comprobación escrita como valor fijo',
  VAT_ON_GROSS: 'Posible cálculo de IVA sobre un total que ya lo incluye',
  PERIOD_CONFLICT: 'Periodos que no coinciden',
  EMPTY_REPORT: 'Reporte con importes en cero o sin completar',
  EXTERNAL_LINKS: 'Referencias a otros archivos',
};

function issueLabel(finding: Finding): string {
  return Object.hasOwn(issueLabels, finding.code) ? issueLabels[finding.code] : 'Observación de la revisión';
}

/** Keep document content out of automatically generated requests. */
export function buildStudentConsultation(question: string, finding?: Finding) {
  const context = ['Práctica de contabilidad mexicana revisada en Excel.'];
  if (finding) {
    context.push(`Observación: ${issueLabel(finding)}.`);
    if (/^[A-Z]{1,3}[1-9][0-9]{0,6}$/i.test(finding.cell)) context.push(`Celda: ${finding.cell.toUpperCase()}.`);
  }
  context.push('Explica el procedimiento y los datos que necesito para verificar el resultado.');
  return { question: question.trim(), context: context.join('\n') };
}

export default function StudentChatGPT({ findings }: { findings: Finding[] }) {
  const desktop = isDesktop();
  const questionId = useId();
  const issueId = useId();
  const previewId = useId();
  const [account, setAccount] = useState<ChatGPTStatus | null>(null);
  const [question, setQuestion] = useState('');
  const [selectedFinding, setSelectedFinding] = useState('');
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [answer, setAnswer] = useState('');
  const running = useRef(false);
  const findingsToChoose = findings.slice(0, 30);
  const finding = findingsToChoose.find(item => item.id === selectedFinding);
  const consultation = buildStudentConsultation(question, finding);
  const preview = `${consultation.question}\n\n${consultation.context}`;

  useEffect(() => {
    if (!desktop) return;
    let active = true;
    getChatGPTStatus().then(status => {
      if (active) setAccount(status);
    }).catch(() => {
      if (active) setAccount({ connected: false });
    });
    return () => { active = false; };
  }, [desktop]);

  async function run(label: string, action: () => Promise<void>) {
    if (running.current) return;
    running.current = true;
    setBusy(label);
    setNotice('');
    try {
      await action();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setNotice(detail || 'No se pudo completar la consulta. Puedes copiarla y abrir ChatGPT.');
    } finally {
      setBusy('');
      running.current = false;
    }
  }

  function clearResult() {
    setAnswer('');
    setNotice('');
  }

  return <details className="student-card student-chatgpt">
    <summary><Sparkles size={19} aria-hidden="true" /><span>Consultar con ChatGPT</span><small>Opcional</small></summary>
    <div className="student-chatgpt-body">
      <p>Haz una pregunta sobre una fórmula o un paso de tu práctica. Las respuestas sirven de orientación. Para aplicar una aclaración a tu Excel, usa el chat guiado.</p>
      {desktop && <div className="student-chatgpt-account">
        <div>
          <strong>{account?.connected ? 'Cuenta conectada' : 'Tu cuenta de ChatGPT'}</strong>
          <p>{account?.connected ? account.email : 'Conéctala desde el navegador si tu cuenta admite el uso del plan en la app. También puedes copiar la consulta.'}</p>
        </div>
        {account?.connected
          ? <button className="student-button secondary" type="button" disabled={!!busy} onClick={() => void run('Desconectando…', async () => {
            try { await disconnectChatGPT(); }
            finally { setAccount(await getChatGPTStatus()); }
            setNotice('Cuenta desconectada. Puedes seguir usando el chat guiado.');
          })}>Desconectar</button>
          : <button className="student-button secondary student-chatgpt-signin" type="button" disabled={!!busy || account === null} onClick={() => void run('Autoriza la conexión en el navegador y vuelve a esta ventana.', async () => {
            setAccount(await connectChatGPT());
            setNotice('Cuenta conectada. Las consultas enviadas desde aquí usarán tu plan de ChatGPT.');
          })}><img src={chatGPTLogo} width={18} height={18} alt="" />Continuar con ChatGPT</button>}
      </div>}
      <label htmlFor={questionId}>Tu pregunta para ChatGPT</label>
      <textarea id={questionId} rows={3} maxLength={3000} value={question} disabled={!!busy}
        placeholder="Ej. ¿Qué debo revisar cuando el saldo del mayor no coincide con la balanza?"
        onChange={event => { setQuestion(event.target.value); clearResult(); }} />
      {!!findingsToChoose.length && <>
        <label htmlFor={issueId}>Agregar una observación de revisión (opcional)</label>
        <select id={issueId} value={finding?.id || ''} disabled={!!busy}
          onChange={event => { setSelectedFinding(event.target.value); clearResult(); }}>
          <option value="">Pregunta sin observación adjunta</option>
          {findingsToChoose.map((item, index) => <option key={`${item.id}-${index}`} value={item.id}>
            {item.cell ? `${item.cell} · ` : ''}{issueLabel(item)}
          </option>)}
        </select>
      </>}
      {consultation.question && <>
        <label htmlFor={previewId}>Vista previa de la consulta</label>
        <p className="student-chatgpt-shared">Se comparte el texto de abajo. Los archivos y notas de tu práctica permanecen en ContaEZ.</p>
        <textarea id={previewId} className="student-chatgpt-preview" rows={5} readOnly value={preview} />
      </>}
      {desktop && account?.connected && <div className="student-chatgpt-usage">
        <span>Las consultas enviadas desde aquí usan tu plan de ChatGPT.</span>
        <button type="button" disabled={!!busy} onClick={() => void run('Abriendo los ajustes de uso…', manageChatGPTUsage)}>Administrar uso ↗</button>
      </div>}
      <div className="student-chatgpt-actions">
        {desktop && account?.connected && <button className="student-button primary" type="button" disabled={!!busy || !consultation.question}
          onClick={() => void run('Esperando la respuesta de ChatGPT…', async () => {
            setAnswer('');
            setAnswer(await askChatGPT(consultation.question, consultation.context));
            setNotice('Respuesta disponible debajo.');
          })}>Enviar pregunta a ChatGPT</button>}
        <button className="student-button secondary" type="button" disabled={!!busy || !consultation.question}
          onClick={() => void run('Copiando la consulta…', async () => {
            try {
              await navigator.clipboard.writeText(preview);
              setNotice('Consulta copiada. Abre ChatGPT, pégala y envíala desde tu cuenta.');
            } catch {
              setNotice('No se pudo copiar automáticamente. Selecciona el texto de la vista previa y cópialo.');
            }
          })}><Copy size={16} aria-hidden="true" />Copiar consulta</button>
        {desktop
          ? <button className="student-button secondary" type="button" disabled={!!busy}
            onClick={() => void run('Abriendo el navegador…', () => openExternal('https://chatgpt.com/'))}>Abrir ChatGPT <ArrowUpRight size={16} aria-hidden="true" /></button>
          : <a className="student-button secondary" href="https://chatgpt.com/" target="_blank" rel="noopener noreferrer">Abrir ChatGPT <ArrowUpRight size={16} aria-hidden="true" /></a>}
      </div>
      <div role="status" aria-live="polite" className="student-chatgpt-status">{busy || notice}</div>
      {answer && <section className="student-chatgpt-answer"><h3>Respuesta de ChatGPT</h3><p>{answer}</p></section>}
    </div>
  </details>;
}
