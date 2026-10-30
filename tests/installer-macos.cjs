'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {install,verify}=require('../scripts/install-macos.cjs');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lilith-installer-test-'));
const root=path.join(dir,'package'),base=path.join(dir,'program'),data=path.join(dir,'private-data');
fs.mkdirSync(root);fs.mkdirSync(data);fs.writeFileSync(path.join(data,'qq.json'),'PRIVATE SETTINGS SENTINEL');
fs.writeFileSync(path.join(root,'macos-release.json'),JSON.stringify({version:'0.3.4-macos.dev15'}));
fs.writeFileSync(path.join(root,'example.txt'),'public payload');
function manifest(){fs.writeFileSync(path.join(root,'SHA256SUMS.txt'),['example.txt','macos-release.json'].map(n=>crypto.createHash('sha256').update(fs.readFileSync(path.join(root,n))).digest('hex')+'  '+n).join('\n')+'\n');}
manifest();
assert.equal(install({root,base,check:true}).verified,true);assert.equal(fs.existsSync(base),false);
const first=install({root,base});assert.equal(verify(first.dest),verify(root));assert.equal(fs.statSync(first.entry).mode&0o111,0o111);
assert.equal(install({root,base}).dest,first.dest);assert.equal(fs.readFileSync(path.join(data,'qq.json'),'utf8'),'PRIVATE SETTINGS SENTINEL');
fs.writeFileSync(path.join(root,'example.txt'),'tampered');assert.throws(()=>install({root,base}),/文件校验失败/);manifest();assert.throws(()=>install({root,base}),/同版本目录内容不同/);
const other=path.join(dir,'outside.txt');fs.writeFileSync(other,'outside');fs.unlinkSync(path.join(root,'example.txt'));fs.symlinkSync(other,path.join(root,'example.txt'));manifest();assert.throws(()=>verify(root),/文件校验失败/);
fs.writeFileSync(path.join(root,'SHA256SUMS.txt'),'a'.repeat(64)+'  ../outside.txt\n');assert.throws(()=>verify(root),/路径无效/);
fs.rmSync(dir,{recursive:true,force:true});console.log('installer-macos: dry-run, atomic version install, repeat reuse, private-data retention, tamper/conflicting version/symlink/traversal rejection passed');
