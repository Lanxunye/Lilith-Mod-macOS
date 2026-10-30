// The reading model receives bounded text only. No file, network, shell or social tools.
export const name='lilith-bili-worker-guard';
export const inject=['tools'];
export function apply(ctx){
 if(typeof ctx.tools.guard!=='function')throw Error('bili_worker_guard_required');
 ctx.tools.guard(()=> 'BILI_WORKER_NO_TOOLS');ctx.provide('lilithBiliWorkerReady',{ready:true,tools:false});
}
