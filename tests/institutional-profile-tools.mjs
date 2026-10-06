import {readFile,readdir} from 'node:fs/promises';
import {parseCSV} from '../js/csv.js';
export const studentHeaders=['name','usn','collegeEmail','phone','department','semester','section','scheme','mentorEmail'];
export async function auditProfiles(server) {
  const auth=[];let token;do{const result=await server.auth.listUsers(1000,token);auth.push(...result.users);token=result.pageToken;}while(token);
  const users=new Map((await server.db.collection('users').get()).docs.map(d=>[d.id,d.data()]));
  const students=new Map((await server.db.collection('students').get()).docs.map(d=>[d.id,d.data()]));
  const offerings=new Map((await server.db.collection('offerings').get()).docs.map(d=>[d.id,d.data()]));
  const roles=['admin','student','subject_faculty','mentor','hod','office','library','accounts','physics_lab','chemistry_lab'];
  const rows=auth.map(account=>{
    const user=users.get(account.uid),student=students.get(account.uid),issues=[];
    if(!user)issues.push('users profile missing');else {
      if(!roles.includes(user.role))issues.push('role missing/invalid');
      for(const k of ['name','email','department'])if(!user[k])issues.push(`users ${k} missing`);
      if(user.email && user.email.toLowerCase()!==account.email?.toLowerCase())issues.push('Auth/profile email mismatch');
    }
    const isStudent=user?.role==='student' || !!student || /^ise-demo-1ay24is\d+@demo\.test$/i.test(account.email || '');
    const legacyUnscoped=student?.offeringIds?.length && student.offeringIds.every(id=>offerings.has(id)&& !offerings.get(id).scheme);
    if(isStudent){if(!student)issues.push('student profile missing');else {
      for(const k of ['name','usn','department','semester','section','mentorId'])if(student[k]===undefined || student[k]===null || student[k]==='')issues.push(`students ${k} missing`);
      if(!student.scheme && !legacyUnscoped)issues.push('students scheme missing');
      if(student.email && student.email.toLowerCase()!==account.email?.toLowerCase())issues.push('Auth/student email mismatch');
    }}
    return {uid:account.uid,email:account.email,name:account.displayName,user,student,issues,
      scope:account.email?.endsWith('@demo.test')?'demo':'non-demo test fixture',legacyUnscoped:!!legacyUnscoped};
  });
  return {authUsers:auth.length,firestoreUsers:users.size,students:students.size,rows,issues:rows.filter(r=>r.issues.length),
    demoIssues:rows.filter(r=>r.scope==='demo'&&r.issues.length),
    profilesWithoutAuth:[...users].filter(([uid])=>!auth.some(a=>a.uid===uid)).map(([uid,u])=>({uid,email:u.email,role:u.role}))};
}
export async function repairSources() {
  const sources=new Map(),directory=new URL('../templates/',import.meta.url);
  const files=(await readdir(directory)).filter(f=>f.endsWith('.csv'));
  for(const file of files){const contents=await readFile(new URL(file,directory),'utf8');
    let rows;try{rows=parseCSV(contents,studentHeaders);}catch{continue;}
    for(const row of rows){const key=row.collegeEmail.toLowerCase(),previous=sources.get(key);
      if(previous && JSON.stringify(previous.row)!==JSON.stringify({...row,role:'student'}))throw new Error(`Conflicting CSV repair sources for ${key}`);
      sources.set(key,{row:{...row,role:'student'},source:`templates/${file}`});
    }
  }
  // This staff identity is explicitly defined by the existing seed-bulk helper.
  sources.set('ise-ab-faculty@demo.test',{source:'tests/seed-bulk.mjs (existing demo staff definition)',row:{name:'Demo A/B Faculty',collegeEmail:'ise-ab-faculty@demo.test',facultyId:'ISE-DEMO-AB',department:'ISE',role:'subject_faculty'}});
  // Recover generated browser-fixture identities only with a verified report
  // and its original clone context. Never infer a real student's section.
  try {
    const report=JSON.parse(await readFile(new URL('runtime-import-browser-results.json',import.meta.url),'utf8'));
    if(report.passed && report.project==='demo-digital-no-due' && report.before?.student)for(const match of (report.imports?.[0] || '').matchAll(/^Synthetic browser import student · (RUNTIME\d+) · (runtime-import-\d+@demo\.test) · /gm)){
      const s=report.before.student;
      sources.set(match[2],{source:'runtime-import-browser.mjs generator and successful saved report',row:{name:'Synthetic browser import student',usn:match[1],collegeEmail:match[2],department:s.department,semester:s.semester,section:s.section,scheme:s.scheme,mentorId:s.mentorId,role:'student'}});
    }
  }catch(error){if(error.code!=='ENOENT')throw error;}
  return sources;
}
export async function reconcileDemoProfiles(server,api) {
  const audit=await auditProfiles(server),sources=await repairSources(),results=[],unresolved=[];
  for(const issue of audit.demoIssues){const source=sources.get(issue.email?.toLowerCase());
    if(!source){unresolved.push(issue);continue;}
    const result=await api('repairDemoProfile',{expectedUid:issue.uid,row:source.row});results.push({...result,source:source.source});
  }
  return {before:audit,results,unresolved,after:await auditProfiles(server)};
}
