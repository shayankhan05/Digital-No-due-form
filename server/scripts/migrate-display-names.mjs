import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {MongoClient,BSON} from 'mongodb';
import {migrateDisplayNames} from '../src/services/display-name-migration.js';
const apply=process.argv.includes('--apply'),uri=process.env.MONGODB_URI,backup=process.env.DISPLAY_NAME_BACKUP_DIR;
if(!uri||apply&&!backup)throw new Error('Set MONGODB_URI; --apply also requires DISPLAY_NAME_BACKUP_DIR outside public hosting.');
if(apply){const root=fileURLToPath(new URL('../../',import.meta.url)),relative=path.relative(root,path.resolve(backup));if(relative!== 'server'&&!relative.startsWith('server'+path.sep)&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative))throw new Error('Backup directory must be outside public hosting or inside its excluded server directory.');}
const client=new MongoClient(uri);
try{await client.connect();const database=client.db();if(apply&&database.databaseName!=='digital_no_due'&&!process.env.FIREBASE_AUTH_EMULATOR_HOST)throw new Error('Unexpected database; refusing migration.');
 const result=await migrateDisplayNames(database,client,{apply,beforeApply:async(snapshot,plan)=>{await fs.mkdir(backup,{recursive:true});const filename=path.join(backup,`display-names-${Date.now()}.ejson`);await fs.writeFile(filename,BSON.EJSON.stringify({database:database.databaseName,snapshot,plan}),{flag:'wx'});console.log('Complete Mongo backup saved before display-name changes.');}});
 const after={};for(const name of Object.keys(result.counts))after[name]=await database.collection(name).countDocuments();
 if(JSON.stringify(after)!==JSON.stringify(result.counts))throw new Error('Collection counts changed during migration; inspect backup.');
 console.log(JSON.stringify({mode:apply?'apply':'dry-run',identities:result.identities.length,documents:result.changes.length,before:result.counts,after}));
}finally{await client.close();}
