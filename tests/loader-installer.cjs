'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {archiveEntriesSafe,fetchDependency,installPreparedLoader}=require('../scripts/prepare-game-loader.cjs');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'lilith-loader-installer-'));
try{
 assert.equal(archiveEntriesSafe(['./host/fxr/file','BepInEx/core/file.dll']),true);for(const bad of [['../file'],['/tmp/file'],['dir/../../file'],['dir\\file']])assert.equal(archiveEntriesSafe(bad),false);
 const bytes=Buffer.from('fixture upstream archive'),sha256=crypto.createHash('sha256').update(bytes).digest('hex');let downloads=0;
 const options={log:()=>{},run:(_cmd,args)=>{downloads++;assert.ok(args.includes('--proto-redir'));fs.writeFileSync(args.at(-1),bytes);}};
 const spec={url:'https://vendor.example/fixed.zip',sha256},cache=path.join(root,'cache');const file=fetchDependency(spec,cache,options);assert.equal(fetchDependency(spec,cache,options),file);assert.equal(downloads,1);
 fs.writeFileSync(file,'tampered');assert.throws(()=>fetchDependency(spec,cache,options),/缓存校验失败/);assert.equal(downloads,1,'a corrupt cached file is preserved for review, never executed');
 assert.throws(()=>fetchDependency({url:'http://vendor.example/file',sha256},cache,options),/地址无效/);
 const game=path.join(root,'game'),stage=path.join(game,'.owned-stage'),overlay=path.join(stage,'ready'),backup=path.join(root,'backup');fs.mkdirSync(overlay,{recursive:true});fs.mkdirSync(path.join(game,'BepInEx'),{recursive:true});fs.writeFileSync(path.join(game,'BepInEx/old.txt'),'old loader');fs.mkdirSync(path.join(overlay,'BepInEx'));fs.writeFileSync(path.join(overlay,'BepInEx/new.txt'),'new loader');fs.writeFileSync(path.join(overlay,'run_bepinex.sh'),'new entry');
 const rename=fs.renameSync;fs.renameSync=(a,b)=>{if(a===path.join(overlay,'run_bepinex.sh'))throw Error('fixture rename failure');return rename(a,b);};
 try{assert.throws(()=>installPreparedLoader({stage,overlay,names:['BepInEx','run_bepinex.sh']},game,backup),/已恢复原目录/);}finally{fs.renameSync=rename;}
 assert.equal(fs.readFileSync(path.join(game,'BepInEx/old.txt'),'utf8'),'old loader');assert.equal(fs.existsSync(path.join(game,'BepInEx/new.txt')),false);assert.equal(fs.readFileSync(path.join(backup,'BepInEx/old.txt'),'utf8'),'old loader');assert.equal(fs.existsSync(stage),false);
 console.log('loader-installer: pinned download/cache validation, HTTPS and archive path guards, atomic publish rollback and backup preservation passed');
}finally{fs.rmSync(root,{recursive:true,force:true});}
