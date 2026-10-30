'use strict';
// Owner-private commands and voice-only delivery preparation; history retains text.
const {speechForMessage,speechContext,validSpeech}=require('./speech-prosody');
const {parseCommand,commandHelp}=require('./qq-commands');
function createQQSpeech({store,getConfig,configure,speechStatus,speechHealth,groupArtStatus=()=>({}),capabilities,api,probe,watermark,groupWatermark=()=>0,groupAllowed=()=>false,now,canSend,charge}){
 store.db.exec(`CREATE TABLE IF NOT EXISTS qq_speech_jobs(id TEXT PRIMARY KEY,kind TEXT,bot TEXT,owner TEXT,body TEXT,state TEXT,platform_id TEXT,error TEXT,created_ms INTEGER)`);
 store.db.prepare("UPDATE qq_speech_jobs SET state='unknown',error='service_restarted' WHERE state='sending'").run();
 store.db.prepare("UPDATE qq_speech_jobs SET state='cancelled',error='service_restarted' WHERE kind='voice' AND state IN ('pending','preparing')").run();
 const revision={private:0,group:0};let lastError='',closed=false;
 function cancelPending(scope='all'){
  for(const channel of scope==='all'?['private','group']:[scope]){
   revision[channel]++;
   store.db.prepare("UPDATE qq_speech_jobs SET state='cancelled',error='voice_disabled_or_changed' WHERE kind='voice' AND state IN ('pending','preparing') AND COALESCE(json_extract(body,'$.scope'),'private')=?").run(channel);
  }
 }
 function stateText(health){const c=getConfig(),desktop=speechStatus(),art=groupArtStatus();return `莉莉丝状态\n联网：${c.search_enabled?'总开':'总关'}／私聊${c.private_search_enabled?'开':'关'}／群聊${c.group_search_enabled?'开':'关'}（私聊及每群各 ${c.search_daily_limit||50} 次请求/天，含Fetch与重试）\nQQ回复：${c.paused?'已暂停':'已开启'}\n群聊回复：${c.group_enabled?'开启':'关闭'}\n私聊绘图：${c.private_art_enabled?'开启':'关闭'}（明确 @ 触发，不限次数；/lls pdraw on / off）\n群聊生图：${c.group_art_enabled?'开启':'关闭'}（每群每日最多 10 张，今日合计 ${art.group_art_daily_used||0} 张，北京时间）\n${(art.group_art_groups||[]).slice(0,8).map(g=>'群 '+g.group_id+'：'+g.used+'/10 张').join('；')}\n群聊表情：${c.stickers_enabled&&c.group_stickers_enabled!==false?'开启':'关闭'}\nQQ语音：${c.voice_enabled?'开启':'关闭'}（私聊）\n群聊语音：${c.group_voice_enabled?'开启':'关闭'}\n语音模式：${c.voice_mode==='all'?'全部语音':'仅温柔句子'}\n桌面朗读：${desktop.enabled?'开启':'关闭'}\n音色：莉莉丝第三轮 · 160 步\n合成服务：${!health?'待检测':health.online?(health.loaded?'在线，音色已载入':'在线，首次使用时载入音色'):'未连接，首次合成时尝试启动'}\n语音任务：${lastError?'暂不可用，文字回复保留':'待命'}\n\n/lls 查看全部可执行命令。`;}
 function accept(id,text){
  const parsed=parseCommand(text);if(!parsed)return false;
  const c=getConfig(),key='command:'+id;
  if(store.db.prepare('SELECT 1 FROM qq_speech_jobs WHERE id=?').get(key))return true;
  const {action,option}=parsed;
  let reply=(parsed.reason?parsed.reason+'\n\n':'')+commandHelp();
  // Record consumption before changing the flag; duplicates must never toggle twice.
  store.db.exec('BEGIN IMMEDIATE');
  try{
   store.db.prepare("INSERT INTO qq_speech_jobs VALUES (?,'command',?,?,?,'pending',NULL,NULL,?)").run(key,c.bot_qq,c.owner_qq,JSON.stringify({text:reply}),now().getTime());
   if(action==='tts'&&['all','gentle'].includes(option)){
    const mode=option==='gentle'?'gentle':c.voice_mode==='all'?'gentle':'all';configure({voice_mode:mode});
    reply='语音模式已切换为'+(mode==='all'?'全部语音':'仅温柔句子')+'。群聊与私聊共用此模式，各自的语音开关保持原状。';
   }else if(['tts','group tts','gtts'].includes(action)&&(!option||['on','off'].includes(option))){
    const group=action!=='tts',field=group?'group_voice_enabled':'voice_enabled';
    const enabled=option?option==='on':!c[field];configure({[field]:enabled});
    reply=(group?'群聊语音':'QQ语音')+'已'+(enabled?'开启':'关闭')+'。'+(enabled?'按当前模式选择语音，成功时不重复发文字，失败时回退文字。':'此通道后续使用文字回复。')+'另一通道和桌面朗读开关保持不变。';
   }else if(['group','draw'].includes(action)){
    const group=action==='group',field=group?'group_enabled':'group_art_enabled';
    const enabled=option?option==='on':!c[field];configure({[field]:enabled});
    reply=(group?'群聊回复':'群聊生图')+'已'+(enabled?'开启':'关闭')+'。'+(group?(enabled?'仍只参与白名单群。':'排队中的群聊回复和绘图结果不再发送，主人私聊保留。'):(enabled?'必须实际 @ 莉莉丝并明确请求绘图，每个白名单群每天各最多 10 张。群聊总开关也需开启。':'排队中的绘图结果不再发送；普通群聊开关保持不变。'));
   }else if(action==='pdraw'&&(!option||['on','off'].includes(option))){const enabled=option?option==='on':!c.private_art_enabled;configure({private_art_enabled:enabled});reply='私聊绘图已'+(enabled?'开启。请明确 @ 莉莉丝并描述画面，不设每日次数上限。':'关闭。尚未发送的私聊绘图结果不再发送。')+'群聊绘图开关保持不变。';
   }else if(['search','psearch','gsearch'].includes(action)){
    const field={search:'search_enabled',psearch:'private_search_enabled',gsearch:'group_search_enabled'}[action];
    configure({[field]:option==='on'});reply=({search:'QQ 联网总开关',psearch:'主人私聊联网',gsearch:'白名单群联网'}[action])+'已'+(option==='on'?'开启':'关闭')+'。通过 DSH 原生官方 Key 查询公开信息；私聊与每个群分别受每日请求上限约束。回复开关保持原状。';
   }else if(action==='state')reply=stateText();
   store.db.prepare('UPDATE qq_speech_jobs SET body=? WHERE id=?').run(JSON.stringify({text:reply,query_state:action==='state'}),key);
   store.db.exec('COMMIT');
  }catch(e){store.db.exec('ROLLBACK');throw e;}
  return true;
 }
 async function prepareVoice(out,meta,privateReply,group){
  const c=getConfig(),scope=group?'group':'private',enabled=group?c.group_voice_enabled:c.voice_enabled;
  if(!enabled||(group?!groupAllowed(group):!privateReply))return null;
  if(meta.sticker_only||meta.group_art_request||meta.private_art_request||!out.text||out.text.length>500||(meta.sources||[]).length)return null;
  const context=speechContext(store,out),speech=speechForMessage(store,out);
  // In gentle mode require the semantic tag; keywords and a globally happy mood
  // must not silently authorize audio for an unclassified or ordinary sentence.
  if(c.voice_mode!=='all'&&validSpeech(context?.speech)?.style!=='soft')return null;
  const id='voice:'+out.id,version=revision[scope],mark=group?groupWatermark(group):watermark(),bot=c.bot_qq,owner=c.owner_qq,started=now().getTime();
  const previous=store.db.prepare('SELECT state FROM qq_speech_jobs WHERE id=?').get(id);
  if(previous)return ['sent','unknown','sending'].includes(previous.state)?{cancelled:true}:null;
  const valid=()=>{const n=getConfig();return !closed&&n.enabled&&!n.paused&&!n.collection_only&&n.bot_qq===bot&&n.owner_qq===owner&&(group?groupAllowed(group)&&(meta.force||groupWatermark(group)===mark):watermark()===mark)&&now().getTime()-started<120000&&(!meta.burst_id||store.db.prepare('SELECT state FROM reply_batches WHERE id=?').get(meta.burst_id)?.state!=='cancelled');};
  store.db.prepare("INSERT INTO qq_speech_jobs VALUES (?,'voice',?,?,?,'preparing',NULL,NULL,?)").run(id,bot,owner,JSON.stringify({parent:out.id,scope}),started);
  try{
   const supported=await api('can_send_record',{});if(supported?.yes!==true)throw Object.assign(Error('qq_record_not_supported'),{code:'qq_record_not_supported'});
   const audio=await capabilities.voice(out.text,{speech,channel:group?'qq_group':'qq'});
   if(!Buffer.isBuffer(audio.bytes)||audio.bytes.length>10*1024*1024||audio.bytes.length<44||audio.bytes.toString('ascii',0,4)!=='RIFF')throw Object.assign(Error('invalid_voice_audio'),{code:'invalid_voice_audio'});
   if(!valid()){cancelVoice(id,'superseded_or_disabled');return {cancelled:true};}
   if(!(group?getConfig().group_voice_enabled:getConfig().voice_enabled)||version!==revision[scope]){cancelVoice(id,'voice_disabled_or_changed');return null;}
   return {id,segment:{type:'record',data:{file:'base64://'+audio.bytes.toString('base64')}}};
  }catch(e){
   if(!valid()){cancelVoice(id,'superseded_or_disabled');return {cancelled:true};}
   lastError=e.code||'qq_voice_unavailable';store.db.prepare("UPDATE qq_speech_jobs SET state='failed',error=? WHERE id=?").run(lastError,id);return null;
  }
 }
 function cancelVoice(id,reason){store.db.prepare("UPDATE qq_speech_jobs SET state='cancelled',error=? WHERE id=? AND state NOT IN ('sent','unknown')").run(reason,id);}
 function voiceSending(id){store.db.prepare("UPDATE qq_speech_jobs SET state='sending' WHERE id=?").run(id);}
 function voiceSent(id,receipt){store.db.prepare("UPDATE qq_speech_jobs SET state='sent',platform_id=?,error=NULL WHERE id=?").run(String(receipt),id);lastError='';}
 function voiceUnknown(id,error){lastError=error;store.db.prepare("UPDATE qq_speech_jobs SET state='unknown',error=? WHERE id=?").run(error,id);}
 async function tick(){
  if(closed||!canSend())return false;
  const job=store.db.prepare("SELECT * FROM qq_speech_jobs WHERE kind='command' AND state='pending' ORDER BY created_ms,rowid LIMIT 1").get();
  if(!job)return false;
  const c=getConfig(),body=JSON.parse(job.body);
  const valid=()=>{const n=getConfig();return !closed&&n.enabled&&n.bot_qq===job.bot&&n.owner_qq===job.owner;};
  if(!valid()){store.db.prepare("UPDATE qq_speech_jobs SET state='cancelled',error='superseded_or_disabled' WHERE id=?").run(job.id);return true;}
  let sending=false;
  try{
   await probe();let message;
   message=[{type:'text',data:{text:body.query_state?stateText(await speechHealth?.()):body.text}}];
   if(!valid()){store.db.prepare("UPDATE qq_speech_jobs SET state='cancelled',error='superseded_or_disabled' WHERE id=?").run(job.id);return true;}
   store.db.prepare("UPDATE qq_speech_jobs SET state='sending' WHERE id=?").run(job.id);sending=true;charge();
   const receipt=await api('send_private_msg',{user_id:job.owner,message});
   if(receipt?.message_id===undefined)throw Object.assign(Error('onebot_missing_receipt'),{code:'onebot_missing_receipt'});
   store.db.prepare("UPDATE qq_speech_jobs SET state='sent',platform_id=?,error=NULL WHERE id=?").run(String(receipt.message_id),job.id);lastError='';
  }catch(e){lastError=e.code||'qq_voice_unavailable';store.db.prepare('UPDATE qq_speech_jobs SET state=?,error=? WHERE id=?').run(sending?'unknown':'failed',lastError,job.id);}
  return true;
 }
 return {accept,prepareVoice,voiceSending,voiceSent,voiceUnknown,cancelVoice,tick,cancelPending,close(){closed=true;cancelPending();},status(){return {qq_command_help:commandHelp(),qq_voice_delivery:'owner_private_voice_only',qq_group_voice_delivery:'whitelisted_groups_voice_only',qq_voice_last_error:lastError,
  qq_voice_pending:store.db.prepare("SELECT COUNT(*) AS n FROM qq_speech_jobs WHERE kind='voice' AND state IN ('pending','preparing')").get().n};}};
}
module.exports={createQQSpeech};
