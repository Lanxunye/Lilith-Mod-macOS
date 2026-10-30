'use strict';
const HISTORY_LIMIT=5,MEMORY_LIMIT=4;
const clip=(v,n)=>String(v??'').slice(0,n);
function parseGroup(content){const text=String(content||''),m=text.match(/^\[群成员 QQ (\d+)\]\n/);if(!m)return null;try{const value=JSON.parse(text.slice(m[0].length));return {...value,speaker:{qq:m[1],name:clip(value.speaker?.name,32),is_bound_owner:value.speaker?.is_bound_owner===true}};}catch{return null;}}
function compactContent(content){const data=parseGroup(content);if(!data)return clip(content,480);
 const value={speaker:{qq:clip(data.speaker?.qq,20),name:clip(data.speaker?.name,32),is_bound_owner:data.speaker?.is_bound_owner===true},text:clip(data.text,400)};
 if(data.quote){value.quote={status:data.quote.status||'unavailable'};if(data.quote.status==='available')Object.assign(value.quote,{speaker:{qq:clip(data.quote.speaker?.qq,20),name:clip(data.quote.speaker?.name,32)},text:clip(data.quote.text,160),has_unsupported_media:data.quote.has_unsupported_media===true});}
 if(data.images?.items?.length)value.images=data.images.items.slice(0,2).map(x=>({description:clip(x.description,100),is_sticker:x.is_sticker===true}));
 return '[群成员 QQ '+value.speaker.qq+']\n'+JSON.stringify(value);
}
// Merge observed human messages and committed replies into one five-message
// context. No extra copy of recent group/self messages is appended elsewhere.
function groupHistory(journal,recent=[],requestId=''){
 const entries=[];let order=0;
 for(const row of (journal||[]).slice(-5)){const data=parseGroup(row.content),id=row.role==='user'?String(row.request_id||'').match(/:(-?\d+)$/)?.[1]:null;
  entries.push({role:row.role==='assistant'?'assistant':'user',content:compactContent(row.content),at:Date.parse(row.created_at)||0,key:id?'message:'+id:'journal:'+row.seq,signature:data?data.speaker?.qq+':'+data.text:null,order:order++});}
 for(const row of (recent||[]).slice(-5)){const id=String(row.message_id??'');if(id&&String(requestId).endsWith(':'+id))continue;
  if(entries.some(e=>e.key==='message:'+id||!e.key.startsWith('message:')&&e.signature===row.speaker?.qq+':'+row.text))continue;
  const data={speaker:row.speaker,text:row.text};entries.push({role:'user',content:compactContent('[群成员 QQ '+row.speaker?.qq+']\n'+JSON.stringify(data)),at:Number(row.created_ms)||0,key:'message:'+id,order:order++});}
 return entries.sort((a,b)=>a.at-b.at||a.order-b.order).slice(-HISTORY_LIMIT).map(({role,content})=>({role,content}));
}
function groupFacts(facts,members=[]){const ids=new Set(members.map(String).filter(x=>/^[1-9]\d{4,19}$/.test(x))),counts=new Map(),chosen=[];
 if(!ids.size)return [];
 for(const row of [...(facts||[])].reverse()){const id=String(row.key||'').split(':')[0];if(!ids.has(id)||(counts.get(id)||0)>=2)continue;chosen.unshift({key:clip(row.key,64),value:clip(row.value,80)});counts.set(id,(counts.get(id)||0)+1);if(chosen.length>=MEMORY_LIMIT)break;}
 return chosen;
}
module.exports={HISTORY_LIMIT,MEMORY_LIMIT,parseGroup,compactContent,groupHistory,groupFacts};
