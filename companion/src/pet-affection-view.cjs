'use strict';
const fs=require('node:fs');
const dayKey=(at=Date.now())=>{const d=new Date(at);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
const nextMidnight=(at=Date.now())=>{const d=new Date(at);d.setHours(24,0,0,0);return d.getTime();};
const clamp=(n,min,max)=>Math.max(min,Math.min(max,Number(n)||0));
const LABELS={head_touch:'触碰头部',head_pat:'摸头',head_rub:'揉头',hand_touch:'手部互动',face_touch:'摸脸',cover_blanket:'盖被子'};
function validState(s){const integer=(n,max)=>Number.isSafeInteger(n)&&n>=0&&n<=max;return !!s&&s.schema===1&&/^\d{4}-\d{2}-\d{2}$/.test(s.day)&&integer(s.daily_mood_bonus,20)&&integer(s.dependency_points,10000)&&integer(s.daily_dependency_points,200)&&integer(s.daily_count,1000)&&integer(s.total_count,Number.MAX_SAFE_INTEGER)&&Array.isArray(s.seen)&&s.seen.length<=1000&&Array.isArray(s.timeline)&&s.timeline.length<=60&&s.last_award&&typeof s.last_award==='object'&&!Array.isArray(s.last_award);}
function view(state={},at=Date.now()){
 const today=dayKey(at),same=state.day===today;
 return {day:today,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,next_reset_at:nextMidnight(at),
  daily_mood_bonus:same?clamp(state.daily_mood_bonus,0,20):0,dependency:Math.round(clamp(state.dependency_points,0,10000))/100,
  dependency_today:same?Math.round(clamp(state.daily_dependency_points,0,200))/100:0,
  daily_count:same?clamp(state.daily_count,0,1000):0,total_count:clamp(state.total_count,0,Number.MAX_SAFE_INTEGER),
  mood_cap:20,dependency_daily_cap:2,dependency_cap:100,last_interaction_at:state.last_interaction_at||0,last_action:LABELS[state.timeline?.at(-1)?.kind]||'',
  timeline:Array.isArray(state.timeline)?state.timeline.slice(-40).map(r=>({kind:r.kind,at:r.at,mood_delta:r.mood_delta,dependency_delta:r.dependency_delta})):[]};
}
function readPet(file,at=Date.now()){
 try{const s=fs.statSync(file);if(!s.isFile()||s.size>512*1024)return {...view({},at),error:'pet_state_invalid'};const v=JSON.parse(fs.readFileSync(file,'utf8'));return validState(v)?view(v,at):{...view({},at),error:'pet_state_invalid'};}catch(e){return {...view({},at),...(e.code==='ENOENT'||file===undefined?{}:{error:'pet_state_invalid'})};}
}
const effectiveMood=(base,pet)=>clamp(clamp(base,0,100)+(pet?.daily_mood_bonus||0),0,100);
function context(pet,base=70){
 const last=pet.last_action&&pet.last_interaction_at?`最近一次计入加成的动作：${pet.last_action}，时间${new Date(pet.last_interaction_at).toLocaleString('zh-CN')}（按具体时间理解，不把旧互动说成刚刚发生）。`:'';
 return `桌宠互动的本轮可信状态（覆盖历史中的旧日加成）：当地日期${pet.day}，普通对话基础心情${Math.round(base)}/100，今天原生互动带来的额外心情+${pet.daily_mood_bonus}，当前合计${effectiveMood(base,pet)}/100；依赖度${pet.dependency}/100，今天累积+${pet.dependency_today}。当天计入${pet.daily_count}次正向互动。${last}额外心情在当地0:00清零，长期依赖度保留。这只影响亲近与安心的表达，不替换莉莉丝既有人设；以主人当前情绪和话题为先，不在普通聊天中机械报数，不捏造未记录的互动。`;
}
module.exports={dayKey,nextMidnight,view,readPet,effectiveMood,context,validState};
