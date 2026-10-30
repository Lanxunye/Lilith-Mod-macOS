import fs from 'node:fs';
import path from 'node:path';
import {算基础命中线,算命中线,lilithCore} from './upstream/host.js';
export const name='lilith-speak-up';
export const inject=[];
export const version='0.2.3-lilith.1';
export function calculate(config,misses,lastActivity,at){
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(at)).map(p=>[p.type,p.value]));
 const date=new Date(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:00`);
 const age=(at-lastActivity)/60000,factor=age<20?.15:age>360?1.5:1;
 const base=算基础命中线({...lilithCore.defaults,峰时命中线:config.peak_percent,谷时命中线:config.offpeak_percent},date);
 const chance=算命中线(base.基础命中线,factor,misses,config.miss_bonus,config.bonus_cap);
 return {quiet:lilithCore.quiet(Number(parts.hour),config.quiet_start,config.quiet_end),day:`${parts.year}-${parts.month}-${parts.day}`,
  peak:base.峰,base:base.基础命中线,factor,bonus:chance.加成,threshold:chance.线};
}
export function apply(ctx){
 if(!process.env.DSH_HOME)throw Error('lilith_speak_home_required');
 const dir=path.join(process.env.DSH_HOME,'speak-up');fs.mkdirSync(dir,{recursive:true,mode:0o700});
 const file=path.join(dir,'lilith-status.json');
 const publish=loaded=>{fs.writeFileSync(file+'.tmp',JSON.stringify({version,pid:process.pid,loaded,at:Date.now()}),{mode:0o600});fs.renameSync(file+'.tmp',file);fs.chmodSync(file,0o600);};
 publish(true);ctx.provide('lilithSpeakUpReady',{ready:true,version});ctx.effect(()=>()=>publish(false));
}
