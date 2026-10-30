'use strict';
// The host and the native plugin share this exact storage implementation.
// Writes run inside the serialized owner conversation, never from arbitrary tools.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const VERSION='1.2.6-lilith.3',SLOT='lilith-owner';
const DEFAULT_POLICY={baseHalfLifeDays:30,emotionHalfLifeDays:7,baselineWeight:.55,activationWeight:.25,
 importanceWeight:.15,emotionWeight:.05,threshold:.35,maxItems:6,maxChars:800,dailyQuota:8,rarityK:1,
 queryGate:.8,factsMax:2,unknownActivation:.5};
const hash=s=>crypto.createHash('sha256').update(String(s)).digest('hex');
function json(file,fallback){try{if(fs.statSync(file).size>16*1024*1024)throw Error('too_large');return JSON.parse(fs.readFileSync(file,'utf8'));}catch(e){if(e.code==='ENOENT')return fallback;throw Error('lilith_memory_data_invalid');}}
function atomic(file,value){fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
 fs.writeFileSync(file+'.tmp',JSON.stringify(value,null,2)+'\n',{mode:0o600});fs.renameSync(file+'.tmp',file);fs.chmodSync(file,0o600);}
function sensitive(text){return /密码|密碼|口令|验证码|驗證碼|身份证|身分證|护照|銀行卡|银行卡|信用卡|api[\s_-]*key|access[\s_-]*token|refresh[\s_-]*token|secret|password|passport|cvv|Bearer\s+\S+|sk-[\w-]{12,}/i.test(String(text));}
const day=t=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(t));
function activation(m,p,now=Date.now()){
 if(m.category==='stable_profile')return p.unknownActivation;
 const anchor=Date.parse(m.activationAnchor||m.at||m.createdAt||m.importAt||'');
 if(!Number.isFinite(anchor))return p.unknownActivation;
 return (m.activation0??1)*Math.pow(2,-Math.max(0,now-anchor)/86400000/(p.baseHalfLifeDays*(1+2*(m.importance||0))));
}
class MemoryStore{
 constructor(home){this.dir=path.join(home,'fish-memory');this.file=path.join(this.dir,SLOT+'.json');
  this.configFile=path.join(this.dir,'lilith-config.json');this.traceFile=path.join(this.dir,'lilith-trace.json');
  fs.mkdirSync(this.dir,{recursive:true,mode:0o700});fs.chmodSync(this.dir,0o700);
  if(!fs.existsSync(this.configFile))atomic(this.configFile,{enabled:true,policy:DEFAULT_POLICY});
  if(!fs.existsSync(this.file))this.save(this.blank());
 }
 blank(){return {version:2,memories:[],deleted:[],seen_ids:[],legacy_imported:false,cutoff:0};}
 config(){const c=json(this.configFile,{enabled:false,policy:DEFAULT_POLICY});return {enabled:c.enabled===true,policy:{...DEFAULT_POLICY,...c.policy}};}
 load(){const d=json(this.file,null);if(!d||!Array.isArray(d.memories)||!Array.isArray(d.deleted))throw Error('lilith_memory_store_invalid');return d;}
 save(data){
  // Keep the previous state and the first state of each day in the private
  // backup folder; no archive deletion or hidden filesystem scanning.
  if(fs.existsSync(this.file)){
   fs.copyFileSync(this.file,this.file+'.bak');fs.chmodSync(this.file+'.bak',0o600);
   const backup=path.join(this.dir,'backups',day(Date.now())+'.json');
   if(!fs.existsSync(backup)){fs.mkdirSync(path.dirname(backup),{recursive:true,mode:0o700});fs.copyFileSync(this.file,backup,fs.constants.COPYFILE_EXCL);fs.chmodSync(backup,0o600);}
  }
  atomic(this.file,data);
 }
 patch(input){const c=this.config();const bounds={baseHalfLifeDays:[15,60],maxItems:[1,12],maxChars:[200,3000],dailyQuota:[1,30],threshold:[.1,.8],factsMax:[0,6],queryGate:[0,2]};
  for(const [k,v]of Object.entries(input||{})){
   if(k==='enabled'&&typeof v==='boolean')c.enabled=v;
   else if(bounds[k]&&Number.isFinite(v)&&v>=bounds[k][0]&&v<=bounds[k][1]&&(!['maxItems','maxChars','dailyQuota','factsMax'].includes(k)||Number.isInteger(v)))c.policy[k]=v;
   else throw Object.assign(Error('invalid_memory_setting'),{code:'invalid_memory_setting'});
  }atomic(this.configFile,c);return c;
 }
 importLegacy(records){const d=this.load();if(d.legacy_imported)return {imported:0,already_imported:true};
  let count=0;
  for(const r of records||[]){
   if(!r?.source_id||typeof r.quote!=='string'||r.quote.length<2||r.quote.length>600||sensitive(r.quote)||!Number.isFinite(Date.parse(r.at)))continue;
   const id='legacy-'+hash(r.source_id+'|'+r.key+'|'+r.quote).slice(0,24);
   if(d.memories.some(m=>m.id===id)||d.deleted.some(m=>m.id===id))continue;
   d.memories.push({id,text:'主人曾说：'+r.quote,at:r.time_unknown?null:r.at,createdAt:r.at,importAt:new Date().toISOString(),
    category:r.kind==='fact'?'stable_profile':'event',importance:r.kind==='fact'?.7:.5,emotion:null,
    tags:[String(r.key||'').slice(0,40)].filter(Boolean),source:{kind:'legacy_archive',source_id:r.source_id,quote:r.quote},
    ...(r.kind==='fact'&&r.key?{'事实键':'主人.'+String(r.key).slice(0,40)}:{})});count++;
  }
  d.legacy_imported=true;d.imported_at=new Date().toISOString();this.save(d);return {imported:count,already_imported:false};
 }
 capture(turn,value){
  const cfg=this.config();if(!cfg.enabled||!['desktop','qq'].includes(turn.channel))return {stored:0,reinforced:0,rejected:0};
  const d=this.load();if(d.seen_ids.includes(turn.id))return {stored:0,reinforced:0,rejected:0,duplicate:true};
  const at=new Date(turn.at).toISOString(),today=day(turn.at);let stored=0,reinforced=0,rejected=0;
  const candidates=[...(Array.isArray(value.memory_updates)?value.memory_updates:[]).slice(0,6).map(x=>({...x,category:'stable_profile'})),
   ...(Array.isArray(value.memory_events)?value.memory_events:[]).slice(0,2).map(x=>({...x,category:'event'}))].slice(0,6);
  let used=d.memories.filter(m=>m.source?.kind==='turn'&&day(m.createdAt)===today).length;
  for(const c of candidates){
   const quote=typeof c.evidence==='string'?c.evidence.trim():'';
   const key=typeof c.key==='string'?c.key.trim().slice(0,48):'';
   if(quote.length<2||quote.length>400||!turn.text.includes(quote)||sensitive(quote+' '+key+' '+String(c.value||''))||
    /(?:我|你|莉莉丝).{0,5}(?:记住|忘记)|(?:提示词|系统指令|system prompt|ignore.*instructions)/i.test(quote)||
    c.category==='stable_profile'&&(!key||/^(?:其他|相关|内容|记忆|事实|preference|fact)$/i.test(key))){rejected++;continue;}
   // Store the proven quote, not a free-form model paraphrase. Tags select
   // candidates; they never become asserted facts in the recall text.
   const factKey=c.category==='stable_profile'?'主人.'+key:'';
   const old=d.memories.find(m=>!m.已被取代&&m.category===c.category&&m.source?.quote===quote);
   if(old){
    if(old.lastReinforcedDay!==today){const a=activation(old,cfg.policy,turn.at);old.activation0=a+.2*(1-a);
     old.activationAnchor=at;old.reinforcedAt=at;old.lastReinforcedDay=today;old.reinforceCount=(old.reinforceCount||0)+1;reinforced++;}
    continue;
   }
   const previous=factKey?d.memories.filter(m=>!m.已被取代&&m['事实键']===factKey):[];
   if(used>=cfg.policy.dailyQuota&&!previous.length){rejected++;continue;}
   const id='m-'+hash(turn.id+'|'+c.category+'|'+key+'|'+quote).slice(0,24);
   if(d.deleted.some(m=>m.id===id)){rejected++;continue;}
   for(const old of previous){old.已被取代={by:id,at,reason:'同一事实键的新原话'};}
   d.memories.push({id,text:'主人说：'+quote,at,createdAt:at,category:c.category,
    importance:Number.isFinite(c.importance)?Math.max(0,Math.min(1,c.importance)):(factKey?.7:.5),emotion:null,
    tags:(Array.isArray(c.tags)?c.tags:[]).filter(x=>typeof x==='string'&&!sensitive(x)).map(x=>x.slice(0,24)).slice(0,6),
    source:{kind:'turn',source_id:turn.source_id||turn.id,channel:turn.channel,session:turn.session,quote},
    ...(factKey?{'事实键':factKey}:{}),activation0:1,activationAnchor:at});stored++;used++;
  }
  d.seen_ids=[...d.seen_ids,turn.id].slice(-500);this.save(d);return {stored,reinforced,rejected};
 }
 forgetAll(){const d=this.load();d.deleted.push(...d.memories.map(m=>({...m,deleted_at:new Date().toISOString()})));
  d.memories=[];d.legacy_imported=true;d.cutoff=Date.now();this.save(d);atomic(this.traceFile,{picked:[],rows:[]});}
 replaceStable(facts){const d=this.load();const previous=d.memories.filter(m=>m.category==='stable_profile');
  d.deleted.push(...previous.map(m=>({...m,deleted_at:new Date().toISOString()})));d.memories=d.memories.filter(m=>m.category!=='stable_profile');
  for(const f of facts||[]){if(!f.key||!f.value||sensitive(f.key+' '+f.value))continue;
   const at=new Date().toISOString();d.memories.push({id:'manual-'+crypto.randomUUID(),text:'主人手动设置：'+f.key+'：'+f.value,
    category:'stable_profile',at,createdAt:at,importance:.7,tags:[f.key],source:{kind:'manual',quote:f.value},'事实键':'主人.'+f.key});}
  this.save(d);
 }
 trace(value){atomic(this.traceFile,value);}
}
function readMemory(home,pid){
 const dir=path.join(home,'fish-memory');let s,c,d,tr;
 try{s=json(path.join(dir,'lilith-status.json'),{});c=json(path.join(dir,'lilith-config.json'),{enabled:false,policy:DEFAULT_POLICY});
  d=json(path.join(dir,SLOT+'.json'),{memories:[],deleted:[]});tr=json(path.join(dir,'lilith-trace.json'),{});
 }catch{return {installed:true,loaded:false,error:'lilith_memory_data_invalid',counts:{},memories:[],config:{enabled:false,policy:DEFAULT_POLICY}};}
 const active=(d.memories||[]).filter(m=>!m.已被取代);
 return {installed:!!s.version,loaded:s.loaded===true&&s.pid===pid,version:s.version||'',config:c,counts:s.counts||{},error:s.error||'',
  total:active.length,superseded:(d.memories||[]).length-active.length,deleted:d.deleted?.length||0,last_recall:tr,
  memories:active.slice(-100).reverse().map(m=>({id:m.id,text:m.text,at:m.at,category:m.category,importance:m.importance,
   activation:activation(m,{...DEFAULT_POLICY,...c.policy}),source:m.source?.kind||'',reinforce_count:m.reinforceCount||0})),
  legacy_imported:d.legacy_imported===true,imported_at:d.imported_at||''};
}
const MEMORY_CONTRACT='长期记忆由宿主静默维护。memory_updates 仍只记本轮主人明确说出的稳定偏好/事实；key必须具体，如 favorite_drink，勿用万能键preference。可以为每条补充tags（至多6个检索词）和importance（0到1）。另可返回 memory_events:[{"evidence":"本轮主人原话连续摘录","tags":["关键词"],"importance":0.5}]，至多2条，只选择值得日后回想的重要经历、约定或进展，不记日常流水。无法从主人的原话找到证据则不记；不把莉莉丝的推测、网页、引用的他人或工具结果记成主人的事实。空时两个数组均为空。不要在回复里汇报内部记账。';
const MEMORY_OFF_CONTRACT='本轮长期记忆已关闭，不新增、不召回；memory_updates和memory_events都必须返回空数组。可以在当前对话中回应这句话，但不要声称已经保存、记下或以后还会记得。';
module.exports={MemoryStore,readMemory,sensitive,activation,DEFAULT_POLICY,VERSION,SLOT,MEMORY_CONTRACT,MEMORY_OFF_CONTRACT};
