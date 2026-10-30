'use strict';

const assert = require('assert');
const { normalizeResponse, parseModelEnvelope, stripParentheticalActions } = require('../src/server');

const firstExample = '（歪了歪头，露出促狭的笑容）三天而已嘛～莉莉丝会一直在你手机里陪着你。';
assert.strictEqual(
  stripParentheticalActions(firstExample),
  '三天而已嘛～莉莉丝会一直在你手机里陪着你。');
assert.strictEqual(
  stripParentheticalActions('111……（忍不住轻笑）这是个神秘暗号吗？'),
  '111……这是个神秘暗号吗？');
assert.strictEqual(
  stripParentheticalActions('《不/存在的你，和我》（2026 年版）'),
  '《不/存在的你，和我》（2026 年版）');

assert.strictEqual(
  normalizeResponse({ text: firstExample }, '', 100).text,
  '三天而已嘛～莉莉丝会一直在你手机里陪着你。');
assert.strictEqual(
  normalizeResponse({ text: firstExample }, '', 100, true).text,
  firstExample);
assert.strictEqual(
  normalizeResponse({ text: '（轻轻笑了笑）' }, '', 100).text,
  '……');

assert.deepStrictEqual(
  parseModelEnvelope('{"text":"你好","emotion":"happy","animation":"smile"}'),
  { text: '你好', emotion: 'happy', animation: 'smile' });
assert.deepStrictEqual(
  parseModelEnvelope('```json\n{"text":"你好","emotion":"happy","animation":"smile"}\n```'),
  { text: '你好', emotion: 'happy', animation: 'smile' });
assert.deepStrictEqual(parseModelEnvelope('普通纯文本回复。'), { text: '普通纯文本回复。' });

const leakedMetadata = parseModelEnvelope(
  '凌晨四点多还在听歌呢。\n\nemotion=curious\nanimation=listen');
assert.deepStrictEqual(leakedMetadata, {
  text: '凌晨四点多还在听歌呢。',
  emotion: 'curious',
  animation: 'listen'
});
assert.deepStrictEqual(
  normalizeResponse(leakedMetadata, '', 100),
  {
    text: '凌晨四点多还在听歌呢。',
    emotion: 'neutral',
    animation: 'listen',
    duration_ms: 6500,
    citations: [],
    memory_updates: []
  });
assert.deepStrictEqual(
  parseModelEnvelope('有效回复。\nanimation: think\nemotion: happy'),
  { text: '有效回复。', emotion: 'happy', animation: 'think' });
assert.deepStrictEqual(
  parseModelEnvelope('这里解释 emotion=happy，但它是正文。'),
  { text: '这里解释 emotion=happy，但它是正文。' });
assert.deepStrictEqual(
  parseModelEnvelope('emotion=happy 代表一种情绪。'),
  { text: 'emotion=happy 代表一种情绪。' });

console.log('Response normalization tests passed.');
const multi=normalizeResponse({text:'不得重复显示的摘要',messages:[{text:'回来啦。',emotion:'happy'},{text:'（轻轻笑了笑）还知道找我呀。',emotion:'shy'}]},'',100);
assert.deepEqual(multi.messages.map(p=>p.text),['回来啦。','还知道找我呀。']);assert.equal(multi.text,'回来啦。\n还知道找我呀。');
assert.equal(multi.messages[1].emotion,'shy');
assert.ok(Array.from(normalizeResponse({messages:[{text:'很长的一条'.repeat(30)},{text:'剩下的话'}]},'',60).text).length<=60,'total budget covers all bubbles');
assert.equal(normalizeResponse({text:'只有一句。',messages:[null,{}, {text:''}]},'',100).text,'只有一句。');
