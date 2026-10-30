'use strict';
const fs=require('node:fs'),path=require('node:path');
const {dayKey,nextMidnight,view,validState}=require('./pet-affection-view.cjs');
const ACTIONS=Object.freeze({
 head_touch:{label:'触碰头部',group:'head',mood:2,dependency:20,cooldown:30000},
 head_pat:{label:'摸头',group:'head',mood:2,dependency:20,cooldown:30000},
 head_rub:{label:'揉头',group:'head',mood:2,dependency:20,cooldown:30000},
 hand_touch:{label:'手部互动／牵手入口',group:'hand',mood:2,dependency:30,cooldown:30000},
 face_touch:{label:'触碰脸部',group:'face',mood:1,dependency:10,cooldown:30000},
 cover_blanket:{label:'盖被子',group:'care',mood:3,dependency:30,cooldown:60000}
});
const fault=code=>Object.assign(Error(code),{code});
function initial(now){return {schema:1,day:dayKey(now),daily_mood_bonus:0,dependency_points:0,daily_dependency_points:0,daily_count:0,total_count:0,last_award:{},seen:[],timeline:[]};}
class PetInteractions{
 constructor({root,now=Date.now,autoTick=true}){
  this.now=now;this.root=root;this.file=path.join(root,'pet-interactions/state.json');this.closed=false;this.autoTick=autoTick;
  fs.mkdirSync(path.dirname(this.file),{recursive:true,mode:0o700});
  if(fs.existsSync(this.file)){
   try{const stat=fs.lstatSync(this.file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>512*1024)throw fault('pet_state_invalid');
    this.state=JSON.parse(fs.readFileSync(this.file,'utf8'));if(!validState(this.state))throw fault('pet_state_invalid');
   }catch{this.state=initial(now());this.error='pet_state_invalid';}
  }else{this.state=initial(now());this.save();}
  this.refresh();this.schedule();
 }
 save(){const tmp=this.file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(this.state),{mode:0o600});fs.renameSync(tmp,this.file);fs.chmodSync(this.file,0o600);}
 refresh(){const at=this.now(),day=dayKey(at);if(this.error)return {...view({},at),error:this.error};if(day>this.state.day){
  const before={...this.state};Object.assign(this.state,{day,daily_mood_bonus:0,daily_dependency_points:0,daily_count:0,last_award:{},last_reset_at:new Date(new Date(at).setHours(0,0,0,0)).getTime()});
  try{this.save();}catch{this.state=before;this.error='pet_state_write_failed';return {...view({},at),error:this.error};}
 }return view(this.state,at);}
 schedule(){if(!this.autoTick||this.closed||this.error)return;this.timer=setTimeout(()=>{try{this.refresh();}catch{this.error='pet_state_write_failed';}finally{this.schedule();}},Math.max(1,Math.min(60000,nextMidnight(this.now())-this.now())));this.timer.unref?.();}
 status(){const s=this.refresh();let bridge={loaded:false};
  try{const b=JSON.parse(fs.readFileSync(path.join(this.root,'pet-interactions-game.json'),'utf8'));if(b.pid&&b.enabled){process.kill(b.pid,0);bridge={loaded:true,hooked:b.hooked||[],game_pid:b.pid};}}catch{}
  return {...s,bridge,actions:Object.entries(ACTIONS).map(([kind,a])=>({kind,label:a.label,mood:a.mood,dependency:a.dependency/100,cooldown_ms:a.cooldown,
   supported:bridge.loaded&&(kind==='cover_blanket'?(bridge.hooked.includes('CharacterInteractionHandler.OnCoverBlanketChoice')&&bridge.hooked.includes('LilithStateManager.SetActionType')):true)}))};
 }
 accept(body){
  if(this.error)throw fault('pet_state_unavailable');
  if(!body||!Array.isArray(body.events)||!body.events.length||body.events.length>32)throw fault('invalid_pet_events');
  for(const e of body.events)if(!e||typeof e.id!=='string'||!/^[a-f0-9-]{36}$/.test(e.id)||!Object.hasOwn(ACTIONS,e.kind)||!Number.isSafeInteger(e.at))throw fault('invalid_pet_event');
  this.refresh();if(this.error)throw fault('pet_state_unavailable');const before=JSON.stringify(this.state),at=this.now(),s=this.state,results=[];let changed=false;
  for(const e of body.events){
   let reason='';const action=ACTIONS[e.kind];
   if(s.seen.includes(e.id))reason='duplicate';
   else if(e.at>at+5000||at-e.at>300000)reason='stale';
   else if(dayKey(e.at)!==dayKey(at))reason='previous_day';
   else if(dayKey(at)<s.day)reason='clock_rollback';
   if(reason){results.push({id:e.id,credited:false,reason});continue;}
   s.seen=[...s.seen,e.id].slice(-1000);changed=true;
   if(s.last_award[action.group]&&at-s.last_award[action.group]<action.cooldown){results.push({id:e.id,credited:false,reason:'cooldown'});continue;}
   const mood=Math.min(action.mood,20-s.daily_mood_bonus),dependency=Math.min(action.dependency,200-s.daily_dependency_points,10000-s.dependency_points);
   if(mood<=0&&dependency<=0){results.push({id:e.id,credited:false,reason:'daily_cap'});continue;}
   s.daily_mood_bonus+=Math.max(0,mood);s.dependency_points+=Math.max(0,dependency);s.daily_dependency_points+=Math.max(0,dependency);
   s.last_award[action.group]=at;s.last_interaction_at=e.at;s.daily_count++;s.total_count++;
   s.timeline=[...s.timeline,{kind:e.kind,at:e.at,mood_delta:Math.max(0,mood),dependency_delta:Math.max(0,dependency)/100}].slice(-60);
   results.push({id:e.id,credited:true,mood_delta:Math.max(0,mood),dependency_delta:Math.max(0,dependency)/100});
  }
  if(changed){try{this.save();}catch{this.state=JSON.parse(before);this.error='pet_state_write_failed';throw fault('pet_state_unavailable');}}return {ok:true,results,state:this.status()};
 }
 close(){this.closed=true;clearTimeout(this.timer);}
}
module.exports={PetInteractions,ACTIONS};
