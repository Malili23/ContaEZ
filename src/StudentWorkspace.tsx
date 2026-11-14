import { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowLeft, ArrowRight, Check, ChevronDown, ChevronRight, CircleHelp, FileSpreadsheet, FolderOpen, Link2, LoaderCircle, MessageSquareText, Paperclip, Plus, Send, ShieldCheck, Upload, X } from 'lucide-react';
import { createProject, newId, parseProject } from './core';
import type { Project } from './core/types';
import { importFile, type WorkbookFinding } from './io';
import { repairStudentPractice } from './studentProcessor';
import type { ContextSuggestion, PracticeContextReview } from './io/context';
import { backupProject, exportBytes, loadProjects, openExternal, isDesktop, saveProject } from './platform';
import './student.css';
import DownloadDesktopLink from './DownloadDesktopLink';
import PracticeCompletionPanel from './PracticeCompletionPanel';
import StudentChatGPT from './StudentChatGPT';

type Connection={source:string;target:string;description:string};
type Question={id:string;title:string;explanation:string;placeholder:string};
type Message={id:string;role:'user'|'assistant';text:string};
type Attachment={name:string;text?:string;data:string;readingNotice?:string};
type ContextReport=PracticeContextReview;
type Practice={fileName:string;original:string;revised?:string;changes:WorkbookFinding[];pending:WorkbookFinding[];connections:Connection[];questions:Question[];answers:Record<string,string>;messages:Message[];attachments:Attachment[];contextNote?:string;contextReview?:ContextReport;acceptedContextIds?:string[];appliedContextIds?:string[];sheetNames:string[];updatedAt:string};
type PracticeProject=Project&{studentPractice?:Practice};
const base64=(bytes:Uint8Array)=>{let s='';for(let i=0;i<bytes.length;i+=0x8000)s+=String.fromCharCode(...bytes.subarray(i,i+0x8000));return btoa(s)};
const bytes=(s:string)=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
const shortSource=(source:string)=>{const refs=source.split(/ \+ | \/ /);return refs.length>3?[...new Set(refs.map(r=>r.split('!')[0]))].join(', ')+` · ${refs.length} referencias`:source;};
const MODALITY_NAMES={business:'Empresa comercial',individual:'Persona física'};

/** One user action owns the workspace until all its processing and writes finish. */
export function createPracticeTaskGate(){
 let active=false;
 return {get active(){return active;},async run<T>(action:()=>Promise<T>):Promise<T|undefined>{if(active)return;active=true;try{return await action();}finally{active=false;}}};
}
/** Publish only a revision that is already durable in the selected store. */
export async function commitPracticeRecord<T extends {updatedAt:string}>(record:T,save:(next:T)=>Promise<void>,publish:(next:T)=>void):Promise<T>{
 const next={...record,updatedAt:new Date().toISOString()};await save(next);publish(next);return next;
}

/** Restore inputs and decisions. Compute a fresh report from those inputs before saving. */
export function restorePracticeInputs(raw:unknown):PracticeProject{
 const project=parseProject(raw) as PracticeProject;
 const practice=project.studentPractice;
 const invalid=()=>new Error('El respaldo no contiene una práctica de Excel compatible.');
 const string=(value:unknown):value is string=>typeof value==='string';
 if(project.mode!=='student'||!practice||!string(practice.fileName)||!/\.xlsx$/i.test(practice.fileName)||!string(practice.original)||!practice.original||!Array.isArray(practice.attachments))throw invalid();
 for(const file of practice.attachments){
  if(!file||!string(file.name)||!string(file.data)||
     (file.text!==undefined&&!string(file.text))||(file.readingNotice!==undefined&&!string(file.readingNotice)))throw invalid();
 }
 if(!practice.answers||typeof practice.answers!=='object'||Array.isArray(practice.answers)||!Object.values(practice.answers).every(string))throw invalid();
 if(practice.contextNote!==undefined&&!string(practice.contextNote))throw invalid();
 if(practice.acceptedContextIds!==undefined&&(!Array.isArray(practice.acceptedContextIds)||!practice.acceptedContextIds.every(string)))throw invalid();
 if(!Array.isArray(practice.messages)||!practice.messages.every(m=>m&&string(m.id)&&['user','assistant'].includes(m.role)&&string(m.text)))throw invalid();
 return {...project,id:newId(),studentPractice:{
  fileName:practice.fileName,original:practice.original,attachments:practice.attachments,answers:practice.answers,
  contextNote:practice.contextNote,acceptedContextIds:practice.acceptedContextIds,messages:practice.messages,
  changes:[],pending:[],connections:[],questions:[],sheetNames:[],updatedAt:project.updatedAt
 }};
}

