import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../../tests/package.json',import.meta.url)),cli=require.resolve('firebase-tools/lib/bin/firebase.js');
const child=spawn(process.execPath,[cli,'emulators:exec','--project','demo-mongo-audit','--only','auth','--config','test/firebase-auth.json','node --test --test-concurrency=1 test/migration.test.mjs'],{stdio:'inherit',env:{...process.env,FIREBASE_PROJECT_ID:'demo-mongo-audit',FIREBASE_AUTH_EMULATOR_HOST:'127.0.0.1:9298'}});
child.on('exit',code=>process.exit(code||0));
