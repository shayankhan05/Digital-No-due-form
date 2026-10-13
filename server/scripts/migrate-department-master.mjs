import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {MongoClient,BSON} from 'mongodb';
import {migrateDepartmentMaster} from '../src/services/department-master.js';
import {initializeModels} from '../src/models/index.js';
// Operator-only: application startup never runs data migrations automatically.
const apply=process.argv.includes('--apply'),verify=process.argv.includes('--verify-backup'),backup=process.env.DEPARTMENT_BACKUP_PATH;
if(!process.env.MONGODB_URI)throw Error('MONGODB_URI must be supplied securely.');
if((apply||verify)&&!backup)throw Error('A backup path is required.');
const client=new MongoClient(process.env.MONGODB_URI);
try{
 await client.connect();const db=client.db(),before={};for(const c of await db.listCollections().toArray())before[c.name]=await db.collection(c.name).find({}).toArray();
 let plan=await migrateDepartmentMaster(db,client),source=before;if(verify){const saved=BSON.EJSON.parse(await fs.readFile(backup,'utf8'));assert.equal(saved.database,db.databaseName);plan=saved.plan;source=saved.snapshot;}if(apply){await fs.writeFile(backup,BSON.EJSON.stringify({database:db.databaseName,snapshot:before,plan}),{flag:'wx'});await migrateDepartmentMaster(db,client,{apply:true});await initializeModels(db);}
 if(apply||verify){for(const [collection,rows]of Object.entries(source)){const current=new Map((await db.collection(collection).find({}).toArray()).map(d=>[d._id,d]));for(const original of rows){const expected=BSON.EJSON.parse(BSON.EJSON.stringify(original)),change=plan.changes.find(c=>c.collection===collection&&c.id===original._id);Object.assign(expected,change?.fields||{});assert.deepEqual(current.get(original._id),expected,'Preservation check failed for '+collection+'/'+original._id);}}
 const repeat=await migrateDepartmentMaster(db,client);if(repeat.changes.length||repeat.departmentAdds||repeat.schemeAdds||repeat.workflowAdds)throw Error('Migration idempotency check failed.');}
 console.log(JSON.stringify({database:db.databaseName,applied:apply,verifiedBackup:verify,departmentId:plan.departmentId,departmentAdds:plan.departmentAdds,schemeAdds:plan.schemeAdds,workflowAdds:plan.workflowAdds,counts:plan.counts,preservation:apply||verify?'PASS':'DRY RUN',remaining:apply||verify?0:plan.changes.length}));
}finally{await client.close();}
