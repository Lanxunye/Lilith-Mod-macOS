'use strict';
// Real SDK, synthetic data and no QQ transport or production conversation writes.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const {DshConversation}=require('../companion/src/dsh-conversation');
const {ConversationStore}=require('../companion/src/conversation-store');
const {createQQCapabilities,DEFAULTS}=require('../companion/src/qq-capabilities');
const character=require('../character/lilith.json');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'lilith-decision-native-')),store=new ConversationStore(root);
const proof={at:new Date().toISOString(),synthetic:true,qq_test_messages_sent:0,production_history_written:false};let dsh,fail=true;
(async()=>{try{
 dsh=new DshConversation({root,workspace:path.join(root,'workspace'),getConfig:()=>({integrations:{dsh:{executable:'/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh'}}}),getPersona:()=>JSON.stringify(character),getEndpoint:()=> 'http://127.0.0.1:1'});
 const cap=createQQCapabilities({root,store,getConfig:()=>({...DEFAULTS,owner_qq:'111111',private_stickers_enabled:true,stickers_enabled:true}),getCanon:()=>({identity:character.canon.identity,traits:character.voice.traits}),conversation:(messages,limits)=>fail?'':dsh.complete({key:'qq-decision',conversation:'synthetic',channel:'aux',tools:false,ephemeral:true,maxTokens:limits.maxTokens,system:messages[0].content,prompt:messages[1].content})});
 const stickers=Array.from({length:20},(_,i)=>({id:(i+1).toString(16).padStart(64,'0'),description:i%2?'角色微笑点头，表示开心、赞同、认可。':'角色疑惑歪头，表示不解、好奇、想问清楚。',usage:{sent:0,recently_sent:false}}));
 const base={scope:'group:444444',force:true,current:{speaker:{qq:'333333',name:'测试群友',is_bound_owner:false},text:'推荐一些悬疑游戏'},recent:[{speaker:{qq:'333333',name:'测试群友'},text:'刚聊到悬疑和解谜。'}],memory:[{key:'333333:偏好',value:'喜欢解谜'}],self_recent:[{state:'sent',text:'想要偏解谜，还是偏故事的？'}],topic:'悬疑游戏',stickers};
 await cap.decide(base);assert.equal(cap.status().capability_error,'qq_decision_failed');fail=false;
 const decisions=[];
 for(const input of [base,{...base,force:false,current:{...base.current,text:'我去拿个外卖，大家继续聊。'}},{...base,current:{...base.current,text:'刚才推荐的那个，真的有吗？',quote:{status:'available',speaker:{qq:'222222',name:'莉莉丝'},text:'可以看看经典的悬疑文字冒险。'}}}]){
  const value=await cap.decide(input);assert.ok(['reply','skip','wait'].includes(value.action));assert.equal(cap.status().capability_error,'');decisions.push(value.action);
 }
 const choice=await cap.decidePrivate({current:{text:'画稿保存好了，真开心。'},reply:'幸好留住了，安心庆祝一下吧。',recent:[],stickers:stickers.filter((_,i)=>i%2)});assert.ok(choice===null||stickers.some(s=>s.id===choice));assert.equal(cap.status().capability_error,'');
 proof.decisions=decisions;proof.recovered_without_restart=true;proof.usage=dsh.cost.status().by_module;
 const script=`from compression import zstd
import pathlib,json,sys
result=[]
for f in pathlib.Path(sys.argv[1]).glob('auxiliary-*/sessions/*/*/session.v4.jsonl.zstd'):
 rows=[json.loads(l) for l in zstd.decompress(f.read_bytes()).decode().splitlines()]
 h=next((r['data']['header'] for r in rows if r['type']=='request/header'),{})
 for r in rows:
  if r['type']!='assistant/message':continue
  blocks=r['data'].get('message',{}).get('content',[]);text='\\n'.join(b.get('text','') for b in blocks if b.get('type')=='text')
  try:valid=isinstance(json.loads(text.replace('\x60\x60\x60json','').replace('\x60\x60\x60','')),dict)
  except:valid=False
  result.append({'tools':len(h.get('tools',[])),'reasoning':h.get('config',{}).get('reasoningEffort'),'reasoning_blocks':sum(b.get('type')=='reasoning' for b in blocks),'json_valid':valid,'usage':r['data'].get('usage',{})})
print(json.dumps(result))`;
 proof.requests=JSON.parse(execFileSync('python3',['-c',script,path.join(root,'dsh-lilith')],{encoding:'utf8'}));
 assert.equal(proof.requests.length,4);assert.ok(proof.requests.every(r=>r.tools===0&&r.reasoning==='off'&&r.reasoning_blocks===0&&r.json_valid&&r.usage.outputTokens<512));proof.passed=true;console.log(JSON.stringify(proof));
}finally{await dsh?.close();store.close();fs.writeFileSync(path.resolve(__dirname,'../evidence/decision-recovery-native.json'),JSON.stringify(proof,null,2));}})().catch(e=>{console.error(e.code||e.message);process.exitCode=1;});
