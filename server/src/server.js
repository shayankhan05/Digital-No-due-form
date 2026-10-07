import 'dotenv/config';
import {connectDatabase} from './db.js';
import {firebaseAdmin} from './firebase-admin.js';
import {createApp} from './app.js';
const {database,client}=await connectDatabase(process.env.MONGODB_URI),{auth,demo}=firebaseAdmin();
const origins=(process.env.FRONTEND_ORIGIN||'').split(',').map(v=>v.trim()).filter(Boolean);if(!origins.length)throw new Error('FRONTEND_ORIGIN is required.');
const {app}=createApp({database,client,auth,demo,origins,smtpPassword:process.env.SMTP_PASSWORD,firebaseWebApiKey:process.env.FIREBASE_WEB_API_KEY}),port=Number(process.env.PORT||3000);
const server=app.listen(port,()=>console.log(`Digital No-Due API listening on ${port}`));
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>server.close(async()=>{await client.close();process.exit(0);}));
