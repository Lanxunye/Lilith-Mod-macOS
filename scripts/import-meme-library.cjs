'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite'),{SCOPE,MAX_ASSET_BYTES,ensureSchema,description}=require('../companion/src/meme-library'),{imageType}=require('../companion/src/qq-capabilities');
function importLibrary(dataRoot,prepared,visual){
 const media=path.join(dataRoot,'qq-media');fs.mkdirSync(media,{recursive:true,mode:0o700});
 const rows=prepared.assets.map(asset=>{
  const bytes=fs.readFileSync(asset.path),id=crypto.createHash('sha256').update(bytes).digest('hex'),mime=imageType(bytes);
  if(id!==asset.id||bytes.length>MAX_ASSET_BYTES||mime!==asset.mime||!visual[id]?.description)throw Error('asset_validation_failed:'+asset.id);
  const file=path.join(media,id+'.'+mime.split('/')[1]);
  if(fs.existsSync(file)){if(!fs.readFileSync(file).equals(bytes))throw Error('asset_collision');}
  else{fs.copyFileSync(asset.path,file,fs.constants.COPYFILE_EXCL);fs.chmodSync(file,0o600);}
  const {path:original,...metadata}=asset;return {id,file,mime,metadata:{...metadata,visual:visual[id]},description:description(asset,visual[id])};
 });
 const db=new DatabaseSync(path.join(dataRoot,'conversations.sqlite'));db.exec('PRAGMA busy_timeout=5000');ensureSchema(db);
 db.exec('CREATE TABLE IF NOT EXISTS qq_stickers(id TEXT,scope TEXT,path TEXT,mime TEXT,description TEXT,created_at TEXT,PRIMARY KEY(id,scope))');
 try{db.exec('BEGIN IMMEDIATE');let added=0;
  for(const row of rows){const existed=db.prepare('SELECT 1 FROM qq_meme_assets WHERE id=?').get(row.id);if(!existed)added++;
   db.prepare('INSERT INTO qq_meme_assets(id,metadata,enabled) VALUES (?,?,1) ON CONFLICT(id) DO UPDATE SET metadata=excluded.metadata').run(row.id,JSON.stringify(row.metadata));
   db.prepare('INSERT INTO qq_stickers VALUES (?,?,?,?,?,?) ON CONFLICT(id,scope) DO UPDATE SET path=excluded.path,mime=excluded.mime,description=excluded.description').run(row.id,SCOPE,row.file,row.mime,row.description,new Date().toISOString());
  }
  db.exec('COMMIT');return {added,total:rows.length,animated:rows.filter(r=>r.metadata.animated).length,described:rows.length};
 }catch(e){db.exec('ROLLBACK');throw e;}finally{db.close();}
}
if(require.main===module){const root=path.resolve(__dirname,'../private-source/meme-packs'),dataRoot=process.argv[2];if(!dataRoot||!path.isAbsolute(dataRoot))throw Error('explicit_data_root_required');console.log(JSON.stringify(importLibrary(dataRoot,JSON.parse(fs.readFileSync(path.join(root,'prepared.json'))),JSON.parse(fs.readFileSync(path.join(root,'descriptions.json'))))));}
module.exports={importLibrary};
