// Demo-only audit/repair. Dry-run is the default; a backup precedes any repair.
import {MongoClient} from 'mongodb';
import {mkdir,writeFile} from 'node:fs/promises';
import {repairEnrollmentDuplicates} from '../src/services/enrollment-integrity.js';
import {initializeModels} from '../src/models/index.js';
const uri=process.env.MONGODB_URI||'mongodb://127.0.0.1:27017/digital_no_due_dev?replicaSet=rs0',url=new URL(uri);
if(url.hostname!=='127.0.0.1'||url.pathname!=='/digital_no_due_dev'||process.env.FIREBASE_PROJECT_ID&&process.env.FIREBASE_PROJECT_ID!=='demo-digital-no-due')throw new Error('Repair is restricted to the loopback demo database.');
const client=await new MongoClient(uri,{serverSelectionTimeoutMS:5000}).connect();
try{const database=client.db(),apply=process.argv.includes('--apply');if(apply){await mkdir('migration-output',{recursive:true});const backup={enrollments:await database.collection('enrollments').find({}).toArray(),marks:await database.collection('marks').find({}).toArray()};await writeFile(`migration-output/enrollment-repair-${Date.now()}.json`,JSON.stringify(backup,null,2));}const report=await repairEnrollmentDuplicates(database,client,{apply});if(apply)await initializeModels(database);console.log(JSON.stringify(report,null,2));}finally{await client.close();}
