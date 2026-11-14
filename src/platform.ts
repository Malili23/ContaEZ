import type { Project } from './core/types';

export const isDesktop = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
const BROWSER_KEY = 'contaez.projects.v1';
const mutations = new Map<string, Promise<void>>();
let browserDatabase: Promise<IDBDatabase> | undefined;
let migration: Promise<void> | undefined;
function database(): Promise<IDBDatabase> {
  if (browserDatabase) return browserDatabase;
  const opening = new Promise<IDBDatabase>((resolve, reject) => {
    let settled=false;
    const fail=(message:string)=>{if(!settled){settled=true;reject(new Error(message));}};
    if (typeof indexedDB === 'undefined') { fail('Este navegador no permite almacenamiento de proyectos. Descarga un respaldo o utiliza la aplicación de escritorio.'); return; }
    try{
      const request = indexedDB.open('contaez-local-v1', 1);
      request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains('projects')) request.result.createObjectStore('projects', { keyPath: 'id' }); };
      request.onerror = () => fail('No se pudo abrir el almacenamiento local del navegador.');
      request.onblocked = () => fail('Cierra otras pestañas de ContaEZ para actualizar el almacenamiento.');
      request.onsuccess = () => {
        const db=request.result;if(settled){db.close();return;}settled=true;
        const forget=()=>{if(browserDatabase===opening)browserDatabase=undefined;};
        db.onclose=forget;db.onversionchange=()=>{db.close();forget();};resolve(db);
      };
    }catch{fail('No se pudo abrir el almacenamiento local del navegador.');}
  });
  browserDatabase=opening;
  void opening.catch(()=>{if(browserDatabase===opening)browserDatabase=undefined;});
  return opening;
}
function validProject(value: unknown): value is Project {
  if (!value || typeof value !== 'object') return false;
  const project=value as Partial<Project>;
  return project.schemaVersion===1 && project.jurisdiction==='MX' && typeof project.id==='string' && typeof project.name==='string';
}
function readAll(db: IDBDatabase): Promise<Project[]> {
  return new Promise((resolve,reject)=>{
    let projects:Project[]=[];
    const transaction=db.transaction('projects','readonly'); const request=transaction.objectStore('projects').getAll();
    request.onsuccess=()=>{projects=(request.result as unknown[]).filter(validProject);};
    request.onerror=()=>reject(new Error('No se pudieron leer los proyectos de este navegador.'));
    transaction.oncomplete=()=>resolve(projects);
    transaction.onerror=()=>reject(new Error('No se pudieron leer los proyectos de este navegador.'));
    transaction.onabort=()=>reject(new Error('La lectura de los proyectos se interrumpió. Vuelve a intentarlo.'));
  });
}
async function migrateLegacy(db: IDBDatabase): Promise<void> {
  if (migration) return migration;
  migration=(async()=>{
    let legacyStorage:Storage,raw:string|null;
    try{legacyStorage=globalThis.localStorage;raw=legacyStorage.getItem(BROWSER_KEY);}catch{return;}
    if (!raw) return;
    let legacy: unknown;
    try { legacy=JSON.parse(raw); } catch { throw new Error('El almacenamiento anterior está dañado. Se conservó intacto para recuperación.'); }
    if (!Array.isArray(legacy)) throw new Error('El almacenamiento anterior no tiene un formato válido. Se conservó intacto.');
    const projects=legacy.filter(validProject); const existing=await readAll(db); const merged=new Map(existing.map(p=>[p.id,p]));
    for(const project of projects){const prior=merged.get(project.id);if(!prior||String(project.updatedAt||'')>String(prior.updatedAt||''))merged.set(project.id,project);}
    await new Promise<void>((resolve,reject)=>{
      const transaction=db.transaction('projects','readwrite');
      transaction.oncomplete=()=>resolve();transaction.onerror=()=>reject(new Error('No se pudo migrar el almacenamiento. El respaldo anterior sigue intacto.'));transaction.onabort=transaction.onerror;
      for(const project of merged.values())transaction.objectStore('projects').put(project);
    });
    try{if(projects.length===legacy.length&&legacyStorage.getItem(BROWSER_KEY)===raw)legacyStorage.removeItem(BROWSER_KEY);}catch{/* The completed IndexedDB migration remains usable; the legacy copy is retained. */}
  })();
  try { await migration; } catch(error){migration=undefined;throw error;}
}
async function mutateBrowser(id: string, project?: Project): Promise<void> {
  const db=await database();await migrateLegacy(db);
  return new Promise<void>((resolve,reject)=>{
    const transaction=db.transaction('projects','readwrite'); const store=transaction.objectStore('projects');
    if(project)store.put(project);else store.delete(id);
    transaction.oncomplete=()=>resolve();
    transaction.onerror=()=>reject(new Error('El navegador no pudo guardar el proyecto. Descarga un respaldo y revisa el espacio disponible.'));
    transaction.onabort=transaction.onerror;
  });
}
async function enqueue(id: string, action: () => Promise<void>): Promise<void> {
  const previous=mutations.get(id)??Promise.resolve();const current=previous.catch(()=>{}).then(action);mutations.set(id,current);
  try {await current;}finally{if(mutations.get(id)===current)mutations.delete(id);}
}
async function native<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(command, args);
}
export function storageDescription(): string {
  return isDesktop() ? 'Datos cifrados en tu equipo y protegidos por el sistema.' : 'Vista web: guardado en este navegador. Conserva un respaldo de tus proyectos.';
}
export async function loadProjects(): Promise<Project[]> {
  if (isDesktop()) return (await native<Project[]>('projects_load')).sort((a,b)=>String(b.updatedAt||'').localeCompare(String(a.updatedAt||'')));
  const db=await database();await migrateLegacy(db);
  return (await readAll(db)).sort((a,b)=>String(b.updatedAt||'').localeCompare(String(a.updatedAt||'')));
}
export async function saveProject(project: Project): Promise<void> {
  if (project.jurisdiction !== 'MX' || project.schemaVersion !== 1) throw new Error('Este proyecto no es compatible con ContaEZ México.');
  return enqueue(project.id,()=>isDesktop()?native<void>('project_save',{project}):mutateBrowser(project.id,project));
}
export async function deleteProject(id: string): Promise<void> {
  return enqueue(id,()=>isDesktop()?native<void>('project_delete',{id}):mutateBrowser(id));
}
function exportFileName(name:string):string{
  let safe=(name.split(/[\\/]/).pop()||'ContaEZ-exportacion').replace(/[\u0000-\u001f\u007f<>:"|?*]/g,'_').replace(/^[. ]+|[. ]+$/g,'');
  if(!safe)safe='ContaEZ-exportacion';
  if(/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(safe))safe='_'+safe;
  const extension=safe.match(/\.[a-z0-9]{1,16}$/i)?.[0]||'',stem=extension?safe.slice(0,-extension.length):safe;
  return Array.from(stem).slice(0,100).join('')+extension;
}
export async function exportBytes(bytes: Uint8Array, name: string): Promise<void> {
  const fileName=exportFileName(name);
  if (isDesktop()) { const path=await native<string | null>('save_export', { data: Array.from(bytes), name:fileName }); if(!path)throw new Error('Exportación cancelada; no se guardó ningún archivo.');return; }
  const types:Record<string,string>={xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',contaez:'application/json',json:'application/json',csv:'text/csv;charset=utf-8',txt:'text/plain;charset=utf-8',pdf:'application/pdf'};
  const extension=fileName.split('.').pop()?.toLowerCase()||'';
  const blob = new Blob([bytes as BlobPart], { type: types[extension]||'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  let link:HTMLAnchorElement|undefined;
  try{link=document.createElement('a');link.href=url;link.download=fileName;link.hidden=true;document.body.appendChild(link);link.click();}
  catch(error){URL.revokeObjectURL(url);throw error;}
  finally{link?.remove();}
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
export async function backupProject(project: Project): Promise<void> {
  const text = JSON.stringify({ format: 'ContaEZ', version: 1, exportedAt: new Date().toISOString(), project }, null, 2);
  await exportBytes(new TextEncoder().encode(text), `${project.name.replace(/[<>:"/\\|?*]/g, '_')}.contaez`);
}
export async function openExternal(url: string): Promise<void> {
  const parsed = new URL(url);
  if (!['https:', 'http:', 'mailto:'].includes(parsed.protocol)) throw new Error('Enlace no permitido.');
  if (isDesktop()) { await native<void>('open_external', { url }); return; }
  window.open(url, '_blank', 'noopener,noreferrer');
}
