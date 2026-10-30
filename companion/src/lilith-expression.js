'use strict';
// Only select authored guidance. Untrusted message text is never interpolated
// into the trusted expression rules or recorded as a remembered event.
function expressionStyle(profile,{channel='desktop',message='',mode='in_character',baselineOnly=false,proactive=false}={}){
 if(baselineOnly||mode==='ooc')return '';
 const scope=channel==='qq_group'?'group':'private';
 const lines=[`LILITH EXPRESSION ${profile.version} (authored supplement; original identity and relationship rules remain in force):`,...profile.shared,...profile[scope]];
 const example=!proactive&&(profile.examples||[]).filter(e=>new RegExp(e.match,'iu').test(String(message).slice(0,2000))).sort((a,b)=>b.priority-a.priority)[0];
 if(proactive)lines.push('这次是自己主动来搭话；旧话题可作参考，旧问候不当成主人刚刚又说了一遍。');
 if(example){lines.push(profile.examples_notice,'本轮表达示意：'+JSON.stringify({topic:example.id,user:example.user,replies:example[scope]}));}
 lines.push('按本轮最终语言要求自然表达；示意中的中文不改变回复语言。');return lines.join('\n');
}
module.exports={expressionStyle};
