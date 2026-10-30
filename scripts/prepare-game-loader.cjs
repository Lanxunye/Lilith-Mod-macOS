'use strict';
// Download exact upstream bytes, then patch the loader locally. No game or
// generated interop assemblies are redistributed, and no DSH is downloaded.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const digest=(file,algorithm='sha256')=>crypto.createHash(algorithm).update(fs.readFileSync(file)).digest('hex');
const exists=file=>!!fs.lstatSync(file,{throwIfNoEntry:false});
function archiveEntriesSafe(names){return names.every(name=>name&&!name.includes('\0')&&!name.includes('\\')&&!name.startsWith('/')&&!name.split('/').includes('..'));}
function fetchDependency(spec,cache,{log=console.log,run=execFileSync}={}){
 const url=new URL(spec.url);if(url.protocol!=='https:'||url.username||url.password)throw Error('依赖下载地址无效。');
 const algorithm=spec.sha512?'sha512':'sha256',expected=spec[algorithm];if(!new RegExp('^[a-f0-9]{'+(algorithm==='sha512'?128:64)+'}$').test(expected||''))throw Error('依赖缺少固定校验值。');
 fs.mkdirSync(cache,{recursive:true});const file=path.join(cache,expected.slice(0,16)+'-'+path.basename(url.pathname));
 if(fs.existsSync(file)){if(digest(file,algorithm)!==expected)throw Error('缓存校验失败，请移走后重新下载：'+file);return file;}
 const temporary=file+'.download-'+process.pid;log('正在下载并校验：'+path.basename(url.pathname));
 try{run('/usr/bin/curl',['--fail','--location','--proto','=https','--proto-redir','=https','--tlsv1.2','--connect-timeout','15','--max-time','600','--retry','2',url.href,'-o',temporary],{stdio:'inherit'});
  if(digest(temporary,algorithm)!==expected)throw Error('下载文件校验失败，未执行：'+path.basename(url.pathname));fs.renameSync(temporary,file);return file;
 }finally{if(fs.existsSync(temporary))fs.unlinkSync(temporary);}
}
function prefetch(root,base,options={}){
 const manifest=JSON.parse(fs.readFileSync(path.join(root,'dependencies-macos.json'))),cache=path.join(base,'downloads'),arch=process.arch==='arm64'?'arm64':'x64';
 const be=manifest.bepinex,runtime=manifest.installer_runtime.archives[arch];
 return {bepinex:fetchDependency({url:be.url,sha256:be.sha256},cache,options),runtime:fetchDependency(runtime,cache,options),manifest,arch};
}
function prepareGameLoader(root,game,base,{log=console.log,run=execFileSync}={}){
 const metadata=JSON.parse(fs.readFileSync(path.join(root,'macos-release.json'))),core=path.join(game,'BepInEx/core'),loader=path.join(core,'BepInEx.Unity.IL2CPP.dll');
 const companion=path.join(core,'LilithLoaderCompat.dll'),dispatch=path.join(core,'liblilith_probe_dispatch.dylib');
 if(fs.existsSync(loader)&&digest(loader)===metadata.artifacts.loader.sha256&&fs.existsSync(companion)&&digest(companion)===metadata.artifacts.loader_compat.sha256&&fs.existsSync(dispatch)&&digest(dispatch)===metadata.artifacts.loader_dispatch.sha256&&['run_bepinex.sh','libdoorstop.dylib','dotnet/libcoreclr.dylib'].every(f=>fs.existsSync(path.join(game,f)))){log('兼容加载器已就绪，保留现有互操作文件。');return {reused:true};}
 const deps=JSON.parse(fs.readFileSync(path.join(root,'dependencies-macos.json')));
 if(fs.existsSync(loader)&&![deps.bepinex.original_loader_sha256,metadata.artifacts.loader.sha256].includes(digest(loader)))throw Error('检测到不同版本的加载器，已保留。请使用干净游戏目录，或参阅安装帮助。');
 for(const name of ['BepInEx','dotnet','LilithMod'])if(exists(path.join(game,name))&&fs.lstatSync(path.join(game,name)).isSymbolicLink())throw Error('附加组件目录是符号链接，拒绝覆盖：'+name);
 const downloaded=prefetch(root,base,{log,run}),stage=fs.mkdtempSync(path.join(game,'.lilith-loader-')),archive=path.join(stage,'upstream'),runtime=path.join(stage,'patch-runtime');
 try{
  const entries=run('/usr/bin/unzip',['-Z1',downloaded.bepinex],{encoding:'utf8'}).trim().split('\n');if(!archiveEntriesSafe(entries))throw Error('依赖压缩包路径检查失败。');
  fs.mkdirSync(archive);run('/usr/bin/ditto',['-xk',downloaded.bepinex,archive]);
  const extractedCore=path.join(archive,'BepInEx/core'),original=path.join(extractedCore,'BepInEx.Unity.IL2CPP.dll');if(digest(original)!==deps.bepinex.original_loader_sha256)throw Error('上游加载器与固定版本不符。');
  const members=run('/usr/bin/tar',['-tzf',downloaded.runtime],{encoding:'utf8'}).trim().split('\n');if(!archiveEntriesSafe(members))throw Error('运行时压缩包路径检查失败。');
  fs.mkdirSync(runtime);run('/usr/bin/tar',['-xzf',downloaded.runtime,'-C',runtime]);
  const tools=path.join(stage,'patcher');fs.cpSync(path.join(root,'payload/loader-tools'),tools,{recursive:true});fs.copyFileSync(path.join(extractedCore,'Mono.Cecil.dll'),path.join(tools,'Mono.Cecil.dll'));
  fs.copyFileSync(path.join(root,'payload/LilithLoaderCompat.dll'),path.join(extractedCore,'LilithLoaderCompat.dll'));fs.copyFileSync(path.join(root,'payload/liblilith_probe_dispatch.dylib'),path.join(extractedCore,'liblilith_probe_dispatch.dylib'));
  log('正在为本机生成兼容加载器，不需要安装开发工具……');
  const patched=original+'.patched';run(path.join(runtime,'dotnet'),[path.join(tools,'LoaderPatcher.dll'),original,path.join(extractedCore,'LilithLoaderCompat.dll'),patched],{stdio:'inherit',env:{...process.env,DOTNET_ROOT:runtime,DOTNET_CLI_TELEMETRY_OPTOUT:'1',DOTNET_GENERATE_ASPNET_CERTIFICATE:'false'}});
  if(digest(patched)!==metadata.artifacts.loader.sha256)throw Error('本机生成的加载器校验失败，未安装。');fs.renameSync(patched,original);
  const overlay=path.join(stage,'ready');fs.mkdirSync(overlay);for(const name of ['BepInEx','dotnet']){if(exists(path.join(game,name)))fs.cpSync(path.join(game,name),path.join(overlay,name),{recursive:true,verbatimSymlinks:true});fs.cpSync(path.join(archive,name),path.join(overlay,name),{recursive:true});}
  fs.mkdirSync(path.join(overlay,'BepInEx/config'),{recursive:true});if(!fs.existsSync(path.join(overlay,'BepInEx/config/BepInEx.cfg')))fs.copyFileSync(path.join(root,'packaging/BepInEx.cfg'),path.join(overlay,'BepInEx/config/BepInEx.cfg'));
  for(const name of ['run_bepinex.sh','libdoorstop.dylib','.doorstop_version'])fs.copyFileSync(path.join(archive,name),path.join(overlay,name));fs.chmodSync(path.join(overlay,'run_bepinex.sh'),0o755);
  const names=['BepInEx','dotnet','run_bepinex.sh','libdoorstop.dylib','.doorstop_version'];
  for(const [name,target]of [['Data','Lilith.app/Contents/Resources/Data'],['GameAssembly.dylib','Lilith.app/Contents/Frameworks/GameAssembly.dylib']]){
   if(!exists(path.join(game,name))){fs.symlinkSync(target,path.join(overlay,name));names.push(name);}
   else if(!fs.lstatSync(path.join(game,name)).isSymbolicLink()||fs.readlinkSync(path.join(game,name))!==target)throw Error('游戏目录中已有不同的 '+name+'，已保留，请参阅帮助。');
  }
  return {reused:false,stage,overlay,names};
 }catch(e){fs.rmSync(stage,{recursive:true,force:true});throw e;}
}
function installPreparedLoader(prepared,game,backup){
 if(prepared.reused)return;const completed=[];fs.mkdirSync(backup,{recursive:true});
 try{for(const name of prepared.names){const target=path.join(game,name),old=path.join(prepared.stage,'old',name);fs.mkdirSync(path.dirname(old),{recursive:true});if(exists(target)){fs.cpSync(target,path.join(backup,name),{recursive:true,verbatimSymlinks:true});fs.renameSync(target,old);}completed.push(name);fs.renameSync(path.join(prepared.overlay,name),target);}}
 catch(e){for(const name of completed.reverse()){const target=path.join(game,name),old=path.join(prepared.stage,'old',name);if(exists(target))fs.rmSync(target,{recursive:true,force:true});if(exists(old))fs.renameSync(old,target);}throw Error('加载器安装失败，已恢复原目录；'+e.message);}
 finally{fs.rmSync(prepared.stage,{recursive:true,force:true});}
}
module.exports={archiveEntriesSafe,fetchDependency,prefetch,prepareGameLoader,installPreparedLoader};
