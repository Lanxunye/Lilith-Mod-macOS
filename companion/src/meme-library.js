'use strict';
const interpretations=require('./meme-interpretations.json');
const interpretation=id=>Object.hasOwn(interpretations,id)?interpretations[id]:undefined;
function correctedDescription(id,fallback){return interpretation(id)?.description||fallback;}
function interpretationAllowed(id,hint){const entry=interpretation(id);return !entry||entry.triggers.some(word=>String(hint).includes(word));}
const SCOPE='library:public',MAX_ASSET_BYTES=12*1024*1024;
function ensureSchema(db){db.exec('CREATE TABLE IF NOT EXISTS qq_meme_assets (id TEXT PRIMARY KEY,metadata TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 1)');}
function eligible(meta,hint){
 const keys=(meta.categories||[]).map(c=>c.key),general=keys.some(k=>!k.startsWith('_')||k==='_laugh');if(general)return true;
 const topics={_red:/股票|基金|股市|涨|投资|赚钱/,_green:/股票|基金|股市|跌|投资|亏/,_stock:/股票|基金|股市|投资/,_genshin:/原神|米哈游|genshin/i,_kg:/鸣潮|库洛|库狗/,_lkll:/鸣潮|库洛|老库/,_lksl:/鸣潮|库洛|老库/,_zcj:/至此间|知觉|流年/,_yg:/椰果/,_tease:/玩笑|吐槽|调侃|怼|骂|反驳/};
 return keys.some(k=>topics[k]?.test(hint));
}
const WORDS={happy:'开心 高兴 快乐 哈哈 庆祝 成功',like:'喜欢 爱你 点赞 赞同 心动',angry:'生气 愤怒 不满',baka:'笨蛋 吐槽 玩笑',confused:'疑惑 迷惑 不懂 什么 问号',sad:'伤心 难过 抱抱 安慰 遗憾',shy:'害羞 脸红 夸奖',sigh:'无语 无奈 叹气 麻了',surprised:'惊讶 震惊 意外',sleep:'睡觉 晚安 休息 熬夜',morning:'早安 早上好',see:'偷看 观察 围观',reply:'等待 回复',meow:'卖萌 可爱 撒娇',fool:'自嘲 傻笑 尴尬',cpu:'思考 卡住 烧脑',givemoney:'报酬 奖励 给钱',work:'工作 干活 忙碌',_laugh:'大笑 哈哈 绷不住 乐子'};
function description(asset,visual){const packs=[...new Set(asset.sources.map(s=>s.pack))];return correctedDescription(asset.id,[asset.animated?'动图':'静态图',visual?.description||'视觉内容待核对',visual?.visible_text?'图中文字：'+visual.visible_text:'',visual?.use_for||'',asset.categories.map(c=>WORDS[c.key]||c.key).join(' '),'来源：'+packs.join('、')+'；图中角色不是莉莉丝本人'].filter(Boolean).join('；').slice(0,800));}
module.exports={SCOPE,MAX_ASSET_BYTES,ensureSchema,eligible,description,correctedDescription,interpretationAllowed};
