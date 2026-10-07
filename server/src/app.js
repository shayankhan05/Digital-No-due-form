import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import nodemailer from 'nodemailer';
import {DocumentStore} from './services/document-store.js';
import {authenticate} from './middleware/auth.js';
import {dataRoutes,serialize} from './routes/data.js';
import {createProvisioner} from './services/provisioning.js';
import {syncStudentWorkflow} from './services/clearance.js';
import {searchOfficeStudents,syncOfficeSearchIndex} from './services/office-search.js';
import {submitRequest,requestAction} from './services/requests.js';
import {resourceRoutes} from './routes/resources.js';
export function createApp({database,client,auth,demo=false,origins=[],smtpPassword='',firebaseWebApiKey=''}){
  const app=express(),store=new DocumentStore(database,client);app.disable('x-powered-by');app.use(helmet());
  app.use(cors({origin:(origin,callback)=>callback(null,!origin||origins.includes(origin)),methods:['GET','POST','PUT'],allowedHeaders:['Authorization','Content-Type']}));app.use(express.json({limit:'1mb'}));
  app.get('/health',async(req,res)=>{try{await database.command({ping:1});res.json({status:'ok',database:'mongodb'});}catch{res.status(503).json({status:'unavailable'});}});
  app.use('/api',authenticate(auth,store));app.get('/api/auth/profile',(req,res)=>res.json(req.actor));
  const service=createProvisioner({db:store,auth,demo,sendActivation:async(email,link,policy)=>{if(firebaseWebApiKey){const response=await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${encodeURIComponent(firebaseWebApiKey)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestType:'PASSWORD_RESET',email})});if(!response.ok)throw new Error('Firebase activation email delivery failed.');return;}if(!policy.smtpHost||!policy.smtpUser||!policy.mailFrom||!smtpPassword)throw new Error('Configure Firebase email API key or institution SMTP.');await nodemailer.createTransport({host:policy.smtpHost,port:policy.smtpPort,secure:policy.smtpPort===465,requireTLS:true,auth:{user:policy.smtpUser,pass:smtpPassword}}).sendMail({from:policy.mailFrom,to:email,subject:'Your Digital No-Due account has been created',text:`Set your password: ${link}`});}});
  app.use('/api/data',dataRoutes(store));
  app.use('/api',resourceRoutes(store));
  app.post('/api/admin',async(req,res)=>{const result=await service.dispatch(req.actor.uid,req.body);if(req.body.action==='provision'||req.body.action==='repairDemoProfile'){if(result.uid)await syncOfficeSearchIndex(store,result.uid);}res.json(serialize(result));});
  app.post('/api/students/workflow',async(req,res)=>{const uid=req.body.studentUid||req.actor.uid;if(req.actor.role!=='admin'&&(req.actor.role!=='student'||uid!==req.actor.uid))throw Object.assign(new Error('Not your workflow.'),{code:'permission-denied'});res.json(serialize(await syncStudentWorkflow(store,uid)));});
  app.post('/api/office/search',async(req,res)=>res.json(serialize(await searchOfficeStudents(store,req.actor.uid,req.body))));
  app.post('/api/requests',async(req,res)=>res.json(await submitRequest(store,req.actor)));
  app.post('/api/requests/:id/actions',async(req,res)=>res.json(await requestAction(store,req.actor,req.params.id,req.body)));
  app.use((error,req,res,next)=>{const code=error.code||'failed-precondition',status=({unauthenticated:401,'permission-denied':403,'already-exists':409,'invalid-argument':400})[code]||400;res.status(status).json({error:{code,message:error.message||'Operation failed.'}});});
  return {app,store};
}
