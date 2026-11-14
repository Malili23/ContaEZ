import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createProject } from '../src/core';

vi.mock('@tauri-apps/api/core',()=>({invoke:vi.fn()}));
const legacyKey='contaez.projects.v1';
let memory: Map<string,string>;
let storage: Pick<Storage,'getItem'|'setItem'|'removeItem'>;
beforeEach(()=>{
  vi.resetModules();vi.clearAllMocks();memory=new Map();
  storage={getItem:vi.fn(key=>memory.get(key)??null),setItem:vi.fn((key,value)=>{if(value.length>100000)throw new Error('legacy quota');memory.set(key,value);}),removeItem:vi.fn(key=>{memory.delete(key);})};
  vi.stubGlobal('indexedDB',new IDBFactory());vi.stubGlobal('localStorage',storage);vi.stubGlobal('window',{});
});
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
describe('Persistencia de proyectos',()=>{
  it('migra los proyectos anteriores y elimina el original solo tras completar la escritura',async()=>{
    const original=createProject('student','Práctica conservada','2026-01');memory.set(legacyKey,JSON.stringify([original]));
    const {loadProjects}=await import('../src/platform');const projects=await loadProjects();
    expect(projects).toEqual([original]);expect(memory.has(legacyKey)).toBe(false);expect(storage.removeItem).toHaveBeenCalledOnce();
    expect(await loadProjects()).toEqual([original]);
  });
  it('guarda proyectos mayores a la cuota anterior y conserva el orden de guardado y borrado',async()=>{
    const {saveProject,loadProjects,deleteProject}=await import('../src/platform');
    const original=createProject('business','Archivo grande','2026-01');original.notes=['x'.repeat(6*1024*1024)];
    await saveProject(original);expect((await loadProjects())[0].notes[0].length).toBe(6*1024*1024);expect(storage.setItem).not.toHaveBeenCalled();
    await Promise.all([saveProject({...original,name:'Primera revisión'}),saveProject({...original,name:'Última revisión'})]);
    expect((await loadProjects())[0].name).toBe('Última revisión');
    await Promise.all([saveProject({...original,name:'En curso'}),deleteProject(original.id)]);expect(await loadProjects()).toEqual([]);
  });
  it('abre un espacio después de que se escriben los cambios de la pantalla anterior',async()=>{
    vi.stubGlobal('window',{__TAURI_INTERNALS__:{}});
    const {invoke}=await import('@tauri-apps/api/core');
    const project=createProject('individual','Cambio al navegar');
    let finishWrite!:()=>void;
    let persisted:typeof project|undefined;
    vi.mocked(invoke).mockImplementation(async(command,args)=>{
      if(command==='project_save'){
        await new Promise<void>(resolve=>{finishWrite=resolve;});
        persisted=(args as {project:typeof project}).project;
      }
      return command==='projects_load'?(persisted?[persisted]:[]):undefined as never;
    });
    const {loadProjects,saveProject}=await import('../src/platform');
    const saving=saveProject(project);
    await vi.waitFor(()=>expect(finishWrite).toBeTypeOf('function'));
    const opening=loadProjects();
    await Promise.resolve();
    expect(invoke).not.toHaveBeenCalledWith('projects_load',undefined);
    finishWrite();
    await saving;
    await expect(opening).resolves.toEqual([project]);
  });
  it('conserva un almacenamiento anterior dañado y rechaza otra jurisdicción',async()=>{
    memory.set(legacyKey,'{incompleto');const {loadProjects,saveProject}=await import('../src/platform');
    await expect(loadProjects()).rejects.toThrow('conservó intacto');expect(memory.get(legacyKey)).toBe('{incompleto');
    const foreign={...createProject('individual'),jurisdiction:'US'};await expect(saveProject(foreign as never)).rejects.toThrow('no es compatible');
  });
  it('retiene el original si contiene registros de una versión todavía no compatible',async()=>{
    const valid=createProject('student','Compatible','2026-01');const raw=JSON.stringify([valid,{id:'future',name:'Futuro',schemaVersion:2,jurisdiction:'MX'}]);memory.set(legacyKey,raw);
    const {loadProjects}=await import('../src/platform');expect(await loadProjects()).toEqual([valid]);expect(memory.get(legacyKey)).toBe(raw);
  });
  it('no reporta una exportación cancelada como archivo guardado',async()=>{
    vi.stubGlobal('window',{__TAURI_INTERNALS__:{}});const {invoke}=await import('@tauri-apps/api/core');vi.mocked(invoke).mockResolvedValueOnce(null);
    const {exportBytes}=await import('../src/platform');await expect(exportBytes(new Uint8Array([1,2]),'prueba.xlsx')).rejects.toThrow('cancelada');
  });
  it('permite usar IndexedDB cuando el navegador restringe el almacenamiento anterior',async()=>{
    vi.stubGlobal('localStorage',{getItem(){throw new DOMException('Bloqueado','SecurityError');}});
    const {saveProject,loadProjects}=await import('../src/platform');const project=createProject('student','Modo privado','2026-01');
    await saveProject(project);expect(await loadProjects()).toEqual([project]);
  });
  it('espera el fin de la transacción y no devuelve datos de una lectura abortada',async()=>{
    const request={result:[createProject('student','No confirmado')],onsuccess:null as (()=>void)|null,onerror:null as (()=>void)|null};
    const transaction={objectStore:()=>({getAll:()=>request}),oncomplete:null as (()=>void)|null,onerror:null as (()=>void)|null,onabort:null as (()=>void)|null};
    const db={transaction:()=>transaction,close:vi.fn()};const opening={result:db,onsuccess:null as (()=>void)|null};
    vi.stubGlobal('indexedDB',{open:()=>opening});
    const {loadProjects}=await import('../src/platform');const loading=loadProjects();const rejected=expect(loading).rejects.toThrow('interrumpió');
    opening.onsuccess?.();await Promise.resolve();await Promise.resolve();await Promise.resolve();
    let returned=false;void loading.then(()=>{returned=true;},()=>{});
    request.onsuccess?.();await Promise.resolve();expect(returned).toBe(false);
    transaction.onabort?.();await rejected;expect(returned).toBe(false);
  });
  it('cierra una apertura tardía bloqueada y conserva el intento nuevo',async()=>{
    type Opening={result?:unknown;onblocked?:()=>void;onsuccess?:()=>void};const requests:Opening[]=[];
    vi.stubGlobal('indexedDB',{open:vi.fn(()=>{const request:Opening={};requests.push(request);return request;})});
    const {loadProjects}=await import('../src/platform');const first=loadProjects();const rejected=expect(first).rejects.toThrow('otras pestañas');requests[0].onblocked?.();await rejected;
    const second=loadProjects();expect(requests).toHaveLength(2);
    const oldDatabase={close:vi.fn()};requests[0].result=oldDatabase;requests[0].onsuccess?.();expect(oldDatabase.close).toHaveBeenCalledOnce();
    const reads:{request:{result:unknown[];onsuccess?:()=>void};oncomplete?:()=>void}[]=[];
    const db={close:vi.fn(),transaction:()=>{const read={request:{result:[] as unknown[],onsuccess:undefined as (()=>void)|undefined},oncomplete:undefined as (()=>void)|undefined,objectStore:()=>({getAll:()=>read.request})};reads.push(read);return read;}};
    requests[1].result=db;requests[1].onsuccess?.();await vi.waitFor(()=>expect(reads).toHaveLength(1));
    reads[0].request.onsuccess?.();reads[0].oncomplete?.();expect(await second).toEqual([]);
    const third=loadProjects();await vi.waitFor(()=>expect(reads).toHaveLength(2));expect(requests).toHaveLength(2);reads[1].request.onsuccess?.();reads[1].oncomplete?.();expect(await third).toEqual([]);
  });
  it('adjunta la descarga al documento y conserva extensión, tipo y nombre válidos',async()=>{
    vi.useFakeTimers();const appended:unknown[]=[];const active=new Set<unknown>();let name='',blob:Blob|undefined;
    const link={href:'',download:'',hidden:false,click:vi.fn(function(this:{download:string}){expect(active.has(link)).toBe(true);name=this.download;}),remove:vi.fn(()=>active.delete(link))};
    vi.stubGlobal('document',{createElement:()=>link,body:{appendChild:(value:unknown)=>{appended.push(value);active.add(value);}}});
    const revoke=vi.fn();vi.stubGlobal('URL',class extends URL {static createObjectURL(value:Blob){blob=value;return 'blob:contaez';}static revokeObjectURL=revoke;});
    const {exportBytes}=await import('../src/platform');await exportBytes(new Uint8Array([80,75]),'../CON.XLSX');
    expect(appended).toEqual([link]);expect(name).toBe('_CON.XLSX');expect(blob?.type).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');expect(active.size).toBe(0);expect(link.remove).toHaveBeenCalledOnce();
    expect(revoke).not.toHaveBeenCalled();await vi.advanceTimersByTimeAsync(10000);expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:contaez');
  });
  it('libera la URL de una descarga que el navegador no pudo iniciar',async()=>{
    vi.useFakeTimers();const link={click:()=>{throw new Error('Descarga no permitida');},remove:vi.fn()};const revoke=vi.fn();
    vi.stubGlobal('document',{createElement:()=>link,body:{appendChild:vi.fn()}});vi.stubGlobal('URL',class extends URL {static createObjectURL(){return 'blob:fallo';}static revokeObjectURL=revoke;});
    const {exportBytes}=await import('../src/platform');await expect(exportBytes(new Uint8Array([1]),'prueba.xlsx')).rejects.toThrow('no permitida');expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:fallo');expect(link.remove).toHaveBeenCalledOnce();expect(vi.getTimerCount()).toBe(0);
  });
});
