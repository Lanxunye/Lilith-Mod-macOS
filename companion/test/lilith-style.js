'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {conversationStyle,selectedSituations,moodJudgePrompt}=require('../src/lilith-style');
const profile=require('../../character/lilith-style.json');
const {buildSystemPrompt}=require('../src/server');
const root=path.resolve(__dirname,'../..');
assert.deepEqual(fs.readFileSync(path.join(root,'character/lilith-style.json')),
  fs.readFileSync(path.join(root,'dsh-feiyu-mood-lilith/lilith-style.json')),'packaged synthesis must be identical');
assert.deepEqual(fs.readFileSync(path.join(root,'companion/src/lilith-style.js')),
  fs.readFileSync(path.join(root,'dsh-feiyu-mood-lilith/style.cjs')),'packaged renderer must be identical');
assert.equal(selectedSituations(profile,'都怪我，把画搞砸了。')[0].id,'comfort');
assert.equal(selectedSituations(profile,'你刚刚是不是故意等我夸你？')[0].id,'tease');
assert.equal(selectedSituations(profile,'今天天气不错').length,0);
assert.ok(selectedSituations(profile,'喜欢你，想你，都是我的错，我讨厌你的名字，你不存在').length<=2);
const group=conversationStyle(profile,{channel:'qq_group',message:'她好可爱，想你了。'});
assert.ok(group.includes(profile.group_boundary));assert.ok(!group.includes(profile.private_relationship));
assert.ok(!group.includes('新写示意'));assert.ok(!group.includes('表达参考 jealous'));
const work=conversationStyle(profile,{baselineOnly:true});assert.ok(!work.includes(profile.private_relationship));
assert.ok(!work.includes('新写示意'));
const prompt=buildSystemPrompt({},'测试','in_character',[],[],100,null,false,'','en',
  {channel:'desktop',message:'我又把画搞砸了'});
assert.ok(prompt.includes('表达参考 comfort'));assert.ok(prompt.includes(profile.private_relationship));
assert.ok(prompt.split('\n').at(-1).includes('FINAL OUTPUT LANGUAGE REQUIREMENT'));
const judge=moodJudgePrompt(profile);
assert.ok(judge.includes('moodDelta'));assert.ok(judge.includes('自己实际说出的可见回复'));
assert.ok(judge.includes('傲娇要看嘴硬背后的感受'));
assert.ok(!judge.includes('sad(难过) 至少 +2'),'no punctuation-driven mandatory sadness');
console.log('lilith-style: topical selection, neutral replies, group relationship boundary, language priority, shared package and original mood rules passed');
