// A light DSH profile exposes no file/shell/network tools. This monotonic gate
// remains in place even if a trusted plugin unexpectedly registers a tool.
export const name='lilith-aux-no-tools';
export const inject=['tools'];
export function apply(ctx){
 if(typeof ctx.tools.guard!=='function')throw Error('lilith_aux_guard_required');
 ctx.tools.guard(()=> 'LILITH_TOOLS_FORBIDDEN_IN_THIS_CONTEXT');
 ctx.provide('lilithGuardReady',Object.freeze({ready:true,all_tools_use_host_gate:true,tools:false}));
}
