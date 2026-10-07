// Explicit, operator-run first administrator setup. Never changes Firebase Auth.
import 'dotenv/config';
import {firebaseAdmin} from '../src/firebase-admin.js';
import {connectDatabase} from '../src/db.js';
const uid=process.argv[2];
if(!uid||!/^[A-Za-z0-9_-]{1,128}$/.test(uid))throw new Error('Usage: node scripts/bootstrap-admin.mjs EXISTING_FIREBASE_AUTH_UID');
const {app,auth}=firebaseAdmin(),user=await auth.getUser(uid);
if(user.disabled)throw new Error('The selected Auth account is disabled.');
const {client,database}=await connectDatabase(process.env.MONGODB_URI);
try{const old=await database.collection('users').findOne({_id:uid});if(old){if(old.role!=='admin')throw new Error('Existing institutional profile will not be overwritten or promoted.');console.log('Administrator already exists; nothing changed.');}else{await database.collection('users').insertOne({_id:uid,firebaseUid:uid,name:user.displayName||'College Administrator',email:user.email,role:'admin',department:process.env.ADMIN_DEPARTMENT||'ISE',facultyId:'BOOTSTRAP-'+uid.slice(0,32),createdAt:new Date(),updatedAt:new Date()});console.log('Institutional administrator created for the existing Auth UID.');}}finally{await client.close();await app.delete();}
