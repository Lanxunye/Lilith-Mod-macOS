'use strict';
// Derived package payloads; canonical inputs stay in character/ and companion/.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),target=path.join(root,'dsh-feiyu-mood-lilith');
for(const [from,to] of [['character/lilith-style.json','lilith-style.json'],['companion/src/lilith-style.js','style.cjs']]) {
 const input=fs.readFileSync(path.join(root,from));
 fs.writeFileSync(path.join(target,to),input);
 console.log(to+' '+crypto.createHash('sha256').update(input).digest('hex'));
}
