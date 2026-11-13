import type { StudentPracticeResult } from './io/student';
import type { PracticeContextReview } from './io/context';

export interface PracticeContextInput {
  instruction:string;
  references:{name:string;data:Uint8Array;text?:string}[];
  acceptedSuggestionIds?:string[];
}
export type ContextualPracticeResult=StudentPracticeResult & {context?:PracticeContextReview;appliedContextIds?:string[]};

/** Keep workbook analysis off the interface thread so large books stay responsive. */
export function repairStudentPractice(data:Uint8Array, filename:string, answers:Record<string,string>={}, context?:PracticeContextInput):Promise<ContextualPracticeResult> {
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./student.worker.ts',import.meta.url),{type:'module'});
    const finish=()=>{clearTimeout(timer);worker.terminate();};
    const timer=setTimeout(()=>{finish();reject(new Error('La revisión tardó más de lo esperado. Prueba con una copia más pequeña del libro. El original permanece intacto.'));},120000);
    worker.onmessage=(event:MessageEvent<{result?:ContextualPracticeResult;error?:string}>)=>{
      finish();
      if(event.data.result)resolve(event.data.result);
      else reject(new Error(event.data.error||'No se pudo revisar este libro.'));
    };
    worker.onerror=()=>{finish();reject(new Error('No se pudo iniciar la revisión de Excel. Vuelve a abrir ContaEZ e inténtalo otra vez.'));};
    const taskData=data.slice();
    const taskContext=context?{...context,references:context.references.map(reference=>({...reference,data:reference.data.slice()}))}:undefined;
    const transfer=[taskData.buffer,...(taskContext?.references.map(reference=>reference.data.buffer)??[])];
    worker.postMessage({data:taskData,filename,answers,context:taskContext},{transfer});
  });
}
