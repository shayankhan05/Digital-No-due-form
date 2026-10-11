import {spawn} from 'node:child_process';
import {createConnection} from 'node:net';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url)),server=fileURLToPath(new URL('../',import.meta.url)),cli=root+'tests/node_modules/firebase-tools/lib/bin/firebase.js';
const env={...process.env,MONGODB_URI:'mongodb://127.0.0.1:27017/digital_no_due_dev?replicaSet=rs0',FIREBASE_PROJECT_ID:'demo-digital-no-due',FIREBASE_AUTH_EMULATOR_HOST:'127.0.0.1:9199',PORT:'3000',FRONTEND_ORIGIN:'http://127.0.0.1:5050,http://localhost:5050'};
const children=[];let stopping=false;
function open(port){return new Promise(resolve=>{const socket=createConnection({port,host:'127.0.0.1'});socket.once('connect',()=>{socket.destroy();resolve(true);});socket.once('error',()=>resolve(false));});}
async function ready(port){for(let i=0;i<180;i++){if(await open(port))return;await new Promise(r=>setTimeout(r,500));}throw new Error('Service failed to start on port '+port);}
function start(args,cwd,ipc=false){const child=spawn(process.execPath,args,{cwd,env,stdio:ipc?['inherit','inherit','inherit','ipc']:'inherit',windowsHide:true});children.push(child);child.once('exit',code=>{if(!stopping){console.error('Local service stopped:',code);shutdown(1);}});return child;}
async function exportAuth(){if(!await open(9199))return;await new Promise(resolve=>{const child=spawn(process.execPath,[cli,'emulators:export','server/auth-emulator-backup','--project','demo-digital-no-due','--force'],{cwd:root,env,stdio:'inherit',windowsHide:true});child.once('exit',resolve);});}
async function shutdown(code=0){if(stopping)return;stopping=true;await exportAuth();for(const child of [...children].reverse()){if(child.connected)child.send('shutdown');else child.kill();}setTimeout(()=>process.exit(code),2500);}
for(const s of ['SIGINT','SIGTERM'])process.on(s,()=>shutdown());
process.on('message',message=>{if(message==='shutdown')shutdown();});
try{for(const p of [9199,5050,3000])if(await open(p))throw new Error(`Port ${p} is already running. Keep that session; stop its owner normally before a fresh npm run local. No process was killed.`);
 if(!await open(27017)){start(['scripts/local-mongo.mjs'],server,true);await ready(27017);}else console.log('Using existing local MongoDB; data retained.');
 const args=[cli,'emulators:start','--project','demo-digital-no-due','--only','auth,hosting','--config','firebase.json'];if(existsSync(server+'auth-emulator-backup/firebase-export-metadata.json'))args.push('--import','server/auth-emulator-backup');
 start(args,root);await ready(9199);await ready(5050);await new Promise((resolve,reject)=>{const seed=spawn(process.execPath,['scripts/seed-local.mjs'],{cwd:server,env,stdio:'inherit',windowsHide:true});seed.once('exit',code=>code===0?resolve():reject(new Error('Local seed/password policy failed.')));});start(['src/server.js'],server,true);await ready(3000);console.log('\nLocal app ready: http://127.0.0.1:5050/login.html\nTerminal 2: npm run seed\nCtrl+C saves Auth and closes only services started here.');
}catch(error){console.error(error.message);if(children.length)await shutdown(1);else process.exit(1);}
