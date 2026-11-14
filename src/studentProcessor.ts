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
    let worker:Worker|undefined,timer:ReturnType<typeof setTimeout>|undefined,settled=false;
    const finish=(error?:Error,result?:ContextualPracticeResult)=>{
      if(settled)return;settled=true;if(timer!==undefined)clearTimeout(timer);
      if(worker){worker.onmessage=null;worker.onerror=null;worker.onmessageerror=null;try{worker.terminate();}catch{/* Settlement must not depend on a browser cleanup error. */}}
      if(error)reject(error);else resolve(result!);
    };
    try{
      worker=new Worker(new URL('./student.worker.ts',import.meta.url),{type:'module'});
      worker.onmessage=(event:MessageEvent<{result?:ContextualPracticeResult;error?:string}|null>)=>{
        if(event.data?.result?.data instanceof Uint8Array)finish(undefined,event.data.result);
        else finish(new Error(event.data?.error||'No se pudo revisar este libro.'));
      };
      worker.onerror=()=>finish(new Error('No se pudo iniciar la revisión de Excel. Vuelve a abrir ContaEZ e inténtalo otra vez.'));
      worker.onmessageerror=()=>finish(new Error('No se pudo recibir la revisión de Excel. Vuelve a intentarlo; el original permanece intacto.'));
      timer=setTimeout(()=>finish(new Error('La revisión tardó más de lo esperado. Prueba con una copia más pequeña del libro. El original permanece intacto.')),120000);
      const taskData=data.slice();
      const taskContext=context?{...context,references:context.references.map(reference=>({...reference,data:reference.data.slice()}))}:undefined;
      const transfer=[taskData.buffer,...(taskContext?.references.map(reference=>reference.data.buffer)??[])];
      worker.postMessage({data:taskData,filename,answers,context:taskContext},{transfer});
    }catch(error){finish(new Error('No se pudo preparar la revisión de Excel. '+(error instanceof Error?error.message:String(error))));}
  });
}
