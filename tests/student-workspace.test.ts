import { expect, it, vi } from 'vitest';
import { commitPracticeRecord, createPracticeTaskGate } from '../src/StudentWorkspace';

it('impide otra acción durante todo un lote, incluso entre dos archivos',async()=>{
 const gate=createPracticeTaskGate();let continueBatch!:()=>void;
 const firstFileDone=new Promise<void>(resolve=>{continueBatch=resolve;});
 const events:string[]=[];
 const batch=gate.run(async()=>{events.push('archivo 1');await firstFileDone;events.push('archivo 2');});
 const duplicate=vi.fn(async()=>events.push('acción duplicada'));
 expect(gate.active).toBe(true);await gate.run(duplicate);expect(duplicate).not.toHaveBeenCalled();
 continueBatch();await batch;expect(events).toEqual(['archivo 1','archivo 2']);expect(gate.active).toBe(false);
 await gate.run(duplicate);expect(duplicate).toHaveBeenCalledOnce();
});

it('libera el espacio después de un error para poder reintentar sin concurrencia',async()=>{
 const gate=createPracticeTaskGate();
 await expect(gate.run(async()=>{throw new Error('sin espacio');})).rejects.toThrow('sin espacio');
 expect(gate.active).toBe(false);
 await expect(gate.run(async()=>42)).resolves.toBe(42);
});

it('muestra una revisión únicamente después de que termina el guardado',async()=>{
 let finishWrite!:()=>void;const written=new Promise<void>(resolve=>{finishWrite=resolve;});
 const original={id:'práctica',updatedAt:'anterior',revision:1};const publish=vi.fn();
 const save=vi.fn(async()=>{await written;});
 const committing=commitPracticeRecord(original,save,publish);
 expect(save).toHaveBeenCalledOnce();expect(publish).not.toHaveBeenCalled();expect(original.updatedAt).toBe('anterior');
 finishWrite();const result=await committing;
 expect(publish).toHaveBeenCalledExactlyOnceWith(result);expect(result.updatedAt).not.toBe('anterior');
 expect(original).toEqual({id:'práctica',updatedAt:'anterior',revision:1});
});

it('conserva la versión visible al fallar el guardado y solo publica un reintento confirmado',async()=>{
 const visible={id:'práctica',updatedAt:'anterior',revision:1};let current=visible;
 const publish=vi.fn((saved:typeof visible)=>{current=saved;});
 const failed=vi.fn(async()=>{throw new Error('disco lleno');});
 await expect(commitPracticeRecord({...visible,revision:2},failed,publish)).rejects.toThrow('disco lleno');
 expect(current).toBe(visible);expect(publish).not.toHaveBeenCalled();
 const retry=vi.fn(async()=>{});await commitPracticeRecord({...visible,revision:2},retry,publish);
 expect(current.revision).toBe(2);expect(publish).toHaveBeenCalledOnce();
});
