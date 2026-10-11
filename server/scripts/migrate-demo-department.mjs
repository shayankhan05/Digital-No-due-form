// No Auth calls. Default is read-only; --apply backs up the database first.
import {MongoClient} from 'mongodb';
import {mkdir,writeFile} from 'node:fs/promises';
import {migrateDemoDepartment} from '../src/services/department-migration.js';
const uri=process.env.MONGODB_URI||'mongodb://127.0.0.1:27017/digital_no_due_dev?replicaSet=rs0',url=new URL(uri);
if(url.hostname!=='127.0.0.1'||url.pathname!=='/digital_no_due_dev'||process.env.FIREBASE_PROJECT_ID&&process.env.FIREBASE_PROJECT_ID!=='demo-digital-no-due')throw new Error('Migration is restricted to the local Digital No-Due demo database.');
const client=await new MongoClient(uri,{serverSelectionTimeoutMS:5000}).connect();
try{const db=client.db(),apply=process.argv.includes('--apply');if(apply){const backup={};for(const {name}of await db.listCollections().toArray())backup[name]=await db.collection(name).find({}).toArray();await mkdir('migration-output',{recursive:true});await writeFile(`migration-output/department-before-${Date.now()}.json`,JSON.stringify(backup));}console.log(JSON.stringify(await migrateDemoDepartment(db,client,{apply}),null,2));}finally{await client.close();}