export default function StudentWorkspace({onAccounting}:{onAccounting:(mode:'business'|'individual')=>void}){
 const [records,setRecords]=useState<PracticeProject[]>([]),[selected,setSelected]=useState(''),[loaded,setLoaded]=useState(false),[busy,setBusy]=useState(''),[notice,setNotice]=useState(''),[text,setText]=useState(''),[showOther,setShowOther]=useState(false),[showHow,setShowHow]=useState(false),[showChanges,setShowChanges]=useState(false),[activeQuestion,setActiveQuestion]=useState(''),[draftAnswers,setDraftAnswers]=useState<Record<string,string>>({});
 const [stagedFiles,setStagedFiles]=useState<File[]>([]),[stagedAttachments,setStagedAttachments]=useState<Attachment[]>([]),[stagedNote,setStagedNote]=useState(''),[contextDrafts,setContextDrafts]=useState<Record<string,string>>({});
 const [tasks]=useState(createPracticeTaskGate);
 const upload=useRef<HTMLInputElement>(null),attachment=useRef<HTMLInputElement>(null),messageEnd=useRef<HTMLDivElement>(null),backup=useRef<HTMLInputElement>(null);
 const current=records.find(r=>r.id===selected),practice=current?.studentPractice;
 const contextDraft=selected?(contextDrafts[selected]??practice?.contextNote??''):'';
 const contextDirty=!!practice&&contextDraft.trim()!==(practice.contextNote||'').trim();
 const setContextDraft=(value:string)=>{if(selected)setContextDrafts(old=>({...old,[selected]:value}));};
 const selectPractice=(id:string)=>{if(tasks.active)return;setSelected(id);setShowChanges(false);setActiveQuestion('');setDraftAnswers({});setText('');};
 useEffect(()=>{let active=true;loadProjects().then(all=>{if(!active)return;const items=(all as PracticeProject[]).filter(p=>p.mode==='student'&&p.studentPractice?.original);setRecords(items);setSelected('');}).catch(e=>{if(active)setNotice(String(e));}).finally(()=>{if(active)setLoaded(true);});return()=>{active=false;};},[]);
 useEffect(()=>{const panel=messageEnd.current?.parentElement;if(panel)panel.scrollTop=panel.scrollHeight;},[practice?.messages.length]);
 const persist=async(record:PracticeProject)=>{try{return await commitPracticeRecord(record,saveProject,saved=>setRecords(old=>old.some(r=>r.id===saved.id)?old.map(r=>r.id===saved.id?saved:r):[saved,...old]));}catch(e){throw new Error('No se pudo guardar esta revisión. Reintenta antes de cerrar ContaEZ. '+(e instanceof Error?e.message:String(e)));}};
 const runTask=(label:string,action:()=>Promise<void>)=>tasks.run(async()=>{setBusy(label);try{await action();}catch(e){setNotice(e instanceof Error?e.message:String(e));}finally{setBusy('');}});
 const analyze=async(record:PracticeProject,answers=record.studentPractice!.answers,complete?:(p:Practice)=>Practice)=>{
  const p=record.studentPractice!;setBusy(`Conectando y revisando ${p.fileName}`);
  await new Promise<void>(resolve=>requestAnimationFrame(()=>setTimeout(resolve,0)));const result=await repairStudentPractice(bytes(p.original),p.fileName,answers,{instruction:p.contextNote||'',references:p.attachments.map(a=>({name:a.name,data:bytes(a.data),text:a.text})),acceptedSuggestionIds:p.acceptedContextIds||[]});const reviewed:Practice={...p,revised:base64(result.data),changes:result.changes,pending:result.pending,connections:result.connections,questions:result.questions,contextReview:result.context,appliedContextIds:result.appliedContextIds||[],answers,sheetNames:result.before.sheets.map(s=>s.name),updatedAt:new Date().toISOString()};const next=await persist({...record,studentPractice:complete?complete(reviewed):reviewed});setContextDrafts(old=>{const updated={...old};delete updated[record.id];return updated;});return next;
 };
 const stageFiles=(list:FileList|File[])=>{
  if(tasks.active)return;
  setShowOther(false);
  const files=Array.from(list);
  const accepted=files.filter(file=>/\.xlsx$/i.test(file.name)&&!file.name.startsWith('~$')&&file.size>0&&file.size<=50*1024*1024);
  const ignored=files.filter(file=>!accepted.includes(file));
  if(ignored.length)setNotice(`Archivos omitidos: ${ignored.map(file=>file.name).join(', ')}. Elige libros .xlsx de hasta 50 MB.`);
  if(!accepted.length)return;
  setSelected('');setStagedFiles(old=>{
   const next=[...old];
   for(const file of accepted)if(!next.some(item=>item.name===file.name&&item.size===file.size&&item.lastModified===file.lastModified))next.push(file);
   return next;
  });
 };
 const startReview=()=>runTask('Preparando las prácticas',async()=>{
  if(!stagedFiles.length)return;const files=[...stagedFiles],references=stagedAttachments.map(a=>({...a})),instruction=stagedNote.trim();let processed=0;const failed:File[]=[],errors:string[]=[];
  for(const [index,file] of files.entries()){
   try{setBusy(`Abriendo ${index+1} de ${files.length}: ${file.name}`);const data=new Uint8Array(await file.arrayBuffer());const project=createProject('student',file.name.replace(/\.xlsx$/i,'')) as PracticeProject;project.studentPractice={fileName:file.name,original:base64(data),changes:[],pending:[],connections:[],questions:[],answers:{},messages:[],attachments:references.map(a=>({...a})),contextNote:instruction,acceptedContextIds:[],sheetNames:[],updatedAt:new Date().toISOString()};await analyze(project);setSelected(project.id);setShowChanges(false);setActiveQuestion('');setDraftAnswers({});setText('');processed++;}
   catch(e){failed.push(file);errors.push(file.name+': '+(e instanceof Error?e.message:String(e)));}
  }
  setStagedFiles(failed);if(failed.length){setSelected('');setNotice(`${processed} práctica(s) revisadas y guardadas. ${failed.length} no se completaron; siguen seleccionadas para reintentar.\n`+errors.join('\n'));}else{setStagedAttachments([]);setStagedNote('');if(processed>1)setNotice(`${processed} prácticas revisadas y guardadas por separado. Puedes abrirlas desde Mis prácticas.`);}
 });
 const download=()=>{if(!practice?.revised)return;if(contextDirty){setNotice('Primero pulsa Revisar con este contexto: la nota nueva todavía no está incluida en la copia.');return;}return runTask('Elige dónde guardar la copia',async()=>{await exportBytes(bytes(practice.revised!),practice.fileName.replace(/\.xlsx$/i,'')+'__corregida.xlsx');setNotice(isDesktop()?'Se guardó una copia de tu práctica con sus cambios y pendientes. Tu archivo original sigue intacto.':'Se solicitó la descarga de tu copia revisada. Comprueba la carpeta de descargas de tu navegador; tu archivo original sigue intacto.');});};
 const saveBackup=()=>runTask('Preparando respaldo de la práctica',async()=>{
  if(!current||!practice)return;
  const snapshot:PracticeProject={...current,studentPractice:{...practice,contextNote:contextDraft.trim()}};
  await backupProject(snapshot);
  setNotice(isDesktop()?'Se guardó el respaldo de la práctica.':'Se solicitó la descarga del respaldo. Comprueba la carpeta de descargas.');
 });
 const openBackup=(file:File)=>runTask('Abriendo respaldo de la práctica',async()=>{
  const data=JSON.parse(await file.text());
  const project=restorePracticeInputs(data?.project??data);
  await analyze(project);
  setSelected(project.id);setShowChanges(false);setActiveQuestion('');setDraftAnswers({});setText('');
  setNotice('Se restauró la práctica con sus referencias y se generó una revisión nueva.');
 });
 const questionReply=(p:Practice,id:string):Practice=>{const remaining=p.questions.find(q=>q.id===id);return {...p,messages:[...p.messages,{id:newId(),role:'assistant',text:remaining?'Todavía falta aclarar este dato. '+remaining.explanation:'Tu aclaración se aplicó y la nueva copia quedó guardada. Revisa el cambio antes de descargarla.'}]};};
 const answer=(q:Question)=>runTask('Comprobando tu aclaración',async()=>{if(!current||!practice)return;const value=(draftAnswers[q.id]||'').trim();if(!value)return;const next={...current,studentPractice:{...practice,contextNote:contextDraft.trim(),messages:[...practice.messages,{id:newId(),role:'user' as const,text:q.title+'\n'+value}]}};const updated=await analyze(next,{...practice.answers,[q.id]:value},p=>questionReply(p,q.id));if(!updated.studentPractice!.questions.some(item=>item.id===q.id)){setDraftAnswers(old=>({...old,[q.id]:''}));setNotice('Dato aplicado. La revisión y la copia ya están actualizadas.');}else setNotice('El dato aún necesita aclaración. Conservé tu respuesta para que puedas corregirla.');});
 const send=()=>runTask('Revisando tu indicación',async()=>{
  if(!current||!practice||!text.trim())return;const value=text.trim(),question=practice.questions.find(q=>q.id===activeQuestion);
  if(question){const next={...current,studentPractice:{...practice,contextNote:contextDraft.trim(),messages:[...practice.messages,{id:newId(),role:'user' as const,text:question.title+'\n'+value}]}};await analyze(next,{...practice.answers,[question.id]:value},p=>questionReply(p,question.id));setDraftAnswers(old=>({...old,[question.id]:value}));}
  else{const instruction=[contextDraft.trim(),value].filter(Boolean).join('\n');const next={...current,studentPractice:{...practice,contextNote:instruction,messages:[...practice.messages,{id:newId(),role:'user' as const,text:value}]}};await analyze(next,practice.answers,p=>({...p,messages:[...p.messages,{id:newId(),role:'assistant',text:p.contextReview?.suggestions.some(s=>!p.appliedContextIds?.includes(s.id))?'Hay propuestas del Excel modelo pendientes de tu confirmación. Revisa el origen, la celda y la fórmula en Contexto.':'Revisé tu indicación junto con los archivos de contexto. Consulta las notas y preguntas pendientes; solo se aplicaron cambios comprobables.'}]}));}
  setText('');
 });
 const attachFiles=(list:FileList|File[])=>{const files=Array.from(list);return runTask('Leyendo los archivos de contexto',async()=>{
  if(!files.length)return;for(const file of files){if(!/\.(xlsx|pdf|png|jpe?g|webp|bmp|tiff?|txt|xml|csv)$/i.test(file.name))throw new Error('Adjunta Excel .xlsx, fotos, XML de CFDI, PDF o texto.');if(file.size>20*1024*1024)throw new Error('Cada archivo de contexto puede ocupar hasta 20 MB.');}
  const added:Attachment[]=[];for(const [index,file] of files.entries()){
   setBusy(`Leyendo contexto ${index+1} de ${files.length}: ${file.name}`);let extracted='',readingNotice:string|undefined;
   if(/\.(txt|csv|xml)$/i.test(file.name))extracted=await file.text();
   else if(!/\.xlsx$/i.test(file.name)){
    try{const parsed=await importFile(file,createProject('student'));extracted=parsed.documents[0]?.text||'';const failed=parsed.issues.find(i=>i.code==='OCR_PENDING'||i.code==='PDF_READ'),pdfInfo=parsed.issues.find(i=>i.code==='PDF_CONFIRM');readingNotice=failed?'No se pudo leer el texto. '+failed.suggestion:extracted.trim()?(pdfInfo?pdfInfo.detail+' ':'')+'Texto leído automáticamente; confirma fechas, importes y cuentas.':/\.pdf$/i.test(file.name)?'Este PDF no tiene texto legible. Adjunta la página como imagen o escribe los datos necesarios.':'No se reconoció texto en la imagen. Usa una foto más clara o escribe la información necesaria.';}
    catch(e){readingNotice='No se pudo leer el texto de este archivo. Se conserva como referencia; puedes adjuntar una imagen más clara o escribir los datos. '+(e instanceof Error?e.message:String(e));}
   }
   added.push({name:file.name,text:extracted,data:base64(new Uint8Array(await file.arrayBuffer())),readingNotice});
  }
  if(current&&practice){await analyze({...current,studentPractice:{...practice,attachments:[...practice.attachments,...added],contextNote:contextDraft.trim()}});setNotice('El contexto quedó guardado solo con esta práctica y se volvió a revisar. Consulta también el estado de lectura de cada archivo.');}
  else{setStagedAttachments(old=>[...old,...added]);if(added.some(a=>a.readingNotice&&!a.text?.trim()))setNotice('Se conservaron los adjuntos. Algunos no tienen texto legible; revisa el aviso junto a su nombre antes de continuar.');}
 });};
 const applyContext=()=>runTask('Revisando el contexto',async()=>{if(!current||!practice)return;await analyze({...current,studentPractice:{...practice,contextNote:contextDraft.trim()}});setNotice('El contexto y la nueva revisión quedaron guardados. Consulta las notas y propuestas antes de descargar.');});
 const removeContextFile=(index:number)=>{
  if(tasks.active)return;
  if(!current||!practice){setStagedAttachments(old=>old.filter((_,i)=>i!==index));return;}
  return runTask('Actualizando las referencias de esta práctica',async()=>{
   const removed=practice.attachments[index];
   if(!removed)return;
   const withdrawn=new Set(practice.contextReview?.suggestions.filter(s=>s.source===removed.name).map(s=>s.id));
   const acceptedContextIds=(practice.acceptedContextIds||[]).filter(id=>!withdrawn.has(id));
   await analyze({...current,studentPractice:{...practice,attachments:practice.attachments.filter((_,i)=>i!==index),acceptedContextIds,contextNote:contextDraft.trim()}});
   setNotice('Archivo de contexto retirado y práctica revisada de nuevo.');
  });
 };
 const acceptContextSuggestion=(suggestion:ContextSuggestion)=>{if(contextDirty){setNotice('Revisa primero la nota nueva para actualizar las propuestas del modelo.');return;}return runTask('Comprobando la fórmula del modelo',async()=>{if(!current||!practice)return;const alternatives=practice.contextReview?.suggestions.filter(s=>s.targetSheet===suggestion.targetSheet&&s.targetCell===suggestion.targetCell).map(s=>s.id)||[];const replaced=practice.appliedContextIds?.some(id=>alternatives.includes(id));const updated=await analyze({...current,studentPractice:{...practice,acceptedContextIds:[...(practice.acceptedContextIds||[]).filter(id=>!alternatives.includes(id)),suggestion.id]}});setNotice(updated.studentPractice?.appliedContextIds?.includes(suggestion.id)?replaced?'La alternativa elegida sustituyó la fórmula anterior de esa celda en la copia. Consulta su origen en la revisión.':'Fórmula del modelo aplicada y guardada en la copia. Su origen aparece en la revisión.':'La propuesta no pudo aplicarse. La versión guardada conserva las notas que explican los pendientes.');});};
 const focusedCells=practice?.contextReview?.focusedCells||[];
 const focusAddresses=[...focusedCells.map(f=>f.cell.toUpperCase()),...(practice?.contextNote?.toUpperCase().match(/\b[A-Z]{1,3}[1-9]\d*\b/g)||[])];
 const isFocused=(q:Question)=>focusedCells.length?focusedCells.some(f=>q.title.toLowerCase().includes((f.sheet+'!'+f.cell).toLowerCase())):focusAddresses.some(cell=>new RegExp(`(?:!|\\b)${cell}\\b`,'i').test(q.title));
 const usefulQuestions=[...(practice?.questions||[])].sort((a,b)=>Number(isFocused(b))-Number(isFocused(a)));
 return <div className="student-app">
  <fieldset className="student-controls" disabled={!!busy||!loaded}>
  <header className="student-header"><button className="student-logo" onClick={()=>selectPractice('')} aria-label="Inicio de ContaEZ"><span className="student-mark"><i/><i/><i/></span>Conta<span>EZ</span><small>MÉXICO</small></button><div className="student-header-actions"><DownloadDesktopLink/><button aria-expanded={showHow} aria-controls="student-help" onClick={()=>setShowHow(!showHow)}><CircleHelp size={17}/>Cómo funciona</button><div className="student-other"><button aria-expanded={showOther} aria-controls="student-other-modes" onClick={()=>setShowOther(!showOther)}>Otras modalidades<ChevronDown size={15}/></button>{showOther&&<div className="student-menu" id="student-other-modes">{(['business','individual'] as const).map(m=><button key={m} onClick={()=>onAccounting(m)}>{MODALITY_NAMES[m]}<ArrowRight size={15}/></button>)}</div>}</div></div></header>
  <main className="student-main">
   {showHow&&<section className="student-how" id="student-help"><button className="student-close" onClick={()=>setShowHow(false)} aria-label="Cerrar explicación"><X size={17}/></button><h2>Tu práctica a la izquierda. Su contexto, a la derecha.</h2><ol><li><strong>Elige el Excel que quieres corregir.</strong> Puedes enviar varios; cada uno conserva su propia revisión.</li><li><strong>Agrega lo que ayude.</strong> Adjunta un Excel correcto, fotos, CFDI, PDF o una nota como “el asiento en Diario!C1 no funciona”. Es opcional.</li><li><strong>Revisa y descarga.</strong> Se aplican las correcciones comprobables. Las propuestas tomadas de otro Excel muestran su origen y necesitan tu confirmación.</li></ol><p>Se conservan tus hojas y datos. No tienes que crear una empresa ni volver a capturar las operaciones.</p></section>}
   {!practice?<>
    <section className="student-intro"><span className="student-eyebrow">PARA TUS PRÁCTICAS DE CONTABILIDAD</span><h1>Trabaja en tu <span>práctica de Excel</span>.</h1><p>Revisa tu libro o genera cuentas T, balanza y estados a partir de un diario y catálogo.</p><a className="student-completion-jump" href="#completar-practica">Ir a Generar práctica completa <ArrowRight size={15} aria-hidden="true"/></a></section>
    <div className="student-upload-pair">
     <section className="student-main-upload" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();stageFiles(e.dataTransfer.files)}} aria-label="Práctica que quiero corregir"><span className="student-panel-step">1 · ARCHIVO PRINCIPAL</span><span className="student-file-icon"><FileSpreadsheet size={31}/></span><h2>Tu práctica de Excel</h2><p>Arrastra el .xlsx que quieres corregir.<br/>Sus hojas, datos y diseño se conservan.</p><button className="student-button primary" onClick={()=>upload.current?.click()}><Upload size={18}/>{stagedFiles.length?'Agregar otra práctica':'Subir mi práctica'}</button>{stagedFiles.length>0&&<ul className="student-staged-files">{stagedFiles.map((file,index)=><li key={file.name+'-'+index}><FileSpreadsheet size={17}/><span>{file.name}</span><button aria-label={'Quitar práctica '+file.name} onClick={()=>setStagedFiles(old=>old.filter((_,i)=>i!==index))}><X size={15}/></button></li>)}</ul>}<span className="student-safe"><ShieldCheck size={15}/>El original siempre queda intacto.</span></section>
     <ContextPanel files={stagedAttachments} note={stagedNote} onNote={setStagedNote} onPick={()=>attachment.current?.click()} onRemove={index=>void removeContextFile(index)} fileCount={stagedFiles.length}/>
    </div>
    <div className="student-start-review"><button className="student-button primary" disabled={!stagedFiles.length||!!busy} onClick={()=>void startReview()}>{stagedFiles.length>1?`Revisar ${stagedFiles.length} prácticas con este contexto`:'Revisar mi práctica con este contexto'}<ArrowRight size={18}/></button><p>{stagedFiles.length?'Puedes continuar sin contexto. Si lo agregaste, se usará solo para las prácticas seleccionadas.':'Primero elige tu práctica. Después agrega contexto si lo necesitas.'}</p></div>
    <div className="student-steps"><span><b>1</b>Práctica y contexto</span><ArrowRight size={17}/><span><b>2</b>Conectamos y revisamos</span><ArrowRight size={17}/><span><b>3</b>Descargas la copia</span></div>
    <PracticeCompletionPanel/>
    <section className="student-recents"><div><h2>Tus prácticas recientes</h2><button className="student-link-button" onClick={()=>backup.current?.click()}><FolderOpen size={17}/>Abrir respaldo</button></div>{records.map(r=><button key={r.id} className="student-recent" onClick={()=>selectPractice(r.id)}><FileSpreadsheet size={22}/><span><strong>{r.studentPractice!.fileName}</strong><small>{r.studentPractice!.changes.length} cambios · {r.studentPractice!.questions.length} preguntas</small></span><ArrowRight size={18}/></button>)}</section>
   </>:<>
    <div className="student-file-top"><button className="student-back" onClick={()=>selectPractice('')}><ArrowLeft size={17}/>Mis prácticas</button><button className="student-link-button" onClick={()=>upload.current?.click()}><Plus size={17}/>Subir otra práctica</button></div>
    <div className="student-upload-pair student-active-pair"><section className="student-active-file"><span className="student-panel-step">ARCHIVO QUE SE ESTÁ CORRIGIENDO</span><div className="student-file-heading"><span className="student-file-badge"><FileSpreadsheet size={27}/></span><div><span className="student-eyebrow">TU PRÁCTICA · {practice.sheetNames.length||'…'} HOJAS</span><h1>{practice.fileName}</h1></div></div><p>Los cambios se hacen en una copia de este Excel. Los archivos de la derecha sirven como referencia y permanecen asociados solo a esta práctica.</p><span className="student-safe"><ShieldCheck size={15}/>No se crea otra contabilidad.</span></section><ContextPanel active dirty={contextDirty} files={practice.attachments} note={contextDraft} onNote={setContextDraft} onPick={()=>attachment.current?.click()} onRemove={index=>void removeContextFile(index)} onApply={()=>void applyContext()}/></div>
    {contextDirty&&<div className="student-draft-warning" role="status"><strong>Hay una nota pendiente de revisar.</strong><span>Pulsa Revisar con este contexto para incluirla y actualizar la copia antes de descargar.</span></div>}
    {practice.contextReview&&(practice.contextReview.notes.length>0||practice.contextReview.suggestions.length>0||focusedCells.length>0)&&<section className="student-card student-context-review"><div className="student-context-review-heading"><Paperclip size={19}/><h2>Lo que aportó el contexto</h2></div>{focusedCells.length>0&&<p>La revisión se enfocó en {focusedCells.map(f=>f.sheet+'!'+f.cell).join(', ')}.</p>}{practice.contextReview.notes.length>0&&<ul className="student-context-notes">{practice.contextReview.notes.map((note,index)=><li key={index}>{note}</li>)}</ul>}{practice.contextReview.suggestions.map(suggestion=>{const applied=practice.appliedContextIds?.includes(suggestion.id);return <article className="student-context-proposal" key={suggestion.id}><span className="student-cell">{suggestion.targetSheet}!{suggestion.targetCell}</span><h3>{suggestion.title}</h3><p>{suggestion.explanation}</p><small>Fuente: {suggestion.source}</small><div className="student-formula"><span>En tu práctica<code>{suggestion.originalFormula||suggestion.originalValue||'Sin fórmula'}</code></span><ArrowRight size={16}/><span>Fórmula del modelo<code>{suggestion.formula}</code></span></div><button className={'student-button '+(applied?'secondary':'primary')} disabled={applied||contextDirty||!!busy} onClick={()=>void acceptContextSuggestion(suggestion)}>{applied?<><Check size={17}/>Aplicada a la copia</>:<>Aplicar fórmula del modelo<ArrowRight size={16}/></>}</button></article>})}</section>}
    <section className="student-result"><div><span className={'student-result-icon '+(usefulQuestions.length?'pending':'')}><Check size={25}/></span><div><h2>{practice.changes.length?`${practice.changes.length} ${practice.changes.length===1?'cambio aplicado':'cambios aplicados'} a tu Excel`:practice.revised?'Revisión lista':'Tu archivo está listo para revisar'}</h2><p>{usefulQuestions.length?`Puedo avanzar más si confirmas ${usefulQuestions.length===1?'un dato':`${usefulQuestions.length} datos`}. Te explico cuáles abajo.`:practice.pending.length?`Quedan ${practice.pending.length} observaciones por revisar. Están señaladas en el informe.`:'Revisa los cambios y descarga la copia. Excel recalculará las fórmulas al abrirla.'}</p></div></div><button className="student-button primary" disabled={!practice.revised||contextDirty||!!busy} onClick={()=>void download()}><ArrowDownToLine size={18}/>Descargar Excel revisado</button></section>
    <div className="student-metrics"><span><b>{practice.connections.length}</b>conexiones creadas</span><span><b>{practice.changes.length}</b>correcciones y vínculos</span><span><b>{usefulQuestions.length}</b>{usefulQuestions.length===1?'dato por confirmar':'datos por confirmar'}</span><button aria-expanded={showChanges} aria-controls="student-change-details" onClick={()=>setShowChanges(!showChanges)}>Ver qué cambió<ChevronDown size={15}/></button></div>
    {showChanges&&<section className="student-card student-changes" id="student-change-details"><h2>Qué se cambió y por qué</h2><p>Puedes ver estas modificaciones en la copia revisada de tu libro.</p>{practice.changes.length?practice.changes.map((f,i)=><article key={f.id+'-'+i}><span className="student-cell">{f.sheet}{f.cell?'!'+f.cell:''}</span><h3>{f.message}</h3><p>{f.suggestion}</p><div className="student-formula"><span>Antes <code>{f.original||'Sin fórmula'}</code></span><ArrowRight size={16}/><span>Ahora <code>{f.replacement||'Consulta la hoja Revisión ContaEZ'}</code></span></div></article>):<div className="student-no-changes">No se modificaron datos por suposición. Revisa las preguntas para indicar las referencias que faltan.</div>}</section>}
    {practice.connections.length>0&&<details className="student-card student-link-details"><summary><Link2 size={19}/>Ver los vínculos creados entre tus hojas<ChevronDown size={16}/></summary><p>Los vínculos usan datos de esta misma práctica. Su detalle también aparece en la hoja Revisión ContaEZ.</p><div className="student-connections">{practice.connections.slice(0,8).map((link,i)=><div key={i}><span title={link.source}>{shortSource(link.source)}</span><ArrowRight size={16}/><span>{link.target}</span><small>{link.description.replace(/falta el vínculo/,'se conectó el movimiento')}</small></div>)}</div>{practice.connections.length>8&&<small>El detalle de las {practice.connections.length} conexiones está en el informe del Excel.</small>}</details>}
    {usefulQuestions.length>0&&<section className="student-questions"><div className="student-section-title"><CircleHelp size={22}/><div><h2>Estas son las dudas de tu archivo</h2><p>Solo te pregunto lo que no puedo deducir de tu archivo.</p></div></div><details className="student-reference-help"><summary>¿Cómo encuentro una celda de origen?</summary><p>Abre tu Excel y busca el importe o fórmula que corresponde a esa cuenta. La letra de la columna y el número de fila forman su dirección: D8, por ejemplo. Escríbela junto al nombre de la hoja: Diario!D8. Si son varias celdas que deben sumarse, usa Diario!D8:D12. Para nombres con espacios: 'Esquemas de mayor'!F18.</p><p>Si no sabes de dónde sale, adjunta el enunciado y conserva la duda. Un importe desconocido no se rellena con cero para que cuadre.</p></details>{usefulQuestions.slice(0,4).map(q=><article className={"student-card "+(isFocused(q)?"student-question-focused":"")} key={q.id}>{isFocused(q)&&<span className="student-focus-label">Relacionado con tu indicación</span>}<h3>{q.title}</h3><p>{q.explanation}</p><div className="student-answer"><input aria-label={q.title} placeholder={q.placeholder} value={draftAnswers[q.id]||''} onChange={e=>setDraftAnswers(old=>({...old,[q.id]:e.target.value}))}/><button className="student-button secondary" disabled={!(draftAnswers[q.id]||'').trim()} onClick={()=>void answer(q)}>Aplicar dato<ArrowRight size={16}/></button></div></article>)}{usefulQuestions.length>4&&<p className="student-caption">También puedes elegir cualquiera de las {usefulQuestions.length} preguntas en el chat de abajo.</p>}</section>}
    <section className="student-card student-chat"><div className="student-chat-title"><MessageSquareText size={22}/><div><h2>Agrega una indicación o el dato que falta</h2><p>Este chat pertenece solo a <strong>{practice.fileName}</strong>.</p></div><span>Gratis</span></div>{practice.messages.length>0&&<div className="student-messages">{practice.messages.map(m=><div key={m.id} className={'student-message '+m.role}><small>{m.role==='user'?'Tú':'ContaEZ'}</small><p>{m.text}</p></div>)}<div ref={messageEnd}/></div>}{usefulQuestions.length>0&&<label className="student-question-select"><span>¿Qué dato estás aclarando?</span><select aria-label="Pregunta que quiero aclarar" value={activeQuestion} onChange={e=>setActiveQuestion(e.target.value)}><option value="">Una indicación general</option>{usefulQuestions.map(q=><option key={q.id} value={q.id}>{q.title}</option>)}</select></label>}<div className="student-composer"><textarea aria-label="Indicación para mi práctica" value={text} onChange={e=>setText(e.target.value)} placeholder="Ej. El total de Bancos está en 'Esquemas de mayor'!F18…" onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();void send()}}}/><div><button aria-label="Adjuntar instrucciones" onClick={()=>attachment.current?.click()}><Paperclip size={19}/>Adjuntar enunciado</button><button className="student-send" aria-label="Enviar indicación" disabled={!text.trim()} onClick={()=>void send()}><Send size={18}/></button></div></div><p className="student-caption">Las referencias se aplican a tu Excel. Una indicación ambigua se conserva como nota hasta que pueda comprobarse.</p></section>
    <StudentChatGPT key={selected} findings={practice.pending}/>
    <PracticeCompletionPanel key={selected+'-completar'} reviewedFile={practice.revised&&!contextDirty?{name:practice.fileName,data:()=>bytes(practice.revised!)}:undefined}/>
    {practice.pending.length>0&&<details className="student-details"><summary>Ver las observaciones que siguen pendientes <ChevronDown size={15}/></summary>{practice.pending.map((f,i)=><article key={f.id+'-'+i}><strong>{f.sheet}{f.cell?'!'+f.cell:''}</strong><p>{f.message}</p><small>{f.suggestion}</small></article>)}</details>}
    <div className="student-bottom-actions"><button className="student-link-button" onClick={()=>void applyContext()}><Link2 size={17}/>Volver a revisar con mis aclaraciones</button><button className="student-button secondary" onClick={()=>void saveBackup()}><FolderOpen size={17}/>Guardar respaldo</button><button className="student-button primary" disabled={!practice.revised||contextDirty||!!busy} onClick={()=>void download()}><ArrowDownToLine size={18}/>Descargar copia revisada</button></div>
   </>}
   <footer className="student-footer"><p>Solo contabilidad mexicana. Se conservan tus datos y el archivo original.</p><span>Creada por <button onClick={()=>void openExternal('https://www.instagram.com/betcover_ii/')}>@betcover_ii</button><a href="mailto:gallardoquirozd4@gmail.com">Contacto</a></span></footer>
  </main>
  <input hidden ref={upload} type="file" multiple accept=".xlsx" aria-label="Seleccionar mi práctica Excel" onChange={e=>{if(e.target.files)stageFiles(e.target.files);e.target.value=''}}/>
  <input hidden ref={attachment} type="file" multiple accept=".xlsx,.pdf,.png,.jpg,.jpeg,.webp,.bmp,.tif,.tiff,.txt,.xml,.csv" aria-label="Seleccionar archivos de contexto para esta práctica" onChange={e=>{if(e.target.files)void attachFiles(e.target.files);e.target.value=''}}/>
  <input ref={backup} hidden type="file" accept=".contaez" aria-label="Seleccionar respaldo de una práctica" onChange={e=>{if(e.target.files?.[0])void openBackup(e.target.files[0]);e.target.value=''}}/>
  </fieldset>
  {(!loaded||busy)&&<div className="student-busy" role="status"><LoaderCircle className="spin" size={28}/><h2>{busy||'Abriendo tus prácticas'}</h2></div>}
  {notice&&<div className="student-notice" role="status"><p>{notice}</p><button aria-label="Cerrar aviso" onClick={()=>setNotice('')}><X size={17}/></button></div>}
 </div>
}

