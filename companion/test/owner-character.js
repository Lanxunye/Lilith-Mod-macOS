'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lilith-owner-card-'));
process.env.LILITH_AI_DATA_DIR = root;
const {loadOwnerCharacter, ownerCharacterContext} = require('../src/owner-character');
const {buildSystemPrompt} = require('../src/server');
const file = path.join(root, 'owner-character.json');
const scope = {channel: 'desktop', playerName: '测试主人'};
const write = text => fs.writeFileSync(file, JSON.stringify({schema_version: 1, player_name: '测试主人', text}));
const prompt = channel => buildSystemPrompt({canon: {}, voice: {}}, '测试主人', 'in_character', [], [], 400, null, false, '', 'zh-CN', {channel});
try {
  assert.equal(loadOwnerCharacter(root, scope).reason, 'card_missing');
  write('PRIVATE_CARD_CANARY：喜欢甜食，是莉莉丝的伴侣。');
  assert.equal(loadOwnerCharacter(root, scope).loaded, true);
  assert.match(prompt('desktop'), /PRIVATE_CARD_CANARY/);
  assert.match(prompt('qq'), /PRIVATE_CARD_CANARY/);
  for (const channel of ['qq_group', 'aux', undefined]) {
    assert.doesNotMatch(prompt(channel), /PRIVATE_CARD_CANARY/);
    assert.equal(ownerCharacterContext(root, {...scope, channel}), '');
  }
  assert.equal(ownerCharacterContext(root, {...scope, playerName: '其他人'}), '');
  const before = loadOwnerCharacter(root, scope).sha256;
  write('UPDATED_CARD_CANARY：古老洋馆的大小姐。');
  assert.notEqual(loadOwnerCharacter(root, scope).sha256, before);
  assert.match(prompt('desktop'), /UPDATED_CARD_CANARY/);
  assert.doesNotMatch(prompt('desktop'), /PRIVATE_CARD_CANARY/);
  fs.writeFileSync(file, '{broken');
  assert.equal(ownerCharacterContext(root, scope), '');
  write('x'.repeat(6001));
  assert.equal(loadOwnerCharacter(root, scope).reason, 'card_invalid');
  fs.writeFileSync(file, 'x'.repeat(24001));
  assert.equal(loadOwnerCharacter(root, scope).reason, 'card_too_large');
  console.log('玩家角色卡：私聊提示接入、群聊与其他身份隔离、每轮重读及异常文件处理均通过。');
} finally {
  fs.rmSync(root, {recursive: true, force: true});
}
