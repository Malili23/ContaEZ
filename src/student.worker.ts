import { repairStudentPractice } from './io/student';
import { inspectPracticeContext, applyPracticeContextSuggestion } from './io/context';
import type { WorkbookFinding } from './io/audit';
import type { PracticeContextInput } from './studentProcessor';

self.onmessage = async (event: MessageEvent<{data: Uint8Array; filename: string; answers: Record<string,string>;context?:PracticeContextInput}>) => {
  try {
    const {data, filename, answers, context} = event.data;
    const review=context&&(context.instruction.trim()||context.references.length)?await inspectPracticeContext(data,context.references,context.instruction):undefined;
    let working=data;
    const appliedContextIds:string[]=[];
    const contextChanges:WorkbookFinding[]=[];
    for(const suggestion of review?.suggestions??[]){
      if(!context?.acceptedSuggestionIds?.includes(suggestion.id))continue;
      working=await applyPracticeContextSuggestion(working,suggestion);
      appliedContextIds.push(suggestion.id);
      contextChanges.push({id:suggestion.id,code:'CONTEXT_CONFIRMED',severity:'info',sheet:suggestion.targetSheet,cell:suggestion.targetCell,message:`Fórmula del modelo confirmada: ${suggestion.source}`,suggestion:suggestion.explanation,repairable:true,original:suggestion.originalFormula??suggestion.originalValue??'',replacement:suggestion.formula});
    }
    if(review&&appliedContextIds.length){review.notes=review.notes.filter(note=>!note.startsWith('Las fórmulas propuestas están pendientes'));review.notes.push(`${appliedContextIds.length} fórmula(s) del modelo confirmadas y aplicadas a la copia de tu práctica. Los datos capturados se conservan.`);}
    const result=Object.assign(await repairStudentPractice(working, filename, answers),{context:review,appliedContextIds});
    result.changes=[...contextChanges,...result.changes];
    self.postMessage({result}, {transfer:[result.data.buffer]});
  } catch (error) {
    self.postMessage({error:error instanceof Error ? error.message : String(error)});
  }
};
