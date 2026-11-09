import {readFile} from 'node:fs/promises';
import {MongoClient} from 'mongodb';
import {EJSON} from 'bson';
import {testRecordDigest} from '../src/services/test-data-cleanup.js';

// This is intentionally not available through HTTP or the normal CSV importer.
const [mode,filename]=process.argv.slice(2);
if(!['--inspect','--register'].includes(mode)||!filename)throw Error('Usage: node scripts/review-test-provenance.mjs --inspect|--register manifest.ejson');
const manifest=EJSON.parse(await readFile(filename,'utf8'));
const allowed=new Set(['users','subjects','offerings','enrollments','marks','assignments','clearancePlans','noDueRequests','approvals','notifications','workflowOverrides','hallTickets','uniqueIdentities','provisioningJobs']);
if(!Array.isArray(manifest)||!manifest.length||manifest.length>500||manifest.some(r=>!allowed.has(r.collection)||typeof r.recordId!=='string'||!r.recordId||r.recordId.length>240))throw Error('Provide 1–500 exact eligible collection/recordId entries.');
if(new Set(manifest.map(r=>r.collection+':'+r.recordId)).size!==manifest.length)throw Error('Duplicate manifest entries.');
const uri=process.env.MONGODB_URI;
if(!uri||!new URL(uri).pathname.slice(1))throw Error('An explicit MongoDB database is required.');
const client=new MongoClient(uri,{serverSelectionTimeoutMS:12000});
try{
 await client.connect();const db=client.db();
 const inspect=async(session)=>{
  const output=[];
  for(const entry of manifest){
   const {collection,recordId}=entry,row=await db.collection(collection).findOne({_id:recordId},{session});
   if(!row)throw Error('One or more exact records are missing.');
   if(['production','historical-production'].includes(row.dataOrigin))throw Error('The manifest includes an explicitly protected record.');
   output.push({collection,recordId,digest:testRecordDigest(row),origin:row.dataOrigin||'unclassified'});
  }
  return output;
 };
 if(mode==='--inspect')console.log(JSON.stringify(await inspect(),null,2));
 else{
  if(process.env.CONFIRM_TEST_PROVENANCE!=='REVIEWED'||manifest.some(r=>typeof r.evidence!=='string'||r.evidence.trim().length<10||r.evidence.length>500||!/^[a-f0-9]{64}$/.test(r.digest||'')))throw Error('Supply reviewed exact hashes, evidence, and CONFIRM_TEST_PROVENANCE=REVIEWED.');
  const session=client.startSession();
  try{await session.withTransaction(async()=>{
   const actual=await inspect(session);if(actual.some((r,i)=>r.digest!==manifest[i].digest))throw Error('Reviewed record changed. Inspect it again.');
   for(const {collection,recordId,digest,evidence} of manifest){
    await db.collection('testDataRegistry').updateOne({_id:testRecordDigest({collection,recordId})},{$set:{collection,recordId,digest,evidence:evidence.trim(),origin:'test',reviewedAt:new Date()}},{upsert:true,session});
   }
  },{writeConcern:{w:'majority'}});}finally{await session.endSession();}
  console.log(JSON.stringify({registered:manifest.length,deleted:0}));
 }
}catch(e){console.error(e.code||(/^(One or more|The manifest|Reviewed record|Supply reviewed)/.test(e.message)?e.message:'Operation stopped; check connection and permissions.'));process.exitCode=1;}finally{await client.close();}
