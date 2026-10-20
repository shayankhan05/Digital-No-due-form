import {readFile} from 'node:fs/promises';
import {MongoClient} from 'mongodb';
import {EJSON} from 'bson';
import dns from 'node:dns';
import {recordDigest} from '../src/services/presentation-reset.js';
const path=process.argv[2];if(!path||!process.env.MONGODB_URI_FILE)throw Error('Existing backup path and explicit URI file are required.');
const before=EJSON.parse(await readFile(path,'utf8')),raw=await readFile(process.env.MONGODB_URI_FILE,'utf8'),uri=(raw.match(/^\s*MONGODB_URI\s*=\s*(.+)\s*$/m)?.[1]||raw).trim().replace(/^(['"])(.*)\1$/,'$2');dns.setServers(['1.1.1.1']);const client=new MongoClient(uri);
try{await client.connect();const changed=[],counts={};for(const name of Object.keys(before)){const after=await client.db().collection(name).find({}).sort({_id:1}).toArray();counts[name]=after.length;if(recordDigest(after)!==recordDigest(before[name]))changed.push(name);}console.log(JSON.stringify({changed,counts,productionWrites:0}));if(changed.length)process.exitCode=2;}catch{console.error('Read-only preservation verification failed; credentials are not printed.');process.exitCode=1;}finally{await client.close();}
