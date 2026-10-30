'use strict';
const fs=require('node:fs'),path=require('node:path');
const {readPet,effectiveMood}=require('./pet-affection-view.cjs');
const numbers={moodBase:[30,100],moodFloor:[0,100],decayHalfHours:[1,168],injectConfidence:[0,100],injectPerDay:[0,50],sigMood:[1,30],sigDim:[1,100]};
function json(file,fallback={}){try{const s=fs.statSync(file);if(!s.isFile()||s.size>4*1024*1024)return fallback;return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return fallback;}}
function readMood(home,pid){
 const dir=path.join(home,'feiyu-mood'),config=json(path.join(dir,'config.json')),runtime=json(path.join(dir,'lilith-status.json'));
 const state=json(path.join(dir,'state.json')).moods?.['lilith-owner']||{};
 const pet=readPet(path.resolve(home,'../../pet-interactions/state.json'));
 return {installed:!!runtime.version,loaded:runtime.loaded===true&&runtime.pid===pid,version:runtime.version||'',
  background_each_turn:runtime.background_each_turn===true,style_version:runtime.style_version||'',style_sha256:runtime.style_sha256||'',
  judging:runtime.judging===true&&runtime.pid===pid,counts:{observed:runtime.observed||0,judged:runtime.judged||0,injected:runtime.injected||0,failures:runtime.failures||0},
  last_error:runtime.last_error||'',mood:effectiveMood(state.mood??config.moodBase??70,pet),base_mood:state.mood??config.moodBase??70,pet,dims:state.dims||{},
  last_reason:state.lastReason||'',last_confidence:state.lastConfidence||0,last_injected_at:state.lastInjectedAt||0,
  updated_at:state.updatedAt||0,timeline:(state.timeline||[]).slice(-40),
  config:Object.fromEntries(['autoJudge','injectMode',...Object.keys(numbers)].filter(k=>config[k]!==undefined).map(k=>[k,config[k]]))};
}
function patchMood(home,body){
 const file=path.join(home,'feiyu-mood/config.json');
 if(!fs.existsSync(file))throw Object.assign(Error('lilith_mood_not_loaded'),{code:'lilith_mood_not_loaded'});
 const config=json(file,null);if(!config)throw Error('lilith_mood_config_invalid');
 const next={...config};
 for(const [key,value]of Object.entries(body)){
  if(key==='autoJudge'&&typeof value==='boolean')next[key]=value;
  else if(key==='injectMode'&&['off','label','event'].includes(value))next[key]=value;
  else if(numbers[key]&&Number.isInteger(value)&&value>=numbers[key][0]&&value<=numbers[key][1])next[key]=value;
  else throw Object.assign(Error('invalid_mood_setting'),{code:'invalid_mood_setting'});
 }
 const tmp=file+'.host.tmp';fs.writeFileSync(tmp,JSON.stringify(next,null,2)+'\n',{mode:0o600});fs.renameSync(tmp,file);fs.chmodSync(file,0o600);
}
module.exports={readMood,patchMood};
