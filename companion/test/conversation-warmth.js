'use strict';
const assert=require('node:assert/strict');
const {replyMaxChars,normalizeResponse,buildSystemPrompt}=require('../src/server');
const {dialogueContext}=require('../src/qq-mind');
const cfg={conversation:{reply_max_chars:400}};
assert.equal(replyMaxChars(cfg),400);assert.equal(replyMaxChars(cfg,'qq'),400);assert.equal(replyMaxChars(cfg,'qq_group'),240);
assert.equal(replyMaxChars({conversation:{reply_max_chars:80}},'qq_group'),80,'explicit lower user budget is honored');
assert.equal(replyMaxChars({conversation:{}}),400);assert.equal(replyMaxChars({conversation:{reply_max_chars:900}}),500);
const parts=[{text:'今天你愿意过来陪我，我当然很高兴。'.repeat(4),emotion:'happy'},{text:'也想听你说说今天的事，开心的或是有点烦的都可以。'.repeat(3),emotion:'shy'}];
const full=parts.map(p=>p.text).join('\n');assert.ok(Array.from(full).length>100);assert.ok(Array.from(full).length<400);
const result=normalizeResponse({text:full,messages:parts},'',400);assert.equal(result.text,full);assert.equal(result.messages.length,2);assert.equal(result.parts_source,'model');
for(const tier of ['new','familiar','close','reserved','untracked']){
 const mind={state:{scope:'private:111111',mood:{kind:'calm'},relation:{tier,avoid_until:987,opted_out:true},energy:.4},style:{tone:'reserved'}};
 const original=JSON.stringify(mind),context=dialogueContext(mind,'qq');
 assert.match(context,/established_companion/);assert.match(context,/"tone":"companion"/);assert.match(context,new RegExp('"familiarity_tier":"'+tier+'"'));assert.doesNotMatch(context,/"tier":/);assert.match(context,/"avoid_until":987/);assert.match(context,/"opted_out":true/);assert.equal(JSON.stringify(mind),original,'generation projection never rewrites social state');
}
const group=dialogueContext({state:{scope:'group:222222',relation:{tier:'familiar'},is_bound_owner:false}},'qq_group');
assert.doesNotMatch(group,/established_companion|"tone":"companion"/);assert.match(group,/不能将某成员认作恋人/);
assert.equal(dialogueContext(null,'qq'),'');assert.equal(dialogueContext({},'desktop'),'');
const prompt=buildSystemPrompt({},'主人','in_character',[],[],400,null,false,'','zh-CN',{channel:'qq',message:'我回来了'});
assert.match(prompt,/at most 400 Unicode characters/);assert.match(prompt,/ceiling, not a target/);assert.match(prompt,/messages is the authoritative/);
assert.doesNotMatch(prompt,/意思说到就可以停|无需每句话都表演傲娇|不必每次追加关系宣言/);
const groupStyle=require('../../character/qq-group-style.json');assert.doesNotMatch(groupStyle.rules.join('\n'),/10至45字|一两句/);
console.log('conversation-warmth: channel budgets, >100-char multipart content, companion vs familiarity, preserved boundaries/state and scoped rules passed');
