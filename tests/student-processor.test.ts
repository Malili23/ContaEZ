import { afterEach, expect, it, vi } from 'vitest';
import { repairStudentPractice } from '../src/studentProcessor';

afterEach(()=>vi.unstubAllGlobals());

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
