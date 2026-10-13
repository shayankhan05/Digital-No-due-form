import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {MongoClient,BSON} from 'mongodb';
import {migrateDepartmentLeadership} from '../src/services/leadership-migration.js';
const apply=process.argv.includes('--apply'),backup=process.env.LEADERSHIP_BACKUP_PATH;
if(!process.env.MONGODB_URI||!backup)throw Error('Secure MONGODB_URI and a fresh LEADERSHIP_BACKUP_PATH are required.');
const client=new MongoClient(process.env.MONGODB_URI);
try{
 await client.connect();const db=client.db(),snapshot={};
 for(const c of await db.listCollections().toArray())if(!c.name.startsWith('system.'))snapshot[c.name]=await db.collection(c.name).find({}).sort({_id:1}).toArray();
 const plan=await migrateDepartmentLeadership(db,client);
 if(apply){const saved=BSON.EJSON.parse(await fs.readFile(backup,'utf8'));assert.equal(saved.database,db.databaseName);assert.deepEqual(saved.snapshot,snapshot,'Database changed since backup: make a new backup and review the plan.');assert.deepEqual(saved.plan.changes,plan.changes,'Migration plan changed.');await migrateDepartmentLeadership(db,client,{apply:true});}
 else await fs.writeFile(backup,BSON.EJSON.stringify({database:db.databaseName,snapshot,plan}),{flag:'wx'});
 if(apply){for(const [collection,rows]of Object.entries(snapshot)){
  const after=await db.collection(collection).find({}).sort({_id:1}).toArray();
  const expected=rows.map(row=>({...row,...(plan.changes.find(c=>c.collection===collection&&c.id===row._id)?.fields||{})}));assert.deepEqual(after,expected,'Unexpected change in '+collection);
 }assert.equal((await migrateDepartmentLeadership(db,client)).changes.length,0);}
 console.log(JSON.stringify({applied:apply,backup,recordsBackedUp:Object.values(snapshot).reduce((n,r)=>n+r.length,0),changes:plan.changes,conflicts:plan.conflicts,preservation:apply?'PASS':'BACKUP + DRY RUN'}));
}finally{await client.close();}
