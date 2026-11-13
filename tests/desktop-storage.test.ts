import { beforeEach, describe, expect, it, vi } from 'vitest';
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
});
