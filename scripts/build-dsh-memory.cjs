'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
fs.copyFileSync(path.join(root,'companion/src/dsh-memory.js'),path.join(root,'dsh-fish-memory-lilith/store.cjs'));
console.log('Native memory storage payload synchronized.');
