#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {execFileSync,spawnSync}=require('node:child_process');
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
function verify(root){
 const list=path.join(root,'SHA256SUMS.txt');
 if(!fs.existsSync(list))throw Error('缺少 SHA256SUMS.txt。请使用 Release 部署包；源码请先运行打包工具。');
 const rows=fs.readFileSync(list,'utf8').trim().split('\n');
 for(const row of rows){const m=/^([a-f0-9]{64})  (.+)$/.exec(row);if(!m||path.isAbsolute(m[2])||m[2].split('/').includes('..'))throw Error('校验清单格式或路径无效');
  const p=path.join(root,m[2]);if(!fs.realpathSync(p).startsWith(fs.realpathSync(root)+path.sep)||fs.lstatSync(p).isSymbolicLink()||hash(p)!==m[1])throw Error('文件校验失败：'+m[2]);}
 return hash(list);
}
function install({root,base,check=false}){
 const metadata=JSON.parse(fs.readFileSync(path.join(root,'macos-release.json'),'utf8'));
 if(!/^\d+\.\d+\.\d+-macos\.dev\d+(\.\d+)?$/.test(metadata.version))throw Error('版本格式无效');
 const sum=verify(root),dest=path.join(base,'versions',metadata.version);
 if(fs.existsSync(dest)&&verify(dest)!==sum)throw Error('同版本目录内容不同，拒绝覆盖；请保留旧目录并使用新的发布版本。');
 if(check)return {version:metadata.version,dest,verified:true};
 fs.mkdirSync(path.dirname(dest),{recursive:true});
 if(!fs.existsSync(dest)){
  const temp=fs.mkdtempSync(path.join(path.dirname(dest),'.install-'));
  // Publish the complete verified tree atomically. No personal data lives here.
  fs.cpSync(root,temp,{recursive:true,dereference:false,filter:p=>!p.split(path.sep).includes('.git')});
  verify(temp);fs.renameSync(temp,dest);
 }
 const entry=path.join(base,'打开莉莉丝控制台.command');
 const node=process.execPath;
 const quote=s=>"'"+s.replace(/'/g,"'\\''")+"'";
 fs.writeFileSync(entry,'#!/bin/bash\nset -euo pipefail\nexec '+quote(node)+' '+quote(path.join(dest,'scripts/open-console.cjs'))+' "$@"\n',{mode:0o755});
 fs.chmodSync(entry,0o755);
 return {version:metadata.version,dest,entry,verified:true};
}
function gamePlan(root,game){
 const app=path.join(game,'Lilith.app'),plist=path.join(app,'Contents/Info.plist');
 const value=k=>execFileSync('/usr/libexec/PlistBuddy',['-c','Print :'+k,plist],{encoding:'utf8'}).trim();
 if(value('CFBundleIdentifier')!=='com.Nino.Lilith'||value('CFBundleShortVersionString')!=='1.1.0')throw Error('仅支持官方 Mac 游戏 1.1.0；请选择包含 Lilith.app 的目录。');
 const metadata=JSON.parse(fs.readFileSync(path.join(root,'macos-release.json'),'utf8'));
 const required=['run_bepinex.sh','libdoorstop.dylib','dotnet/libcoreclr.dylib','BepInEx/interop/Assembly-CSharp.dll','BepInEx/core/LilithLoaderCompat.dll','BepInEx/core/liblilith_probe_dispatch.dylib'];
 for(const name of required)if(!fs.existsSync(path.join(game,name)))throw Error('缺少兼容加载器组件：'+name+'。请先完成 docs/macos-preview.md 的加载器步骤。');
 for(const [name,key] of [['BepInEx/core/BepInEx.Unity.IL2CPP.dll','loader'],['BepInEx/core/LilithLoaderCompat.dll','loader_compat']])if(hash(path.join(game,name))!==metadata.artifacts[key].sha256)throw Error('加载器与本包验证版本不一致：'+name);
 const running=execFileSync('/bin/ps',['-axo','comm='],{encoding:'utf8'});
 if(running.split('\n').some(x=>x.trim().endsWith('/Lilith.app/Contents/MacOS/Lilith')))throw Error('请先退出所有莉莉丝游戏，再安装插件。');
 if(spawnSync('/usr/bin/arch',['-x86_64','/usr/bin/true']).status!==0)throw Error('需要可运行 x86_64 程序的系统；Apple Silicon 请先安装 Rosetta 并自行接受 Apple 许可。');
 for(const name of ['LilithMod.dll','liblilith_macos.dylib'])if(!fs.existsSync(path.join(root,'payload',name)))throw Error('缺少插件二进制：'+name);
 return {game,metadata};
}
async function installGame(root,game,base){
 const plan=gamePlan(root,game);
 console.log('将更新此游戏的附加插件：'+plan.game+'\n原插件会备份；游戏 .app、存档、聊天配置不改动。');
 const rl=require('node:readline/promises').createInterface({input:process.stdin,output:process.stdout});
 let yes;try{yes=await rl.question('输入 INSTALL 确认该目录：');}finally{rl.close();}
 if(yes!=='INSTALL')throw Error('已取消安装');
 gamePlan(root,game); // Recheck after the user has seen the target.
 const backup=path.join(base,'backups',new Date().toISOString().replace(/[:.]/g,'-'));fs.mkdirSync(backup,{recursive:true});
 const files=['LilithMod.dll','liblilith_macos.dylib','companion','character','locales','assets'];
 const plugins=path.join(game,'BepInEx/plugins');
 for(const name of files){const target=path.join(plugins,name);if(fs.existsSync(target))fs.cpSync(target,path.join(backup,name),{recursive:true});}
 // Stage all copies before changing any existing plugin.
 const stage=fs.mkdtempSync(path.join(game,'.lilith-update-'));
 for(const name of files){const source=['LilithMod.dll','liblilith_macos.dylib'].includes(name)?path.join(root,'payload',name):name==='assets'?path.join(root,'plugin/assets'):path.join(root,name);fs.cpSync(source,path.join(stage,name),{recursive:true});}
 const completed=[];
 try{
  fs.mkdirSync(plugins,{recursive:true});
  for(const name of files){const target=path.join(plugins,name);if(fs.existsSync(target))fs.renameSync(target,path.join(stage,name+'.previous'));completed.push(name);fs.renameSync(path.join(stage,name),target);}
  const support=path.join(game,'LilithMod');fs.mkdirSync(path.join(support,'runtime/node/bin'),{recursive:true});
  for(const name of ['launch-installed-macos.cjs','companion-service.cjs','startup-services.cjs','open-console.cjs']){const target=path.join(support,name);if(fs.existsSync(target))fs.copyFileSync(target,path.join(backup,name));fs.copyFileSync(path.join(root,'scripts',name),target);}
  fs.copyFileSync(process.execPath,path.join(support,'runtime/node/bin/node'));fs.chmodSync(path.join(support,'runtime/node/bin/node'),0o755);
  const nodeLicense=path.resolve(path.dirname(process.execPath),'../LICENSE');if(fs.existsSync(nodeLicense))fs.copyFileSync(nodeLicense,path.join(support,'runtime/node/LICENSE')); 
  const command=path.join(game,'启动莉莉丝Mod.command');if(fs.existsSync(command))fs.copyFileSync(command,path.join(backup,'启动莉莉丝Mod.command'));
  fs.writeFileSync(command,'#!/bin/bash\nset -euo pipefail\nHERE="$(cd "$(dirname "$0")" && pwd)"\nexec "$HERE/LilithMod/runtime/node/bin/node" "$HERE/LilithMod/launch-installed-macos.cjs" "$@"\n',{mode:0o755});fs.chmodSync(command,0o755);
 }catch(e){
  for(const name of completed.reverse()){const target=path.join(plugins,name);fs.rmSync(target,{recursive:true,force:true});const old=path.join(stage,name+'.previous');if(fs.existsSync(old))fs.renameSync(old,target);}
  throw Error('安装未完成；已回退插件，支持文件备份在 '+backup+'；'+e.message);
 }
 console.log('插件安装完成。备份：'+backup+'\n先启动 Steam，再双击游戏目录中的 启动莉莉丝Mod.command。');
}
async function main(){
 if(process.platform!=='darwin')throw Error('部署入口仅支持 macOS');
 if(!process.versions.node.startsWith('24.'))throw Error('需要 Node 24');
 const root=path.resolve(__dirname,'..'),base=process.env.LILITH_INSTALL_ROOT||path.join(os.homedir(),'Library/Application Support/LilithMod');
 const result=install({root,base,check:process.argv.includes('--check')});console.log(JSON.stringify(result,null,2));
 if(process.argv.includes('--check'))return;
 if(process.argv.includes('--game')){
  const option=process.argv.find(a=>a.startsWith('--game-dir='));
  const game=option?path.resolve(option.slice(11)):path.join(os.homedir(),'Library/Application Support/Steam/steamapps/common/The NOexistenceN of Lilith');
  await installGame(result.dest,game,base);
 }else if(process.argv.includes('--launch')){
  const p=spawnSync(process.execPath,[path.join(result.dest,'scripts/open-console.cjs'),'--tab=settings'],{stdio:'inherit'});if(p.status!==0)throw Error('文件部署完成；控制台启动失败，请检查私有数据目录的服务日志。');
 }
}
module.exports={verify,install,gamePlan};
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
