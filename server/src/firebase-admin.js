import {initializeApp,cert,applicationDefault} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';
export function firebaseAdmin(env=process.env){
  const projectId=env.FIREBASE_PROJECT_ID;if(!projectId)throw new Error('FIREBASE_PROJECT_ID is required.');
  const demo=!!env.FIREBASE_AUTH_EMULATOR_HOST;
  if(demo&&(!projectId.startsWith('demo-')||!/^127\.0\.0\.1:\d+$/.test(env.FIREBASE_AUTH_EMULATOR_HOST)))throw new Error('Emulator authentication requires a demo project and loopback host.');
  const credential=demo?undefined:env.FIREBASE_CLIENT_EMAIL&&env.FIREBASE_PRIVATE_KEY?cert({projectId,clientEmail:env.FIREBASE_CLIENT_EMAIL,privateKey:env.FIREBASE_PRIVATE_KEY.replace(/\\n/g,'\n')}):applicationDefault();
  const app=initializeApp({projectId,...(credential?{credential}:{})},`api-${Date.now()}`);return {app,auth:getAuth(app),demo};
}
