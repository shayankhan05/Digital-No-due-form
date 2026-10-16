import {isInactive} from './account-removal.js';
import {accountAuthority} from './account-authority.js';
const invalid=()=>Object.assign(new Error('Email / USN / Employee ID or password is incorrect.'),{code:'unauthenticated'});
export async function firebasePasswordCall(auth,demo,key,action,body){
  const host=demo?`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com`:'https://identitytoolkit.googleapis.com';
  if(!demo&&!key)throw new Error('Firebase Web API key is required for credential verification.');
  const response=await fetch(`${host}/v1/accounts:${action}?key=${encodeURIComponent(key||'fake-api-key')}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const result=await response.json();return {ok:response.ok,result};
}
export async function loginIdentity(database,identifier){
  const value=String(identifier||'').trim();if(!value||value.length>200)throw invalid();
  const collation={locale:'en',strength:2};let candidates;
  if(value.includes('@'))candidates=await database.collection('users').find({email:value}).collation(collation).limit(3).toArray();
  else{const [students,staff]=await Promise.all([database.collection('students').find({usn:value}).collation(collation).limit(3).toArray(),database.collection('users').find({facultyId:value,role:{$ne:'student'}}).collation(collation).limit(3).toArray()]);const profiles=await Promise.all(students.map(s=>database.collection('users').findOne({_id:s._id,role:'student'})));candidates=[...profiles.filter(Boolean),...staff];}
  const unique=new Map(candidates.map(p=>[p._id,p]));if(unique.size!==1)throw invalid();const profile=[...unique.values()][0];if(isInactive(profile))throw invalid();return accountAuthority(database,profile,profile._id);
}
export function authenticationRoutes(app,{database,store,auth,demo,key}){
  const attempts=new Map();
  app.post('/api/auth/login',async(req,res)=>{
    const now=Date.now(),address=req.ip,old=attempts.get(address),budget=old&&old.until>now?old:{count:0,until:now+600000};budget.count++;attempts.set(address,budget);if(attempts.size>10000)for(const [ip,v]of attempts)if(v.until<now)attempts.delete(ip);
    if(budget.count>100)return res.status(429).json({error:{code:'too-many-requests',message:'Too many attempts. Wait a bit and try again.'}});
    try{if(typeof req.body.password!=='string'||!req.body.password||req.body.password.length>4096)throw invalid();const p=await loginIdentity(database,req.body.identifier),signed=await firebasePasswordCall(auth,demo,key,'signInWithPassword',{email:p.email,password:req.body.password,returnSecureToken:true});if(!signed.ok||signed.result.localId!==p._id)throw invalid();res.json({email:p.email});}catch{res.status(401).json({error:{code:'unauthenticated',message:invalid().message}});}
  });
}
export async function completePasswordChange({store,auth,actor,demo,key,token}){
  if(!actor.mustChangePassword)return {changed:true};
  const lookup=await firebasePasswordCall(auth,demo,key,'lookup',{idToken:token}),user=lookup.result.users?.[0],issued=actor.temporaryPasswordIssuedAt;
  // Local Auth emulator and application clocks can differ by 1 ms on Windows.
  // Keep the production comparison exact; an unchanged local password is not a change.
  if(!lookup.ok||user?.localId!==actor.uid||!user.passwordUpdatedAt||Number(user.passwordUpdatedAt)<=new Date(issued).getTime()+(demo?5:0))throw Object.assign(new Error('Change your temporary password through Firebase before continuing.'),{code:'permission-denied'});
  await store.doc(`users/${actor.uid}`).set({mustChangePassword:false,passwordChangedAt:new Date()},{merge:true});return {changed:true};
}
