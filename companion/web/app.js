'use strict';
const token = new URLSearchParams(location.hash.slice(1)).get('token') || sessionStorage.getItem('lilith-local-token') || '';
if (token) { sessionStorage.setItem('lilith-local-token', token); history.replaceState(null, '', location.pathname); }
const $ = id => document.getElementById(id);
let config = {}, facts = [], playerName = '你', selectedTaskId = '', taskSignature = '';
function notice(text) { $('notice').textContent = text; }
async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`, ...(options.headers || {}) } });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error === 'unauthorized' ? '请从游戏的 Mod 设置入口重新打开此页面。' : value.error || '请求失败');
  return value;
}
function tab(name) {
  for (const section of document.querySelectorAll('main > section')) section.hidden = section.id !== name;
  for (const button of document.querySelectorAll('nav button')) button.classList.toggle('active', button.dataset.tab === name);
  document.title = name === 'chat' ? '莉莉丝 · 聊天' : '莉莉丝 · Mod 设置';
}
for (const button of document.querySelectorAll('nav button')) button.onclick = () => tab(button.dataset.tab);
const fields = [
  ['DSH 原生对话', [['network.proxy_url','HTTP / HTTPS 代理（留空沿用本机）','url']]],
  ['角色与对话', [
    ['ui.language_mode','语言','select',['follow_game','zh-CN','zh-TW','en','ja']],
    ['conversation.reply_max_chars','回复字数上限','number'],
    ['conversation.allow_parenthetical_actions','允许括号内动作描写','checkbox'],
    ['memory.max_messages','上下文消息数量','number'],['memory.max_chars_per_message','每条上下文字符上限','number'],
    ['memory.long_term_max_items','长期记忆条数上限','number']]],
  ['本机感知与搜索', [
    ['local_context.enabled','启用本机上下文','checkbox'],['local_context.time_enabled','感知本机时间','checkbox'],
    ['local_context.media_enabled','感知音乐播放状态','checkbox'],['media.enabled','音乐桥接（Apple Music / Spotify，需自动化权限）','checkbox'],
    ['music.preferred_player','首选播放器','select',['netease','applemusic','spotify','qqmusic','amazonmusic']],
    ['web_search.enabled','启用网络搜索','checkbox'],['web_search.backend','搜索方式','select',['off','deepseek_native','provider','brave','searxng']],
    ['web_search.daily_limit','桌面每日搜索请求上限（1至500；含Fetch与重试）','number'],['web_search.base_url','旧搜索服务地址（DSH无需填写）','url'],['web_search.api_key','搜索 API 密钥','password']]]
];
const extensions = [
  ['DeepSeek Harness（全域对话）', [
    ['integrations.dsh.task_timeout_ms','单轮最长运行时间（毫秒）','number'],
    ['integrations.dsh.max_tokens','每步最大输出 Tokens','number'],
    ['integrations.dsh.executable','本机 DSH 启动程序','text']]],
  ['ComfyUI · 本地 Qwen 绘图', [['integrations.comfy.enabled','启用绘图接口','checkbox'],
    ['integrations.comfy.base_url','ComfyUI 地址','url'],['integrations.comfy.model_label','模型显示名称','text'],
    ['integrations.comfy.autonomous_enabled','允许莉莉丝自主选择绘图 / 表情包','checkbox'],
    ['integrations.comfy.cooldown_seconds','普通自主插画间隔（秒）','number'],['integrations.comfy.daily_limit','每日生成上限','number'],
    ['integrations.comfy.api_key','服务密钥（可选）','password'],
    ['integrations.comfy.prompt_node_id','提示词节点 ID','text'],['integrations.comfy.prompt_input','提示词输入字段','text'],
    ['integrations.comfy.workflow','导出的 API 工作流 JSON','json']]]
];
function get(object, path) { return path.split('.').reduce((v, key) => v && v[key], object); }
function set(object, path, value) { const keys = path.split('.'); let target = object;
  for (const key of keys.slice(0,-1)) target = target[key] ||= {}; target[keys.at(-1)] = value; }
function renderFields(target, groups) {
  $(target).replaceChildren();
  for (const [name, items] of groups) {
    const fieldset = document.createElement('fieldset'), legend = document.createElement('legend');
    legend.textContent = name; fieldset.append(legend);
    for (const [path, label, type, choices] of items) {
      const row = document.createElement('label'); row.className = 'field';
      const title = document.createElement('span'); title.textContent = label;
      const input = document.createElement(type === 'select' ? 'select' : ['json','multiline'].includes(type) ? 'textarea' : 'input');
      input.dataset.path = path; input.dataset.kind = type; input.setAttribute('aria-label', label);
      if (type === 'select') for (const choice of choices) { const option = document.createElement('option'); option.value = choice; option.textContent = path==='mind_mode'?({off:'关闭状态层',observe:'观察：记录建议，不改变回复',active:'启用：应用状态与成员边界'}[choice]):choice; input.append(option); }
      else if (!['json','multiline'].includes(type)) input.type = type;
      const value = get(config, path);
      if (type === 'checkbox') input.checked = Boolean(value);
      else if (type === 'password') { input.autocomplete = 'off'; input.placeholder = get(config, path.replace(/(api_key|api_token|event_secret)$/, '$1_configured')) ? '已保存；留空保留原密钥' : '尚未配置'; }
      else if (type === 'json') { input.value = JSON.stringify(value || {}, null, 2); input.rows = 8; }
      else input.value = value ?? '';
      if (type === 'number') input.step = path.endsWith('temperature')||path==='random_wake_probability' ? '0.05' : '1';
      row.append(title,input); fieldset.append(row);
    }
    $(target).append(fieldset);
  }
}
function collect(form) { const patch = {};
  for (const input of form.querySelectorAll('[data-path]')) {
    const type = input.dataset.kind;
    if (type === 'password' && !input.value) continue;
    const value = type === 'checkbox' ? input.checked : type === 'number' ? Number(input.value)
      : type === 'json' ? JSON.parse(input.value) : input.value;
    set(patch,input.dataset.path,value);
  } return patch;
}
for (const id of ['settings-form','extension-form']) $(id).onsubmit = async event => {
  event.preventDefault();
  try { const result = await api('/v1/settings',{method:'PATCH',body:JSON.stringify(collect(event.target))});
    config = result.config; renderFields('setting-fields',fields); renderFields('extension-fields',extensions);
    notice('设置已保存，莉莉丝已重新读取配置。'); } catch(error) { notice(error.message); }
};
async function speechLoad(){
 const state=await api('/v1/speech');$('chat-speech-enabled').checked=state.enabled;
 $('chat-speech-state').textContent=!state.enabled?'已关闭':state.error?'语音暂时不可用，可关闭后重新开启':state.status==='playing'?'正在朗读':state.status==='preparing'?'正在准备声音……':'已开启';
}
$('chat-speech-enabled').onchange=async()=>{const button=$('chat-speech-enabled');button.disabled=true;
 try{await api('/v1/speech',{method:'PATCH',body:JSON.stringify({enabled:button.checked})});await speechLoad();}
 catch(error){notice(error.message);await speechLoad().catch(()=>{});}finally{button.disabled=false;}};
setInterval(()=>{if(!$('chat').hidden&&!$('chat-speech-enabled').disabled)speechLoad().catch(()=>{});},1500);
let chatSignature='';
function renderMessages(items) { $('messages').replaceChildren();
  for(const item of items) { const div = document.createElement('div'); div.className = 'message '+item.role;
    const label=document.createElement('strong');label.textContent=item.role==='assistant'?'莉莉丝':playerName;
    const text=document.createElement('span');text.textContent=item.content;div.append(label);
    if(item.sticker){const canvas=document.createElement('canvas');canvas.setAttribute('aria-label',`莉莉丝发来的表情包：${item.content||'表情'}`);
      canvas.className='chat-sticker';div.append(canvas);
      loadArtImage({...item.sticker,kind:'sticker'},canvas).then(()=>{$('messages').scrollTop=$('messages').scrollHeight;}).catch(()=>{text.textContent='表情包暂时无法显示，可在小画室查看。';div.append(text);});
    }else div.append(text);
    $('messages').append(div); }
  $('messages').scrollTop=$('messages').scrollHeight;
}
async function historyLoad() { const result=await api('/v1/session/desktop-pet/history');
  const signature=JSON.stringify(result.messages);if(signature===chatSignature)return;
  chatSignature=signature;renderMessages(result.messages); }
$('chat-form').onsubmit=async event=>{event.preventDefault();const message=$('message').value.trim();if(!message)return;
  $('send').disabled=true;notice('莉莉丝正在想怎么回应你……');
  try {await api('/v1/session/desktop-pet/message',{method:'POST',body:JSON.stringify({request_id:crypto.randomUUID(),
    player:{name:playerName},mode:'in_character',task_mode:$('task-mode').value,
    ...(selectedTaskId?{task_id:selectedTaskId}:{}),message})});$('message').value='';
    if($('task-mode').value==='dsh')$('task-mode').value='auto';selectedTaskId='';$('task-target').replaceChildren();
    await historyLoad();await taskLoad();notice('');}
  catch(error){notice(error.message);}finally{$('send').disabled=false;}};
$('reset-session').onclick=async()=>{if(!confirm('开始新对话？当前对话会清空，长期记忆保留。'))return;
  try{await api('/v1/control',{method:'POST',body:JSON.stringify({action:'reset_session',session_id:'desktop-pet'})});selectedTaskId='';$('task-target').replaceChildren();await historyLoad();await taskLoad();notice('已开始新对话。');}catch(error){notice(error.message);}};
function renderMemory(){ $('memory-facts').replaceChildren();for(const fact of facts){const row=document.createElement('div');row.className='fact';
  const key=document.createElement('input'),value=document.createElement('input'),remove=document.createElement('button');
  key.value=fact.key;value.value=fact.value;key.setAttribute('aria-label','记忆名称');value.setAttribute('aria-label','记忆内容');
  key.oninput=()=>fact.key=key.value;value.oninput=()=>fact.value=value.value;remove.textContent='移除';remove.onclick=()=>{facts=facts.filter(f=>f!==fact);renderMemory();};row.append(key,value,remove);$('memory-facts').append(row);}}
$('add-fact').onclick=()=>{facts.push({key:'',value:''});renderMemory();};
$('save-memory').onclick=async()=>{try{const result=await api('/v1/player-memory',{method:'PUT',body:JSON.stringify({facts})});facts=result.facts;renderMemory();notice('记忆已保存。');}catch(error){notice(error.message);}};
async function updateName(operation){try{notice('正在等待游戏检查称呼……');
  const result=await api('/v1/player-name',{method:'POST',body:JSON.stringify({operation,name:$('player-name').value})});
  if(!result.success)throw new Error(result.error||'游戏未接受该名称。');
  if(operation==='apply'){playerName=result.applied_name;$('player-name').value=playerName;
    facts=(await api('/v1/player-memory')).facts||[];renderMemory();await historyLoad();}
  notice(operation==='validate'?`游戏接受的名称：${result.applied_name}`:'称呼已保存，记忆已合并。');
}catch(error){notice(error.message);}}
$('validate-name').onclick=()=>updateName('validate');
$('name-form').onsubmit=event=>{event.preventDefault();updateName('apply');};
(async()=>{try{if(!token)throw new Error('请从游戏的 Mod 设置入口打开此页面。');
  const settings=await api('/v1/settings');config=settings.config;renderFields('setting-fields',fields);renderFields('extension-fields',extensions);
  $('task-mode').value=config.integrations?.dsh?.default_mode||'auto';
  const state=await api('/v1/game-state');playerName=state.PlayerName||state.player_name||'你';
  $('player-name').value=playerName;
  const memory=await api('/v1/player-memory');facts=memory.facts||[];renderMemory();await historyLoad();
  $('connection').textContent='DSH 原生对话';tab(location.pathname.endsWith('/qq')?'qq':location.pathname.endsWith('/art')?'art':location.pathname.endsWith('/chat')?'chat':'settings');
  if(location.pathname.endsWith('/art'))await artLoad(true);await taskLoad();
  await dshLoad();await speechLoad();
}catch(error){$('connection').textContent='未连接';notice(error.message);tab('settings');}})();

const taskLabels={queued:'等待执行',starting:'准备中',running:'执行中',stopping:'正在停止',completed:'已完成',needs_input:'需要补充',failed:'未完成',stopped:'已停止',interrupted:'已中断'};
const taskErrors={dsh_provider_required:'请配置有效的对话服务并关闭模拟回复。',dsh_not_installed:'没有找到本机 DSH 启动程序。',dsh_auth_failed:'DeepSeek 密钥验证失败，请更新密钥。',dsh_execution_failed:'DSH 执行失败，请检查模型或续办任务。',task_timeout:'任务超过设定时间，已停止。',companion_restarted:'上次运行已中断，可续办。'};
async function taskLoad(){
  const {tasks}=await api('/v1/tasks?session_id=desktop-pet');const signature=JSON.stringify(tasks);
  if(signature===taskSignature)return;taskSignature=signature;
  const expanded=new Set([...$('task-cards').querySelectorAll('details[open]')].map(d=>d.dataset.task));
  $('task-cards').replaceChildren();
  for(const task of tasks.slice(0,8)){
    const card=document.createElement('article');card.className='task-card';
    const title=document.createElement('h3');title.textContent=`${taskLabels[task.status]||task.status} · ${task.goal}`;
    const progress=document.createElement('p');progress.textContent=taskErrors[task.error]||task.progress;card.append(title,progress);
    if(['queued','starting','running','stopping'].includes(task.status)){
      const stop=document.createElement('button');stop.type='button';stop.textContent='停止任务';stop.disabled=task.status==='stopping';
      stop.onclick=async()=>{stop.disabled=true;try{await api(`/v1/tasks/${task.id}/stop`,{method:'POST',body:'{}'});await taskLoad();}catch(e){notice(e.message);stop.disabled=false;}};card.append(stop);
    }
    {
      const follow=document.createElement('button');follow.type='button';follow.textContent=['queued','running'].includes(task.status)?'补充任务要求':'接着这项任务说';
      follow.onclick=()=>{selectedTaskId=task.id;$('task-mode').value='dsh';$('task-target').textContent='正在续办：'+task.goal;
        const clear=document.createElement('button');clear.type='button';clear.textContent='取消关联';clear.onclick=()=>{selectedTaskId='';$('task-target').replaceChildren();};$('task-target').append(clear);$('message').focus();};card.append(follow);
    }
    if(task.result){const details=document.createElement('details');details.dataset.task=task.id;details.open=expanded.has(task.id);
      const summary=document.createElement('summary');summary.textContent='查看完整结果';const content=document.createElement('pre');content.textContent=task.result;details.append(summary,content);card.append(details);}
    for(const file of task.artifacts){const download=document.createElement('button');download.type='button';download.textContent='保存 '+file.name;
      download.onclick=async()=>{try{const response=await fetch(file.download_path,{headers:{Authorization:`Bearer ${token}`}});if(!response.ok)throw new Error('文件暂时无法读取');
        const url=URL.createObjectURL(await response.blob()),a=document.createElement('a');a.href=url;a.download=file.name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){notice(e.message);}};card.append(download);}
    $('task-cards').append(card);
  }
}
const artImages=new Map();let artSignature='';
const artStatuses={queued:'等待构思',planning:'正在构思画面',rendering:'正在本机绘制',reviewing:'正在核对成图',revising:'正在修正画面',completed:'已完成',failed:'未能完成'};
async function loadArtImage(job,canvas){
  let image=artImages.get(job.id);
  if(!image){const response=await fetch(job.image_path,{headers:{Authorization:`Bearer ${token}`}});if(!response.ok)throw new Error('图片暂不可用');
    const url=URL.createObjectURL(await response.blob());image=new Image();image.src=url;
    try{await image.decode();}finally{URL.revokeObjectURL(url);}artImages.set(job.id,image);}
  const sticker=job.kind==='sticker',size=Math.min(1024,image.naturalWidth);
  canvas.width=size;canvas.height=sticker?size+Math.round(size*.15):Math.round(image.naturalHeight*size/image.naturalWidth);
  const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.drawImage(image,0,0,size,sticker?size:canvas.height);
  if(sticker&&job.caption){ctx.fillStyle='#171720';ctx.textAlign='center';ctx.textBaseline='middle';
    const font=Math.max(16,Math.min(size*.075,size*.88/Math.max(1,[...job.caption].length)));
    ctx.font=`600 ${font}px "PingFang SC",sans-serif`;ctx.fillText(job.caption,size/2,size+(canvas.height-size)/2,size*.92);}
}
async function artLoad(force=false){try{
  const {jobs}=await api('/v1/art/jobs');const signature=JSON.stringify(jobs.map(j=>[j.id,j.status]));
  if(signature===artSignature&&!force)return;artSignature=signature;$('art-jobs').replaceChildren();
  $('art-state').textContent=config.integrations?.comfy?.enabled?'本机绘图已启用；先构思画面，再绘制和核对，通过后才展示成图。':'绘图未启用，请在扩展服务配置本机工作流。';
  for(const job of jobs.slice(0,20)){const card=document.createElement('article');card.className='art-card';
    const title=document.createElement('h3');title.textContent=`${job.kind==='sticker'?'表情包':'插画'} · ${artStatuses[job.status]||job.status}`;
    const scene=document.createElement('p');scene.textContent=job.scene;card.append(title,scene);
    if(job.status==='completed'){const canvas=document.createElement('canvas');canvas.setAttribute('aria-label',job.caption||job.scene);card.append(canvas);
      const save=document.createElement('button');save.disabled=true;save.textContent=job.kind==='sticker'?'保存带字表情包':'保存图片';
      loadArtImage(job,canvas).then(()=>{save.disabled=false;}).catch(e=>notice(e.message));
      save.onclick=()=>canvas.toBlob(blob=>{if(!blob)return;
        const a=document.createElement('a'),url=URL.createObjectURL(blob);a.href=url;a.download=`lilith-${job.kind}-${job.id}.png`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);},'image/png');card.append(save);
    }else{const status=document.createElement('p');status.textContent=job.error||'生成进度会自动更新，完成后也会出现在游戏内。';card.append(status);}
    const details=document.createElement('details'),summary=document.createElement('summary'),prompt=document.createElement('pre');summary.textContent='查看绘图依据与提示词';
    prompt.textContent=`${job.source==='autonomous'?'莉莉丝自主选择':'手动绘制'} · ${job.profile_version}\n${job.reason||''}\n${job.final_prompt||''}`;details.append(summary,prompt);card.append(details);$('art-jobs').append(card);}
}catch(e){$('art-state').textContent=e.message;}}
$('art-form').onsubmit=async event=>{event.preventDefault();const scene=$('art-scene').value.trim();if(!scene)return;
  let kind=$('art-kind').value;if(kind==='auto')kind=/表情|贴纸|梗图|meme|sticker/i.test(scene)||$('art-caption').value.trim()?'sticker':'illustration';
  $('art-submit').disabled=true;try{await api('/v1/art/jobs',{method:'POST',body:JSON.stringify({kind,scene,caption:$('art-caption').value,
    mood:'gentle',request_id:crypto.randomUUID()})});await artLoad(true);}catch(e){notice(e.message);}finally{$('art-submit').disabled=false;}};
$('art-refresh').onclick=()=>artLoad(true);
for(const button of document.querySelectorAll('nav button'))button.addEventListener('click',()=>{if(button.dataset.tab==='art')artLoad(true);});
setInterval(()=>{if(!$('art').hidden)artLoad();},3000);
setInterval(()=>{if(!$('chat').hidden&&!$('send').disabled)historyLoad().catch(()=>{});},3000);
setInterval(()=>{if(!$('chat').hidden)taskLoad().catch(()=>{});},2000);
api('/v1/art/profile').then(profile=>{$('art-rules').textContent=[profile.identity_prompt,profile.personality_prompt,profile.style_prompt].join('\n\n');}).catch(()=>{});
if(location.pathname.endsWith('/art'))artLoad(true);

const qqFields=[['QQ 账号与连接',[
  ['enabled','启用 QQ 接入','checkbox'],['paused','暂停回复（仅收集表情可继续接收）','checkbox'],['collection_only','仅收集主人私聊表情，关闭所有回复','checkbox'],
  ['owner_qq','主人的 QQ 号','text'],['bot_qq','莉莉丝的小号 QQ 号','text'],
  ['api_url','本机 OneBot HTTP API 地址','url'],['api_token','OneBot API Token','password'],
  ['event_secret','事件签名 Secret','password'],['mirror_desktop','同步绑定后的电脑端新对话','checkbox'],
  ['group_enabled','启用白名单群聊','checkbox'],['group_ids','允许的群号（JSON 字符串数组）','json'],
  ['group_art_enabled','群聊本地生图（仅明确 @ 请求；每群每天最多 10 张）','checkbox'],
  ['private_art_enabled','主人私聊绘图（明确 @ 请求；不设每日次数上限）','checkbox'],
  ['min_interval_ms','发送最小间隔（毫秒）','number'],['max_per_minute','每分钟发送上限','number']]],
 ['群聊参与与节奏',[
 ['mind_mode','统一交流状态（不会解除暂停或开启回复）','select',['off','observe','active']],
 ['participation_mode','接话模式','select',['selective','mention']],['quiet_ms','等待补充消息（毫秒）','number'],['topic_idle_seconds','话题失活时间（秒）','number'],
 ['random_wake_enabled','允许随机参与机会','checkbox'],['random_wake_probability','每分钟随机参与概率（0至0.2）','number'],['idle_topic_enabled','允许冷场时尝试开话题','checkbox'],['idle_topic_seconds','冷场时间（秒）','number'],['proactive_cooldown_seconds','主动参与冷却（秒）','number'],['quiet_start','主动发言静默开始（北京时间小时）','number'],['quiet_end','主动发言静默结束（北京时间小时）','number']]],
 ['联网查证',[
 ['search_enabled','QQ 联网总开关','checkbox'],['private_search_enabled','主人私聊联网','checkbox'],['group_search_enabled','白名单群联网','checkbox'],['search_daily_limit','每日请求上限（私聊及每群分别计算，含Fetch与重试）','number'],['search_backend','搜索服务（deepseek_native复用DSH官方Key）','select',['deepseek_native','bing_rss','brave','searxng']],['search_base_url','搜索接口地址（可选）','url'],['search_api_key','搜索 API Key（如需要）','password']]],
 ['阿里云看图与表情',[
 ['vision_enabled','启用图片识别（图片会发送到视觉服务）','checkbox'],['vision_base_url','视觉 API 基础地址（须与 Key 地域一致）','url'],['vision_model','视觉模型名称','text'],['vision_api_key','阿里云百炼 API Key','password'],['media_roots','允许读取的协议端图片缓存目录（JSON 数组，可留空）','json'],['stickers_enabled','启用表情库与缓存（仅收集模式不发送）','checkbox'],['group_stickers_enabled','允许在群聊中发送表情','checkbox'],['private_stickers_enabled','允许在主人私聊中自主附带已有表情（每3轮最多1次）','checkbox'],['owner_stickers_enabled','允许白名单群使用主人整理及导入的表情库','checkbox'],['sticker_max_exchange','连续斗图最多次数（1至3）','number']]],
 ['莉莉丝 QQ 语音（成功时不重复发送文字）',[
 ['voice_enabled','开启主人私聊语音','checkbox'],['group_voice_enabled','开启白名单群聊语音','checkbox'],['voice_mode','语音模式（gentle：仅逐句标记温柔；all：全部）','select',['gentle','all']]]]];
async function qqLoad(render=true){
  const value=await api('/v1/qq');
  if(render){const previous=config;config=value;renderFields('qq-fields',qqFields);config=previous;}
  $('qq-state').textContent=!value.enabled?'QQ 接入未启用':value.collection_only?'仅收集主人私聊表情；全部私聊、群聊及主动回复已关闭。表情库 '+value.owner_sticker_count+' 张':value.paused?'已暂停'+(value.last_error?'：'+value.last_error:''):'接入已启用，待处理 '+value.pending+' 条；请检查连接并完成实际收发测试。';
  $('qq-state').textContent+=' 群聊今日发送 '+value.group_daily_used+'/100 条（北京时间），由话题决定停止，无每轮条数上限。';
  $('qq-state').textContent='本机版本 '+(value.local_build||'未知')+' · '+$('qq-state').textContent;
  $('qq-state').textContent+=' 群聊生图'+(value.group_art_enabled?'开启':'关闭')+'，每群每天最多 10 张，仅明确 @ 触发。';
  $('qq-state').textContent+=' 联网：'+(value.search_enabled?'私聊'+(value.private_search_enabled?'开':'关')+'／群聊'+(value.group_search_enabled?'开':'关'):'关闭')+(value.web_search?'，私聊今日请求 '+value.web_search.daily_used+'/'+value.web_search.daily_limit+(value.web_search.last_error?'，错误 '+value.web_search.last_error:''):'')+'。';
  $('qq-state').textContent+=' 私聊绘图'+(value.private_art_enabled?'开启':'关闭')+'，@触发、不限次数；/lls pdraw on / off。';
  $('qq-groups').textContent=JSON.stringify({art:{enabled:value.group_art_enabled,scope:value.group_art_budget_scope,groups:value.group_art_groups,pending:value.group_art_pending},date:value.group_day,timezone:value.group_timezone,used:value.group_daily_used,limit:value.group_daily_limit,round_limit:value.group_round_limit,rounds:value.group_rounds},null,2);
  $('qq-deliveries').textContent=JSON.stringify(value.outbox,null,2);
  $('qq-capabilities').textContent=JSON.stringify({web_search:value.web_search,vision:value.vision_status,voice:value.voice_status,group_voice_enabled:value.group_voice_enabled,voice_mode:value.voice_mode,error:value.capability_error,owner_sticker_count:value.owner_sticker_count,meme_library_count:value.meme_library_count,meme_library_animated:value.meme_library_animated,private_art_enabled:value.private_art_enabled,private_art_pending:value.private_art_pending,group_art_enabled:value.group_art_enabled,group_art_groups:value.group_art_groups,group_stickers_enabled:value.group_stickers_enabled,private_stickers_enabled:value.private_stickers_enabled,private_sticker_cadence:value.private_sticker_cadence,collection_status:value.collection_status,collection_failed:value.collection_failed,stickers:value.stickers,mode:value.participation_mode},null,2);
  $('qq-memory').textContent=JSON.stringify(await api('/v1/memory/archive'),null,2);
  const mind=await api('/v1/qq/mind');
  $('qq-mind-state').textContent=JSON.stringify(mind,null,2);
  $('qq-mind-summary').textContent='当前模式：'+({off:'关闭',observe:'观察，仅记录建议',active:'应用状态与成员边界'}[mind.mode]||mind.mode)+'。心情和交流余量会恢复；成员状态按群隔离。约定只作有来源的记忆线索，不会安排任务。';
  if(render){$('qq-mind-scope').value=value.group_ids?.[0]?'group:'+value.group_ids[0]:'private:'+value.owner_qq;$('qq-mind-member').value=value.owner_qq||'';}
}
$('qq-mind-preview-form').onsubmit=async event=>{event.preventDefault();try{
  const result=await api('/v1/qq/mind/preview',{method:'POST',body:JSON.stringify({scope:$('qq-mind-scope').value.trim(),member:$('qq-mind-member').value.trim(),text:$('qq-mind-text').value,force:$('qq-mind-force').checked,proposal:{action:$('qq-mind-proposal').value}})});
  const actionNames={reply:'回复',wait:'等待补充',skip:'略过'},gateNames={qq_disabled:'QQ 接入未开启',replies_paused:'回复已暂停',collection_only:'仅收集表情',group_disabled:'群聊未开启',outside_owner_binding:'超出主人绑定',daily_limit:'今日额度已用尽'};
  $('qq-mind-preview-summary').textContent='状态建议：'+actionNames[result.recommended.action]+'；实际决定：'+actionNames[result.effective.action]+(result.gates.length?'（'+result.gates.map(g=>gateNames[g]||g).join('、')+'）':'')+'。未调用模型，未保存文字，未发送消息。';
  $('qq-mind-preview-result').textContent=JSON.stringify({preview_only:result.preview_only,persisted:result.persisted,sends:result.sends,mode:result.mode,proposed:result.proposed,recommended:result.recommended,effective:result.effective,gates:result.gates,snapshot:result.snapshot},null,2);
}catch(e){$('qq-mind-preview-summary').textContent='预演失败：'+e.message;$('qq-mind-preview-result').textContent='';}};
$('qq-mind-control').onclick=async()=>{try{
  await api('/v1/qq/mind/member',{method:'POST',body:JSON.stringify({scope:$('qq-mind-scope').value.trim(),member:$('qq-mind-member').value.trim(),action:$('qq-mind-member-action').value})});
  await qqLoad(false);notice('成员边界已更新；回复开关保持不变。');
}catch(e){notice(e.message);}};
$('qq-form').onsubmit=async event=>{event.preventDefault();try{await api('/v1/qq',{method:'PATCH',body:JSON.stringify(collect(event.target))});await qqLoad();notice('QQ 配置已保存。');}catch(e){notice(e.message);}};
$('qq-search-probe').onclick=async()=>{try{const r=await api('/v1/search/test',{method:'POST',body:JSON.stringify({channel:'qq',query:'DeepSeek Search Fetch API 官方文档'})});notice(r.results?.length?'DSH 官方搜索已验证，返回 '+r.results.length+' 条来源；未发送 QQ 消息。':'联网状态：'+r.state+(r.error?'（'+r.error+'）':''));await qqLoad(false);}catch(e){notice('联网测试失败：'+e.message);}};
$('qq-vision-probe').onclick=async()=>{try{const result=await api('/v1/qq/vision/probe',{method:'POST',body:'{}'});notice('视觉接口已通过一次实际图片请求：'+result.model);await qqLoad(false);}catch(e){notice('看图测试失败：'+e.message);}};
$('qq-probe').onclick=async()=>{try{const result=await api('/v1/qq/probe',{method:'POST',body:'{}'});notice('协议端已连接小号 '+result.bot_qq+'；还需实际私聊验证。');}catch(e){notice(e.message);}};
$('qq-pause').onclick=async()=>{try{await api('/v1/qq',{method:'PATCH',body:JSON.stringify({paused:true,collection_only:false})});await qqLoad();notice('QQ 已暂停。');}catch(e){notice(e.message);}};
for(const button of document.querySelectorAll('nav button'))button.addEventListener('click',()=>{if(button.dataset.tab==='qq')qqLoad().catch(e=>notice(e.message));});
setInterval(()=>{if(!$('qq').hidden)qqLoad(false).catch(()=>{});},3000);
if(location.pathname.endsWith('/qq'))qqLoad().catch(e=>notice(e.message));

async function dshLoad(){
 const state=await api('/v1/dsh');
 $('dsh-state').textContent=state.engine==='dsh'?`DSH：${state.status} · ${state.workspace} · MCP ${state.mcp_count??'待初始化'} 个；认证由 DSH 管理。Purge：${state.purge?.status||'待加载'}。`:'兼容测试引擎';
 const box=$('dsh-approvals'),signature=JSON.stringify(state.pending||[]);
 if(box.dataset.signature===signature)return;box.dataset.signature=signature;box.replaceChildren();
 for(const r of state.pending||[]){
  const card=document.createElement('article'),title=document.createElement('h3'),details=document.createElement('pre'),hint=document.createElement('p'),phrase=document.createElement('code'),entry=document.createElement('input'),approve=document.createElement('button'),deny=document.createElement('button');
  title.textContent='等待再次确认：'+r.tool_name+'（'+r.channel+'）';details.textContent=JSON.stringify(r.arguments,null,2);hint.textContent='核对准确目标后，手动输入以下完整短语。只授权这一次操作，两分钟内在原对话中让莉莉丝继续：';phrase.textContent=`确认执行 ${r.id} ${r.challenge}`;entry.placeholder='输入完整确认短语';entry.setAttribute('aria-label','本次操作明文确认');approve.textContent='确认这一次';deny.textContent='拒绝';
  approve.onclick=async()=>{try{const result=await api('/v1/dsh/approval',{method:'POST',body:JSON.stringify({id:r.id,confirmation:entry.value,action:'approve'})});notice(result.message);await dshLoad();}catch(e){notice(e.message);}};
  deny.onclick=async()=>{try{await api('/v1/dsh/approval',{method:'POST',body:JSON.stringify({id:r.id,action:'deny'})});await dshLoad();}catch(e){notice(e.message);}};
  card.append(title,details,hint,phrase,entry,approve,deny);box.append(card);
 }
}
$('dsh-start').onclick=async()=>{try{await api('/v1/dsh/start',{method:'POST',body:'{}'});await dshLoad();notice('DSH 已连接。');}catch(e){notice(e.message);}};
$('dsh-stop').onclick=async()=>{try{await api('/v1/dsh/stop',{method:'POST',body:'{}'});await dshLoad();notice('已停止本轮 DSH，未执行的确认已过期。');}catch(e){notice(e.message);}};
setInterval(()=>dshLoad().catch(()=>{}),4000);
const moodNames={happy:'开心',calm:'踏实',sweet:'甜蜜',heartache:'心疼',worry:'担心',sad:'难过',jealous:'吃醋'};
async function moodLoad(){
 const [s,interaction]=await Promise.all([api('/v1/dsh/mood'),api('/v1/pet/interactions')]);
 $('mood-state').textContent=s.loaded?`心情 ${s.mood}/100 · ${s.judging?'正在回想这轮对话':'已连接'} · 已判断 ${s.counts.judged} 轮${s.last_error?' · 最近一次判断未完成':''}`:'情绪插件尚未加载';
 $('mood-reason').textContent=(s.last_reason||'还没有新的心情变化。')+(s.pet?` · 基础 ${s.base_mood}，今日互动 +${s.pet.daily_mood_bonus}/${s.pet.mood_cap}（0:00重置） · 依赖度 ${s.pet.dependency}/100（今日 +${s.pet.dependency_today}，长期保留） · 今日计入 ${s.pet.daily_count} 次 · ${interaction.error?'互动状态需要检查':interaction.bridge.loaded?'游戏互动采集已连接':'等待游戏插件连接'}`:'' );
 $('mood-dims').textContent=Object.entries(s.dims).map(([k,v])=>`${moodNames[k]||k} ${v}`).join(' · ');
 if(!document.activeElement?.closest('#mood-form')){$('mood-enabled').checked=s.config.autoJudge===true;$('mood-mode').value=s.config.injectMode||'event';}
 const rows=(s.timeline||[]).slice().reverse();$('mood-timeline').replaceChildren();
 for(const row of rows){const p=document.createElement('p');p.textContent=`${new Date(row.at).toLocaleString('zh-CN')} · ${row.mood} · ${row.reason||''}`;$('mood-timeline').append(p);}
}
$('mood-form').onsubmit=async e=>{e.preventDefault();try{await api('/v1/dsh/mood',{method:'PATCH',body:JSON.stringify({autoJudge:$('mood-enabled').checked,injectMode:$('mood-mode').value})});notice('心情设置已保存，下一轮生效。');await moodLoad();}catch(error){notice(error.message);}};
$('mood-panel').ontoggle=()=>{if($('mood-panel').open)moodLoad().catch(e=>notice(e.message));};
setInterval(()=>{if($('mood-panel').open)moodLoad().catch(()=>{});},5000);
async function fishMemoryLoad(){
 const s=await api('/v1/dsh/memory');
 $('fish-memory-state').textContent=!s.installed?'记忆插件尚未安装':`${s.loaded?'已连接':'尚未连接'} · ${s.total||0} 条有效记忆 · ${s.config.enabled?'已启用':'已关闭'}${s.error||s.migration_error?' · 记忆处理异常，原数据保留':''}`;
 if(!document.activeElement?.closest('#fish-memory-form')){
  $('fish-memory-enabled').checked=s.config.enabled===true;$('fish-memory-half').value=s.config.policy.baseHalfLifeDays;$('fish-memory-quota').value=s.config.policy.dailyQuota;}
 $('fish-memory-list').replaceChildren();
 for(const m of s.memories||[]){const p=document.createElement('p');p.textContent=`${m.at?new Date(m.at).toLocaleDateString('zh-CN'):'时间未知'} · ${m.category==='stable_profile'?'稳定事实':'经历'} · ${m.text} · 鲜活度 ${Math.round(m.activation*100)}%`;$('fish-memory-list').append(p);}
 $('fish-memory-trace').textContent=JSON.stringify(s.last_recall||{},null,2);
}
$('fish-memory-form').onsubmit=async e=>{e.preventDefault();try{await api('/v1/dsh/memory',{method:'PATCH',body:JSON.stringify({enabled:$('fish-memory-enabled').checked,baseHalfLifeDays:Number($('fish-memory-half').value),dailyQuota:Number($('fish-memory-quota').value)})});notice('记忆设置已保存，下一轮生效。');await fishMemoryLoad();}catch(e){notice(e.message);}};
$('fish-memory-panel').ontoggle=()=>{if($('fish-memory-panel').open)fishMemoryLoad().catch(e=>notice(e.message));};
setInterval(()=>{if($('fish-memory-panel').open)fishMemoryLoad().catch(()=>{});},5000);
async function speakUpLoad(){
 const s=await api('/v1/dsh/speak-up');$('speak-up-state').textContent=!s.installed?'主动搭话插件尚未安装':`${s.loaded?'已连接':'尚未连接'} · ${s.config.enabled?(s.config.dry_run?'试运行':'正式运行'):'已关闭'} · 今日尝试 ${s.attempts_today}/${s.config.daily_limit}${s.awaiting_owner?' · 等待主人回应':''}`;
 if(!s.installed)return;
 if(!document.activeElement?.closest('#speak-up-form')){
  $('speak-up-enabled').checked=s.config.enabled;$('speak-up-dry').checked=s.config.dry_run;
  $('speak-up-desktop').checked=s.config.targets.includes('desktop');$('speak-up-qq').checked=s.config.targets.includes('qq');
  for(const [id,key]of Object.entries({interval:'interval_minutes',idle:'min_idle_minutes',limit:'daily_limit','quiet-start':'quiet_start','quiet-end':'quiet_end',peak:'peak_percent',offpeak:'offpeak_percent'}))$('speak-up-'+id).value=s.config[key];
 }
 $('speak-up-log').textContent=JSON.stringify(s.logs,null,2);
}
$('speak-up-form').onsubmit=async e=>{e.preventDefault();try{const body={enabled:$('speak-up-enabled').checked,dry_run:$('speak-up-dry').checked,targets:[$('speak-up-desktop').checked?'desktop':null,$('speak-up-qq').checked?'qq':null].filter(Boolean)};
 for(const [id,key]of Object.entries({interval:'interval_minutes',idle:'min_idle_minutes',limit:'daily_limit','quiet-start':'quiet_start','quiet-end':'quiet_end',peak:'peak_percent',offpeak:'offpeak_percent'}))body[key]=Number($('speak-up-'+id).value);
 await api('/v1/dsh/speak-up',{method:'PATCH',body:JSON.stringify(body)});notice('搭话设置已保存。');await speakUpLoad();}catch(e){notice(e.message);}};
$('speak-up-preview').onclick=async()=>{try{$('speak-up-preview-result').textContent=JSON.stringify(await api('/v1/dsh/speak-up/preview',{method:'POST',body:'{}'}),null,2);}catch(e){notice(e.message);}};
$('speak-up-panel').ontoggle=()=>{if($('speak-up-panel').open)speakUpLoad().catch(e=>notice(e.message));};
setInterval(()=>{if($('speak-up-panel').open)speakUpLoad().catch(()=>{});},5000);

const weatherStates={provider_consent_required:'尚未同意向 Open-Meteo 发送近似坐标',disabled:'已关闭',owner_binding_changed:'主人绑定已改变，请重新启用',not_requested:'尚未读取',permission_required:'需要系统定位授权',permission_denied:'系统定位权限被拒绝，请在系统设置中允许',services_disabled:'系统定位服务已关闭',timeout:'系统定位超时',no_fresh_fix:'未取得新鲜定位',unavailable:'未取得位置',refreshing:'正在查询',stale:'天气缓存已过期',weather_not_requested:'已取得近似位置，尚未取得天气',weather_service_unreachable:'暂时无法连接天气服务',weather_service_error:'天气服务返回失败',weather_invalid_or_stale_data:'天气数据无效或过期',weather_unavailable:'天气暂不可用'};
async function weatherLoad(){
 const s=await api('/v1/weather');if(!document.activeElement?.closest('#weather-form')){$('weather-enabled').checked=s.config.enabled;$('weather-consent').checked=s.config.provider_consent;}
 const w=s.current;
 $('weather-state').textContent=s.available?`${w.place} · ${w.condition||'天气数据'} · 室外 ${w.temperature_c}℃${w.feels_like_c!==undefined?' · 体感 '+w.feels_like_c+'℃':''} · 数据时间 ${new Date(w.observed_at).toLocaleString('zh-CN',{timeZone:w.timezone})}（${w.timezone}）${s.status==='cached_after_error'?' · 最近刷新失败，当前仍在缓存有效期内':''}`:weatherStates[s.status]||'天气暂不可用，请稍后刷新';
}
if($('weather-form')){
 $('weather-form').onsubmit=async e=>{e.preventDefault();try{await api('/v1/weather',{method:'PATCH',body:JSON.stringify({enabled:$('weather-enabled').checked,provider_consent:$('weather-consent').checked})});await weatherLoad();notice('天气开关已保存。');}catch(e){notice(e.message);}};
 $('weather-locate').onclick=async()=>{const b=$('weather-locate');b.disabled=true;try{if(!$('weather-consent').checked)throw new Error('请先勾选允许向 Open-Meteo 发送近似坐标。');notice('正在请求系统定位；出现授权窗口时请选择允许。');await api('/v1/weather',{method:'PATCH',body:'{"enabled":true,"provider_consent":true}'});await api('/v1/weather/location',{method:'POST',body:'{}'});await weatherLoad();notice('定位查询结束，结果见天气状态。');}catch(e){notice(e.message);}finally{b.disabled=false;}};
 $('weather-refresh').onclick=async()=>{const b=$('weather-refresh');b.disabled=true;try{await api('/v1/weather/refresh',{method:'POST',body:'{}'});await weatherLoad();}catch(e){notice(e.message);}finally{b.disabled=false;}};
 for(const b of document.querySelectorAll('nav button'))b.addEventListener('click',()=>{if(b.dataset.tab==='extensions')weatherLoad().catch(e=>notice(e.message));});
 setInterval(()=>{if(!$('extensions').hidden)weatherLoad().catch(()=>{});},15000);
}
