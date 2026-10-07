import {MongoMemoryReplSet} from 'mongodb-memory-server';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
const dbPath=resolve('.mongo-data/dev');await mkdir(dbPath,{recursive:true});
const replica=await MongoMemoryReplSet.create({instanceOpts:[{port:27017,dbPath}],replSet:{name:'rs0',storageEngine:'wiredTiger'}});
console.log('Local persistent MongoDB: mongodb://127.0.0.1:27017/digital_no_due_dev?replicaSet=rs0');
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await replica.stop({doCleanup:false});process.exit(0);});
