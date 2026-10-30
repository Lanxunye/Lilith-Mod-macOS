'use strict';
const STYLES=new Set(['neutral','soft','calm','bright','serious','sad','angry']);
const ENDINGS=new Set(['falling','rising','level']);
function validSpeech(value){return value&&STYLES.has(value.style)&&ENDINGS.has(value.ending)?{style:value.style,ending:value.ending}:null;}
function speechPlan(text,context={}){
 const specified=validSpeech(context.speech);if(specified)return specified;
 const s=String(text||'');
 // A happy face is not a direction to sound excited during comfort or bedtime.
 const style=/晚安|好梦|睡吧|睡一会|抱着|抱紧|别怕|别担心|安心|轻声|轻柔|慢慢来|陪着你|不吵你/.test(s)?'soft':
  /严肃|认真说|不许|不能这样|别再这样/.test(s)?'serious':context.emotion==='sad'?'sad':context.emotion==='angry'?'angry':context.emotion==='shy'?'soft':
  /好耶|太好了|好开心|真棒|出发[！!]/.test(s)?'bright':'neutral';
 return {style,ending:/[？?][”」』"']?\s*$/.test(s)?'rising':/[。！!…][”」』"']?\s*$/.test(s)?'falling':'level'};
}
function speechContext(store,row){
 let context=row.reply_part;
 if(!context){const part=store.db.prepare('SELECT body FROM reply_parts WHERE message_id=?').get(row.role==='assistant'?row.id:`${row.session}:${row.request_id}:assistant`);if(part)try{context=JSON.parse(part.body);}catch{}}
 if(!context){const turn=store.db.prepare('SELECT result FROM turns WHERE session=? AND request_id=?').get(row.session,row.request_id);if(turn?.result)try{context=JSON.parse(turn.result).ui;}catch{}}
 return context||{};
}
function speechForMessage(store,row){return speechPlan(row.content??row.text,speechContext(store,row));
}
const SPEECH_INSTRUCTION='语音表演元数据：在顶层及每条 messages 中附 speech:{"style":"neutral|soft|calm|bright|serious|sad|angry","ending":"falling|rising|level"}。根据本句话的语义和当前场景选择，不按整体心情机械套用：真正温柔、安慰、晚安、轻声亲近用 soft；平静但不带温柔的陈述用 calm，兴奋庆祝才用 bright，认真陈述用 serious/neutral；陈述、安抚、告别通常收落，真正询问才自然上扬，反问不强制升调。这里仅标记怎么读，不改身份、正文、已有情绪判断或记忆；正文不要写出标签或朗读指令。';
module.exports={validSpeech,speechPlan,speechContext,speechForMessage,SPEECH_INSTRUCTION};
