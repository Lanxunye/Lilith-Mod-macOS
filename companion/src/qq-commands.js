'use strict';
// Parsing and help share one catalogue so displayed commands stay executable.
const COMMANDS=[
 {action:'help',names:['','help','?'],options:[''],section:'帮助与状态',usage:'/lls、/lls help、/lls ?',description:'显示全部可执行命令。'},
 {action:'state',names:['state','states'],options:[''],section:'帮助与状态',usage:'/lls state（别名：/lls states）',description:'查询回复开关、语音模式、合成服务和群聊绘图额度。'},
 {action:'search',names:['search'],options:['on','off'],section:'联网搜索',usage:'/lls search on 或 /lls search off',description:'QQ 联网总开关；使用 DSH 官方 Key，私聊与每群分别计量，不改变回复开关。'},
 {action:'psearch',names:['psearch'],options:['on','off'],section:'联网搜索',usage:'/lls psearch on 或 /lls psearch off',description:'主人私聊联网开关，仍受联网总开关约束。'},
 {action:'gsearch',names:['gsearch'],options:['on','off'],section:'联网搜索',usage:'/lls gsearch on 或 /lls gsearch off',description:'白名单群联网开关，仍受群聊及联网总开关约束。'},
 {action:'tts',names:['tts'],options:['','on','off'],section:'语音',usage:'/lls tts [on|off]',description:'私聊语音开关；不带参数时切换。'},
 {action:'group tts',names:['group tts','gtts'],options:['','on','off'],section:'语音',usage:'/lls group tts [on|off]（别名：/lls gtts）',description:'群聊语音开关；不带参数时切换，与私聊独立。'},
 {action:'tts',names:['tts'],options:['all'],section:'语音',usage:'/lls tts all',description:'在“全部语音／仅温柔语音”之间切换；不打开通道开关。'},
 {action:'tts',names:['tts'],options:['gentle'],section:'语音',usage:'/lls tts gentle',description:'直接设为仅温柔语音，群聊与私聊共用模式。'},
 {action:'group',names:['group'],options:['','on','off'],section:'群聊与绘图',usage:'/lls group [on|off]',description:'白名单群聊回复总开关；不带参数时切换。'},
 {action:'pdraw',names:['pdraw','privateart'],options:['','on','off'],section:'群聊与绘图',usage:'/lls pdraw on 或 /lls pdraw off（别名：/lls privateart）',description:'主人私聊绘图的独立开关；明确 @ 请求，不设每日次数上限；不带参数时切换。'},
 {action:'draw',names:['draw','groupart'],options:['','on','off'],section:'群聊与绘图',usage:'/lls draw [on|off]（别名：/lls groupart）',description:'群聊生图开关；不带参数时切换。须实际 @ 请求，每群每天最多 10 张。'}
];
function parseCommand(text){
 if(typeof text!=='string'||!/^\/lls(?:\s|$)/i.test(text))return null;
 const input=text.slice(4).trim().toLowerCase().replace(/\s+/g,' ');
 // Longest command name first: group tts must not become group + bad arguments.
 const names=[...new Set(COMMANDS.flatMap(c=>c.names))].sort((a,b)=>b.length-a.length);
 const name=names.find(n=>input===n||n&&input.startsWith(n+' '));
 if(name===undefined)return {action:'invalid',reason:'未知命令，请从下方列表选择。'};
 const option=input.slice(name.length).trim();
 const command=COMMANDS.find(c=>c.names.includes(name)&&c.options.includes(option));
 return command?{action:command.action,option:option||undefined}:{action:'invalid',reason:'参数无效；开关使用 on 或 off，模式使用下方列出的完整指令。'};
}
function commandHelp(){
 const lines=['莉莉丝 · 全部命令','由绑定主人在好友私聊中发送。'];let section='';
 for(const c of COMMANDS){if(c.section!==section){section=c.section;lines.push('','【'+section+'】');}lines.push(c.usage,c.description);}
 lines.push('','[on|off] 表示可选参数，输入时不要带方括号。','语音成功时不重复发文字；失败回退文字。群聊仍受总开关、白名单和额度约束。');
 return lines.join('\n');
}
module.exports={COMMANDS,parseCommand,commandHelp};
