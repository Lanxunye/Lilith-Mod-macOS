'use strict';
const fs=require('node:fs'),path=require('node:path');
const FIELDS=['inputTokens','cacheReadTokens','cacheWriteTokens','outputTokens','totalTokens'];
const add=(target,usage)=>{for(const k of FIELDS)target[k]=(target[k]||0)+(Number.isFinite(usage?.[k])?Math.max(0,usage[k]):0);};
class DshCost{
 constructor(root,{now=Date.now}={}){this.file=path.join(root,'cost-usage.json');this.now=now;try{this.data=JSON.parse(fs.readFileSync(this.file,'utf8'));}catch{this.data={version:1,days:{}};}if(!this.data?.days||typeof this.data.days!=='object')this.data={version:1,days:{}};this.circuit=null;}
 day(){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(this.now());}
 record(kind,usage){if(!usage)return;kind=/^[a-z][a-z0-9_-]{0,48}$/.test(kind)?kind:'other';const day=this.day(),rows=this.data.days[day]??={},row=rows[kind]??={calls:0};row.calls++;add(row,usage);try{this.save();this.error='';}catch{this.error='dsh_cost_write_failed';}}
 save(){const days=Object.keys(this.data.days).sort();for(const day of days.slice(0,-31))delete this.data.days[day];fs.mkdirSync(path.dirname(this.file),{recursive:true,mode:0o700});fs.writeFileSync(this.file+'.tmp',JSON.stringify(this.data),{mode:0o600});fs.renameSync(this.file+'.tmp',this.file);}
 fail(code){if(['AUTH','QUOTA'].includes(code))this.circuit={code:code==='AUTH'?'dsh_auth_failed':'dsh_quota_exceeded',until:this.now()+300000};}
 check(){if(this.circuit&&this.circuit.until>this.now())throw Object.assign(Error(this.circuit.code),{code:this.circuit.code});this.circuit=null;}
 reset(){this.circuit=null;}
 status(){return {scope:'main_and_aux_sdk_events',error:this.error||'',excludes:['direct_plugin_llm_calls','independent_readers','vision_provider','search_request_fees'],timezone:'Asia/Shanghai',day:this.day(),by_module:this.data.days[this.day()]||{},circuit:this.circuit&&this.circuit.until>this.now()?{...this.circuit}:null,history_mode:'bounded_authoritative_snapshot',history_char_budget:16000,group_history_limit:5,group_history_char_budget:4000,group_memory_limit:4,group_auto_summary:false,decision_reasoning:'off',rea_disabled:true};}
}
// Authoritative visible delivery history, never previous hidden/cancelled output.
// Preserve whole newest messages; the raw archive and long-term memory are intact.
function boundedPrompt(prompt,budget=16000,limit=24){let value;try{value=JSON.parse(prompt);}catch{return prompt;}if(!Array.isArray(value.recent_visible_conversation))return prompt;
 const selected=[];let chars=0;for(const row of value.recent_visible_conversation.slice(-limit).reverse()){const n=JSON.stringify(row).length;if(chars+n>budget)break;selected.unshift(row);chars+=n;}
 return JSON.stringify({...value,recent_visible_conversation:selected});
}
module.exports={DshCost,boundedPrompt};
