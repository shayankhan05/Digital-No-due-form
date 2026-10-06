// Read-only audit; no Auth/Firestore mutations.
import {localAdmin} from './bulk-fixture.mjs';
import {auditProfiles} from './institutional-profile-tools.mjs';
import {writeFile} from 'node:fs/promises';
const server=localAdmin('demo-digital-no-due',8180,9199);
try {
 const audit=await auditProfiles(server);
 const target=Array.from({length:15},(_,i)=>{const usn='1AY24IS'+(155+i),email='ise-demo-'+usn.toLowerCase()+'@demo.test';return audit.rows.find(r=>r.email===email)||{email,usn,status:'Auth and institutional identity not found'};});
 const report={...audit,target};
 await writeFile(new URL('institutional-profile-audit-results.json',import.meta.url),JSON.stringify(report,null,2));
 console.log(JSON.stringify({authUsers:audit.authUsers,firestoreUsers:audit.firestoreUsers,students:audit.students,demoIssues:audit.demoIssues.length,excludedFixtures:audit.issues.filter(r=>r.scope!=='demo').length,target:target.map(r=>({uid:r.uid,email:r.email,name:r.student?.name,section:r.student?.section,issues:r.issues,status:r.status}))},null,2));
}finally{await server.app.delete();}
