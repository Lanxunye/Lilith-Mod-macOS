'use strict';
const fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url'),{randomUUID}=require('node:crypto');
const DEFAULTS={enabled:true,dry_run:true,targets:['desktop','qq'],interval_minutes:30,cooldown_minutes:20,min_idle_minutes:20,
 quiet_start:1,quiet_end:8,peak_percent:20,offpeak_percent:60,miss_bonus:10,bonus_cap:40,daily_limit:4};
function json(file,fallback){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch(e){if(e.code==='ENOENT')return fallback;throw Error('lilith_speak_data_invalid');}}
function atomic(file,data){fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});fs.writeFileSync(file+'.tmp',JSON.stringify(data,null,2),{mode:0o600});fs.renameSync(file+'.tmp',file);fs.chmodSync(file,0o600);}
class SpeakUp{
 constructor({home,getEnvironment,deliver,now=Date.now,random=Math.random,autoTick=true,loadEngine}){
  this.dir=path.join(home,'speak-up');this.configFile=path.join(this.dir,'lilith-config.json');this.stateFile=path.join(this.dir,'lilith-state.json');
  this.getEnvironment=getEnvironment;this.deliver=deliver;this.now=now;this.random=random;this.busy=false;this.closed=false;
  if(!fs.existsSync(this.configFile))atomic(this.configFile,{...DEFAULTS,revision:1});
  this.state=json(this.stateFile,{next_check_at:now()+DEFAULTS.interval_minutes*60000,misses:0,day:'',attempts:0,logs:[],last_attempt_at:0,last_sent_at:0,awaiting_owner_seq:0});
  if(this.state.inflight){this.state.logs.push({at:now(),result:'interrupted',id:this.state.inflight});delete this.state.inflight;this.save();}
  this.ready=(loadEngine?loadEngine():import(pathToFileURL(path.join(home,'profiles/lilith/node_modules/dsh-speak-up/index.mjs')).href)).then(x=>(this.engine=x));
  this.ready.catch(()=>{});this.timer=autoTick?setInterval(()=>void this.tick().catch(()=>{}),15000):null;this.timer?.unref();
 }
 save(){atomic(this.stateFile,this.state);}
 config(){return {...DEFAULTS,...json(this.configFile,{enabled:false})};}
 patch(body){const c=this.config(),range={interval_minutes:[1,1440],cooldown_minutes:[1,1440],min_idle_minutes:[1,1440],quiet_start:[0,23],quiet_end:[0,23],peak_percent:[0,100],offpeak_percent:[0,100],miss_bonus:[0,100],bonus_cap:[0,100],daily_limit:[1,24]};
  for(const [k,v]of Object.entries(body||{})){
   if(['enabled','dry_run'].includes(k)&&typeof v==='boolean')c[k]=v;
   else if(k==='targets'&&Array.isArray(v)&&v.every(x=>['desktop','qq'].includes(x)))c.targets=[...new Set(v)];
   else if(range[k]&&Number.isFinite(v)&&Number.isInteger(v)&&v>=range[k][0]&&v<=range[k][1])c[k]=v;
   else throw Object.assign(Error('invalid_speak_setting'),{code:'invalid_speak_setting'});
  }
  c.revision=(c.revision||0)+1;atomic(this.configFile,c);this.state.next_check_at=this.now()+c.interval_minutes*60000;this.save();return c;
 }
 environment(){return this.getEnvironment();}
 plan(config,env,at=this.now()){
  const calc=this.engine.calculate(config,this.state.misses,env.last_activity_at||at,at);
  let reason='ready';
  if(this.closed||!config.enabled)reason='disabled';
  else if(!config.targets.length)reason='no_target';
  else if(calc.quiet)reason='quiet_hours';
  else if(!env.loaded||!env.warm)reason='no_live_conversation';
  else if(env.busy||env.pending_owner)reason='conversation_busy';
  else if(config.targets.includes('qq')&&!env.qq_available)reason='qq_unavailable';
  else if(!env.last_owner_seq)reason='no_owner_history';
  else if(at-env.last_activity_at<config.min_idle_minutes*60000)reason='recent_conversation';
  else if(this.state.day===calc.day&&this.state.attempts>=config.daily_limit)reason='daily_limit';
  else if(this.state.last_attempt_at&&at-this.state.last_attempt_at<config.cooldown_minutes*60000)reason='cooldown';
  else if(this.state.awaiting_owner_seq&&env.last_owner_seq<=this.state.awaiting_owner_seq)reason='awaiting_owner';
  return {...calc,reason,eligible:reason==='ready'};
 }
 async preview(){await this.ready;const c=this.config();return {...this.plan(c,this.environment()),dry_run:c.dry_run,config:c,model_calls:0};}
 status(){const runtime=json(path.join(this.dir,'lilith-status.json'),{}),day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(new Date(this.now()));return {installed:true,version:runtime.version||'',runtime_pid:runtime.pid,loaded:runtime.loaded===true,
  config:this.config(),next_check_at:this.state.next_check_at,last_sent_at:this.state.last_sent_at,awaiting_owner:this.state.awaiting_owner_seq>0&&this.environment().last_owner_seq<=this.state.awaiting_owner_seq,
  attempts_today:this.state.day===day?this.state.attempts:0,day:this.state.day,logs:this.state.logs.slice(-60),busy:this.busy};}
 log(row){this.state.logs.push(row);this.state.logs=this.state.logs.slice(-60);this.save();}
 async tick(){if(this.closed||this.busy)return {result:'busy'};await this.ready;
  const now=this.now(),c=this.config();if(!c.enabled||now<this.state.next_check_at)return {result:'not_due'};
  this.busy=true;
  try{
   const env=this.environment(),plan=this.plan(c,env,now);this.state.next_check_at=now+c.interval_minutes*60000;
   if(!plan.eligible){this.log({at:now,result:plan.reason});return {result:plan.reason};}
   const roll=this.random()*100,hit=roll<plan.threshold;
   this.state.misses=hit?0:this.state.misses+1;
   if(!hit||c.dry_run){const result=!hit?'miss':'dry_hit';this.log({at:now,result,roll,threshold:plan.threshold});return {result};}
   const id=randomUUID();this.state.inflight=id;this.state.last_attempt_at=now;
   if(this.state.day!==plan.day){this.state.day=plan.day;this.state.attempts=0;}this.state.attempts++;this.save();
   const result=await this.deliver({id,config:c,env,stillValid:()=>{
    const latest=this.config(),e=this.environment();return !this.closed&&e.loaded&&e.warm&&latest.enabled&&!latest.dry_run&&latest.revision===c.revision&&
     e.last_owner_seq===env.last_owner_seq&&e.owner_signal===env.owner_signal&&!e.pending_owner&&(!latest.targets.includes('qq')||e.qq_available)&&
     !this.engine.calculate(latest,0,e.last_activity_at,this.now()).quiet;
   }});
   if(result?.committed){this.state.last_sent_at=this.now();this.state.awaiting_owner_seq=env.last_owner_seq;}
   delete this.state.inflight;this.log({at:this.now(),id,result:result?.committed?'committed':'cancelled',roll,threshold:plan.threshold});return result;
  }catch{delete this.state.inflight;this.log({at:this.now(),result:'failed'});return {result:'failed'};}
  finally{this.busy=false;}
 }
 async close(){this.closed=true;clearInterval(this.timer);while(this.busy)await new Promise(r=>setTimeout(r,20));}
}
module.exports={SpeakUp,DEFAULTS};
