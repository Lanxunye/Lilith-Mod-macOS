'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
function canonical(value){if(value===null||typeof value!=='object')return JSON.stringify(value);if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';}
const digest=value=>crypto.createHash('sha256').update(canonical(value)).digest('hex');
// Deny exact empty/no-op shell placeholders; never parse or approve compound shell.
function isNoopTool(tool,args){return tool==='bash'&&typeof args?.command==='string'&&['','true',':'].includes(args.command.trim());}
class DshApprovals{
 constructor({root,workspace,now=Date.now}){this.workspace=fs.realpathSync(workspace);this.now=now;this.file=path.join(root,'approvals.json');this.active=new Map();this.records=[];try{this.records=JSON.parse(fs.readFileSync(this.file,'utf8'));}catch{}for(const r of this.records)if(['pending','approved'].includes(r.state))r.state='expired';this.save();}
 save(){fs.mkdirSync(path.dirname(this.file),{recursive:true,mode:0o700});const tmp=this.file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(this.records.slice(-200)),{mode:0o600});fs.renameSync(tmp,this.file);}
 enter(session,context){this.active.set(session,{...context,workspace:this.workspace});}
 leave(session){this.active.delete(session);}
 list(session){return this.records.filter(r=>(!session||r.conversation===session)&&r.state==='pending'&&r.expires_at>this.now()).map(r=>({...r}));}
 request(input){
  const c=this.active.get(input.session_id),hash=digest(input.arguments);
  if(!c||c.tools!==true||!['desktop','qq'].includes(c.channel))return {approved:false,reason:'LILITH_TOOLS_FORBIDDEN_IN_THIS_CONTEXT'};
  if(input.workspace!==this.workspace||hash!==input.arguments_sha256||typeof input.tool_name!=='string'||!input.call_id||!input.request_id)return {approved:false,reason:'LILITH_GUARD_INVALID_REQUEST'};
  if(isNoopTool(input.tool_name,input.arguments))return {approved:false,reason:'LILITH_NOOP_TOOL_REJECTED'};
  const grant=()=>({approved:true,request_id:input.request_id,session_id:input.session_id,call_id:input.call_id,tool_name:input.tool_name,arguments_sha256:hash,workspace:this.workspace,expires_at:this.now()+10000});
  // These capabilities are registered by our own plugin, which verifies definition identity.
  if(input.trusted_readonly===true&&input.readonly_policy==='lilith-readonly-v1'&&['lilith_read','lilith_list'].includes(input.tool_name))return grant();
  const approved=this.records.find(r=>r.state==='approved'&&r.session_id===input.session_id&&r.tool_name===input.tool_name&&r.arguments_sha256===hash&&r.expires_at>this.now());
  if(approved){approved.state='consumed';approved.consumed_at=this.now();this.save();return grant();}
  let r=this.records.find(r=>r.state==='pending'&&r.session_id===input.session_id&&r.tool_name===input.tool_name&&r.arguments_sha256===hash&&r.expires_at>this.now());
  if(!r){r={id:crypto.randomBytes(5).toString('hex'),challenge:crypto.randomBytes(3).toString('hex'),session_id:input.session_id,conversation:c.conversation,channel:c.channel,tool_name:input.tool_name,arguments:input.arguments,arguments_sha256:hash,workspace:this.workspace,state:'pending',created_at:this.now(),expires_at:this.now()+10*60*1000};this.records.push(r);}
  // A pending operation may be requested again, but only that originating turn
  // may replace its reply with a confirmation prompt. Old pending items stay in UI.
  r.last_requested_turn=c.approvalTurn||null;this.save();
  return {approved:false,reason:'LILITH_CONFIRMATION_REQUIRED',approval_id:r.id,confirmation:this.phrase(r)};
 }
 phrase(r){return `确认执行 ${r.id} ${r.challenge}`;}
 confirm(id,phrase,{conversation,channel}={}){const r=this.records.find(r=>r.id===id&&r.state==='pending'&&r.expires_at>this.now());if(!r||phrase!==this.phrase(r)||conversation&&conversation!==r.conversation||channel&&channel!==r.channel)throw Object.assign(Error('dsh_confirmation_invalid'),{code:'dsh_confirmation_invalid'});r.state='approved';r.expires_at=this.now()+120000;this.save();return {...r};}
 confirmMessage(text,context){const m=String(text).trim().match(/^确认执行 ([a-f0-9]{10}) ([a-f0-9]{6})$/);return m?this.confirm(m[1],text.trim(),context):null;}
 deny(id){const r=this.records.find(r=>r.id===id&&['pending','approved'].includes(r.state));if(r){r.state='denied';this.save();}return {ok:true};}
 clear(){for(const r of this.records)if(['pending','approved'].includes(r.state))r.state='expired';this.active.clear();this.save();}
}
module.exports={DshApprovals,canonical,digest,isNoopTool};
