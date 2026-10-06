// Only callable requests authenticated as institutional administrators reach provisioning.
import {initializeApp} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';
import {getFirestore} from 'firebase-admin/firestore';
import {onCall,HttpsError} from 'firebase-functions/v2/https';
import {defineSecret} from 'firebase-functions/params';
import {createProvisioner} from './provisioning.js';
import {syncStudentWorkflow} from './clearance.js';
import {onDocumentWritten} from 'firebase-functions/v2/firestore';
import {syncOfficeSearchIndex,searchOfficeStudents} from './office-search.js';
import nodemailer from 'nodemailer';
initializeApp();
const smtpPassword=defineSecret('SMTP_PASSWORD');
const demo=process.env.FUNCTIONS_EMULATOR==='true';
const project=process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
if(demo && (!project?.startsWith('demo-') || !/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '') || !/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST || ''))) throw new Error('Local provisioning requires a demo project and both loopback emulators.');
const service=createProvisioner({db:getFirestore(),auth:getAuth(),demo,sendActivation:async(email,link,policy)=>{
  if(!policy.smtpHost || !policy.smtpUser || !policy.mailFrom) throw new Error('Configure institution SMTP host/user/from and SMTP_PASSWORD before activation delivery.');
  const transport=nodemailer.createTransport({host:policy.smtpHost,port:Number(policy.smtpPort || 465),secure:Number(policy.smtpPort || 465)===465,auth:{user:policy.smtpUser,pass:smtpPassword.value()},requireTLS:true});
  await transport.sendMail({from:policy.mailFrom,to:email,subject:'Your Digital No-Due account has been created',text:`Your Digital No-Due account has been created. Click here to set your password:\n${link}\n\nIf you did not expect this account, contact your college administrator.`});
}});
export const indexOfficeStudent=onDocumentWritten({document:'students/{uid}',region:'us-central1'},event=>syncOfficeSearchIndex(getFirestore(),event.params.uid));
export const officeStudentSearch=onCall({region:'us-central1',timeoutSeconds:60},async request=>{
  try{return await searchOfficeStudents(getFirestore(),request.auth?.uid,request.data);}
  catch(error){throw new HttpsError(['unauthenticated','permission-denied','invalid-argument'].includes(error.code)?error.code:'internal',error.code?error.message:'Student search failed.');}
});
export const studentWorkflow=onCall({region:'us-central1',timeoutSeconds:540},async request=>{
  if(!request.auth) throw new HttpsError('unauthenticated','Sign in first.');
  const user=(await getFirestore().doc(`users/${request.auth.uid}`).get()).data();
  const uid=request.data?.studentUid || request.auth.uid;
  if(user?.role!=='admin' && (user?.role!=='student' || uid!==request.auth.uid)) throw new HttpsError('permission-denied','Only the student or administrator can refresh this workflow.');
  if(typeof uid!=='string' || !/^[A-Za-z0-9_-]{1,128}$/.test(uid)) throw new HttpsError('invalid-argument','Invalid student UID.');
  try {return await syncStudentWorkflow(getFirestore(),uid);}
  catch(error) {throw new HttpsError('failed-precondition',error.message);}
});
export const institutionalAdmin=onCall({region:'us-central1',timeoutSeconds:540,memory:'256MiB',secrets:demo?[]:[smtpPassword]},async request=>{
  try {return await service.dispatch(request.auth?.uid,request.data);}
  catch(error) {
    if(error instanceof HttpsError) throw error;
    // Never leak reset links, tokens, passwords or credentials through unexpected errors.
    console.error('Institutional operation failed',error.code || 'internal');
    throw new HttpsError('internal','Operation failed. Retry the same import row; contact administrator if the problem persists.');
  }
});