function ContextPanel({files,note,onNote,onPick,onRemove,onApply,active=false,dirty=false,fileCount=1}:{files:Attachment[];note:string;onNote:(value:string)=>void;onPick:()=>void;onRemove:(index:number)=>void;onApply?:()=>void;active?:boolean;dirty?:boolean;fileCount?:number}){
 const noteId=active?'student-active-context-note':'student-staged-context-note';
 return <section className="student-context-panel" aria-label="Contexto para corregir la práctica">
  <div className="student-context-title"><span className="student-panel-step">{active?'CONTEXTO DE ESTA PRÁCTICA':'2 · CONTEXTO PARA CORREGIRLA'}</span><span>Opcional</span></div>
  <h2>¿Qué me ayuda a entenderla?</h2><p>Un Excel que esté bien, fotos, CFDI o PDF.<br/>Se usan como referencia para tu práctica.</p>
  <button className="student-button secondary" onClick={onPick}><Paperclip size={17}/>Agregar archivos de contexto</button>
  {files.length>0&&<ul className="student-context-files">{files.map((file,index)=><li key={file.name+'-'+index}><span className="student-context-file-kind">{/\.xlsx$/i.test(file.name)?'EXCEL':/\.xml$/i.test(file.name)?'CFDI':file.name.split('.').pop()?.toUpperCase()}</span><div className="student-context-file-copy"><span>{file.name}</span>{file.readingNotice&&<small className={file.text?.trim()?"":"reading-pending"}>{file.readingNotice}</small>}{file.text?.trim()&&<details><summary>Ver el texto leído</summary><pre>{file.text.slice(0,12000)}</pre></details>}</div><button aria-label={'Quitar contexto '+file.name} onClick={()=>onRemove(index)}><X size={15}/></button></li>)}</ul>}
  <label htmlFor={noteId}>O dime qué necesitas corregir</label><textarea id={noteId} value={note} onChange={event=>onNote(event.target.value)} placeholder="Ej. El asiento en Diario!C1 no funciona. Adjunto un Excel correcto para comparar." rows={3}/>
  {active?<><button className="student-button secondary student-context-apply" onClick={onApply}><Link2 size={16}/>Revisar con este contexto</button><small className={dirty?"student-context-unsaved":""}>{dirty?"Nota pendiente: revisa el contexto para actualizar la copia.":"Los adjuntos se revisan al agregarlos. Para aplicar una nota nueva, pulsa este botón."}</small></>:<small>{fileCount>1?`Este contexto se usará en las ${fileCount} prácticas seleccionadas; cada archivo conserva su revisión por separado.`:'Puedes dejarlo vacío. Los archivos de referencia no se mezclan con los datos de tu práctica.'}</small>}
 </section>;
}


