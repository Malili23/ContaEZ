import { afterEach, expect, it, vi } from 'vitest';
import { repairStudentPractice } from '../src/studentProcessor';

afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});

it('permite revisar nuevamente el mismo original y contexto después de transferir datos al trabajador',async()=>{
  class TestWorker {
    onmessage:((event:MessageEvent)=>void)|null=null;
    onerror:((event:Event)=>void)|null=null;
    terminate(){}
    postMessage(message:unknown,options:{transfer:ArrayBuffer[]}){
      const received=structuredClone(message,{transfer:options.transfer}) as {data:Uint8Array};
      queueMicrotask(()=>this.onmessage?.({data:{result:{data:received.data}}} as MessageEvent));
    }
  }
  vi.stubGlobal('Worker',TestWorker);
  const original=new Uint8Array([80,75,3,4]),reference=new Uint8Array([80,75,5,6]);
  const context={instruction:'Revisar Diario!C1',references:[{name:'Modelo.xlsx',data:reference}]};
  const first=await repairStudentPractice(original,'Práctica.xlsx',{},context);
  expect([...original]).toEqual([80,75,3,4]);expect([...reference]).toEqual([80,75,5,6]);
  const second=await repairStudentPractice(original,'Práctica.xlsx',{},context);
  expect([...first.data]).toEqual([...second.data]);expect(second.data.byteLength).toBe(4);
});

it('rechaza un trabajador que no puede crearse sin dejar un temporizador',async()=>{
  vi.useFakeTimers();
  vi.stubGlobal('Worker',class {constructor(){throw new Error('CSP');}});
  await expect(repairStudentPractice(new Uint8Array([1]),'Práctica.xlsx')).rejects.toThrow('preparar');
  expect(vi.getTimerCount()).toBe(0);
});

it('cierra el trabajador y conserva los originales si no puede enviar la tarea',async()=>{
  vi.useFakeTimers();const terminate=vi.fn();
  vi.stubGlobal('Worker',class {terminate=terminate;postMessage(){throw new DOMException('No se pudo clonar','DataCloneError');}});
  const original=new Uint8Array([80,75,1,2]),model=new Uint8Array([80,75,3,4]);
  await expect(repairStudentPractice(original,'Práctica.xlsx',{}, {instruction:'',references:[{name:'Modelo.xlsx',data:model}]})).rejects.toThrow('preparar');
  expect(terminate).toHaveBeenCalledOnce();expect(vi.getTimerCount()).toBe(0);
  expect([...original]).toEqual([80,75,1,2]);expect([...model]).toEqual([80,75,3,4]);
});

it.each(['messageerror','error','malformed'] as const)('finaliza una sola vez ante %s y libera sus recursos',async failure=>{
  vi.useFakeTimers();let worker!:TestWorker;
  class TestWorker {
    onmessage:((event:MessageEvent)=>void)|null=null;
    onerror:((event:Event)=>void)|null=null;
    onmessageerror:((event:MessageEvent)=>void)|null=null;
    terminate=vi.fn();constructor(){worker=this;}postMessage(){}
  }
  vi.stubGlobal('Worker',TestWorker);
  const task=repairStudentPractice(new Uint8Array([1]),'Práctica.xlsx');
  const lateMessage=worker.onmessage;
  const rejected=expect(task).rejects.toThrow('No se pudo');
  if(failure==='messageerror')worker.onmessageerror?.({} as MessageEvent);
  else if(failure==='error')worker.onerror?.({} as Event);
  else worker.onmessage?.({data:{result:{data:'no es un libro'}}} as MessageEvent);
  await rejected;
  lateMessage?.({data:{result:{data:new Uint8Array([1])}}} as MessageEvent);
  expect(worker.terminate).toHaveBeenCalledOnce();expect(worker.onmessage).toBeNull();expect(worker.onerror).toBeNull();expect(worker.onmessageerror).toBeNull();expect(vi.getTimerCount()).toBe(0);
});

it('interrumpe una revisión agotada y permite iniciar otra',async()=>{
  vi.useFakeTimers();const workers:{terminate:ReturnType<typeof vi.fn>}[]=[];
  vi.stubGlobal('Worker',class {terminate=vi.fn();constructor(){workers.push(this);}postMessage(){}});
  const task=repairStudentPractice(new Uint8Array([1]),'Práctica.xlsx');
  const rejected=expect(task).rejects.toThrow('tardó más');await vi.advanceTimersByTimeAsync(120000);await rejected;
  expect(workers[0].terminate).toHaveBeenCalledOnce();expect(vi.getTimerCount()).toBe(0);
  const retry=repairStudentPractice(new Uint8Array([1]),'Práctica.xlsx');
  const retryRejected=expect(retry).rejects.toThrow('tardó más');await vi.advanceTimersByTimeAsync(120000);await retryRejected;
  expect(workers).toHaveLength(2);expect(workers[1].terminate).toHaveBeenCalledOnce();
});
