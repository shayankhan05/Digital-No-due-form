import {createHash,randomBytes} from 'node:crypto';
import {FieldValue} from 'firebase-admin/firestore';
import {HttpsError} from 'firebase-functions/v2/https';
const roles=['admin','student','subject_faculty','mentor','hod','office','library','physics_lab','chemistry_lab','accounts'];
const services=['library','physics_lab','chemistry_lab','accounts'];
const text=v=>String(v??'').trim();
const hash=v=>createHash('sha256').update(v).digest('hex');
const stamp=()=>FieldValue.serverTimestamp();
const fail=(message,code='invalid-argument')=>{throw new HttpsError(code,message);};
const email=v=>text(v).toLowerCase();
const canonicalDepartment=v=>['ise','information science & engineering','information science and engineering'].includes(text(v).toLowerCase())?'ISE':text(v);
const snapshotData=s=>s.exists?{...s.data(),uid:s.id}:null;
export function createProvisioner({db,auth,demo=false,sendActivation=async()=>{throw new Error('Mail delivery is not configured.');}}) {
  async function admin(uid) {
    if(!uid) fail('Sign in as an administrator.','unauthenticated');
    const [profile,user]=await Promise.all([db.doc(`users/${uid}`).get(),auth.getUser(uid)]);
    if(profile.data()?.role!=='admin' || user.disabled) fail('Administrator access required.','permission-denied');
  }
  async function policy() {
    const data=(await db.doc('settings/institution').get()).data() || {};
    return {...data,allowedDomains:data.allowedDomains || [],departments:data.departments || (demo?['ISE','Computer Science']:[]),sections:data.sections || ['A','B','C']};
  }
  async function resolve(field,value,roleSet) {
    if(!text(value)) return null;
    const found=await db.collection('users').where(field,'==',field==='email'?email(value):text(value)).limit(2).get();
    if(found.size!==1 || !roleSet.includes(found.docs[0].data().role)) fail(`No unique ${roleSet.join('/')} account for ${field}: ${value}.`);
    return {...found.docs[0].data(),uid:found.docs[0].id};
  }
  async function mentor(row) {
    const results=[];
    if(text(row.mentorId)) {
      if(!/^[A-Za-z0-9_-]{1,128}$/.test(text(row.mentorId))) fail('Invalid mentor ID.');
      const data=snapshotData(await db.doc(`users/${text(row.mentorId)}`).get());
      if(data?.role!=='mentor') fail('Mentor does not exist.');
      results.push(data);
    }
    if(text(row.mentorEmail)) results.push(await resolve('email',row.mentorEmail,['mentor']));
    if(text(row.mentorEmployeeId)) results.push(await resolve('facultyId',row.mentorEmployeeId,['mentor']));
    if(!results.length) fail('Provide mentorEmail, mentorEmployeeId or mentorId.');
    if(results.some(m=>m.uid!==results[0].uid)) fail('Mentor identifiers refer to different accounts.');
    return results[0];
  }
  function normalize(input,p) {
    const row={role:'student',...input};
    row.name=text(row.name);row.collegeEmail=email(row.collegeEmail || row.email);row.department=canonicalDepartment(row.department);
    row.phone=text(row.phone);row.scheme=text(row.scheme);row.facultyId=text(row.facultyId || row.employeeId);
    if(!roles.includes(row.role)) fail('Unsupported role.');
    if(!row.name || row.name.length>150) fail('Name is required (maximum 150 characters).');
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.collegeEmail)) fail('Valid college email is required.');
    const domain=row.collegeEmail.split('@')[1];
    if(!(demo && domain==='demo.test') && (!p.allowedDomains.includes(domain) || domain==='demo.test')) fail('Email domain is not allowed by institution policy.');
    if(!p.departments.includes(row.department)) fail('Choose a configured department.');
    if(row.role==='student') {
      row.usn=text(row.usn).toUpperCase();row.semester=Number(row.semester);row.section=text(row.section).toUpperCase();
      if(!/^[A-Z0-9-]{4,30}$/.test(row.usn)) fail('A valid USN is required.');
      if(!Number.isInteger(row.semester) || row.semester<1 || row.semester>12) fail('Semester must be an integer from 1 to 12.');
      if(!p.sections.includes(row.section)) fail('Choose a configured section.');
      if(!row.scheme) fail('Scheme is required.');
    } else if(!row.facultyId || row.facultyId.length>80) fail('Faculty/employee ID is required.');
    return row;
  }
  async function matchingOfferings(s) {
    // Legacy offerings omit scheme/department or store semester as a string.
    // An explicit department or scheme must still match; never cross sections.
    // The original saveOffering/seed path omitted active. Those offerings are
    // enabled by default, as they are in the seeded enrollments and dashboards.
    // Query semester first: active == true would discard the legacy records.
    const found=await db.collection('offerings').where('semester','in',[Number(s.semester),String(s.semester)]).get();
    const candidates=found.docs.map(d=>({...d.data(),id:d.id})).filter(o=>
      (o.active===undefined || o.active===true) &&
      text(o.section).toUpperCase()===text(s.section).toUpperCase() &&
      (!text(o.department) || canonicalDepartment(o.department)===canonicalDepartment(s.department)) &&
      (!text(o.scheme) || text(o.scheme)===text(s.scheme)));
    // Specific class configuration supersedes an unscoped legacy fallback.
    // This depends on stored class fields, never offering IDs or source names.
    const scoped=candidates.filter(o=>text(o.department) && text(o.scheme));
    const result=scoped.length?scoped:candidates;
    if(result.length>30) fail('At most 30 active offerings per class are supported.');
    return result;
  }
  async function duplicate(field,value,collection,uid) {
    const result=await db.collection(collection).where(field,'==',value).limit(2).get();
    return result.docs.some(d=>d.id!==uid);
  }
  async function validate(input,{uid=null,p,checkAuth=true}={}) {
    p ||= await policy();
    const row=normalize(input,p);
    delete row.existingUid;
    // A repeated student CSV repairs mappings for the same institutional identity.
    // It must never adopt an unrelated Auth account or change an existing profile.
    if(row.role==='student' && !uid) {
      let existing;
      try {existing=await auth.getUserByEmail(row.collegeEmail);} catch(error) {if(error.code!=='auth/user-not-found') throw error;}
      if(existing) {
        const profile=(await db.doc(`students/${existing.uid}`).get()).data();
        const user=(await db.doc(`users/${existing.uid}`).get()).data();
        if(user?.role!=='student' || !profile || profile.usn!==row.usn || canonicalDepartment(profile.department)!==row.department || Number(profile.semester)!==row.semester || text(profile.section).toUpperCase()!==row.section || text(profile.scheme)!==row.scheme) fail('Existing email belongs to a different student identity or class.','already-exists');
        uid=existing.uid;row.existingUid=uid;
      }
    }
    if(await duplicate('email',row.collegeEmail,'users',uid)) fail('Duplicate email.','already-exists');
    if(row.role==='student' && await duplicate('usn',row.usn,'students',uid)) fail('Duplicate USN.','already-exists');
    if(row.role!=='student' && await duplicate('facultyId',row.facultyId,'users',uid)) fail('Duplicate faculty ID.','already-exists');
    if(checkAuth) {
      try {const existing=await auth.getUserByEmail(row.collegeEmail);if(existing.uid!==uid) fail('Email already exists in Authentication.','already-exists');}
      catch(error) {if(error.code!=='auth/user-not-found') throw error;}
    }
    const warnings=[];
    if(row.role==='student') {
      row.mentorId=(await mentor(row)).uid;
      row.offerings=await matchingOfferings(row);
      if(!row.offerings.length) warnings.push('No active offerings match department/scheme/semester/section. Profile will be created; clearance remains unprepared.');
      if(row.offerings.length) await planFor(row,row.offerings);
    }
    return {row,warnings};
  }
  async function previewAccounts(inputs) {
    if(!Array.isArray(inputs) || inputs.length<1 || inputs.length>100) fail('Preview 1–100 rows per chunk.');
    const p=await policy(),seen={collegeEmail:new Set(),usn:new Set(),facultyId:new Set()},result=[];
    for(let index=0;index<inputs.length;index++) {
      const input=inputs[index];
      try {
        const {row,warnings}=await validate(input,{p});
        for(const field of [row.role==='student'?'usn':'facultyId','collegeEmail']) {
          if(seen[field].has(row[field])) fail(`Duplicate ${field} in uploaded rows.`,'already-exists');
          seen[field].add(row[field]);
        }
        const {offerings,...safe}=row;
        result.push({index,status:warnings.length?'WARNING':'VALID',warnings,row:safe,subjectsMapped:offerings?.length || 0});
      } catch(error) {result.push({index,status:'ERROR',row:input,error:error.message,duplicate:error.code==='already-exists'});}
    }
    return {rows:result,total:result.length,valid:result.filter(r=>r.status==='VALID').length,warnings:result.filter(r=>r.status==='WARNING').length,errors:result.filter(r=>r.status==='ERROR').length,duplicates:result.filter(r=>r.duplicate).length};
  }
  async function planFor(student,offerings) {
    const config=(await db.doc('settings/workflow').get()).data();
    if(!config) fail('Configure workflow assignments before enrolling students.');
    const items={};
    for(const type of services) items[type]={approverType:type,approverId:config[type],label:type.replaceAll('_',' '),subjectCode:null,offeringId:null};
    for(const o of offerings) items[`subject_${o.id}`]={approverType:'subject_faculty',approverId:o.teacherId,label:o.subjectName,subjectCode:o.subjectCode,offeringId:o.id};
    const requirements=[...services.map(role=>[config[role],role]),[student.mentorId,'mentor'],[config.hodId,'hod'],[config.officeId,'office'],...offerings.map(o=>[o.teacherId,'teaching'])];
    for(const [id,role] of requirements) {
      if(!id) fail(`Missing ${role} workflow assignment.`);
      const user=(await db.doc(`users/${id}`).get()).data();
      if(!user || (role==='teaching'?!['subject_faculty','mentor'].includes(user.role):user.role!==role)) fail(`Invalid ${role} workflow assignment.`);
    }
    return {valid:true,items,initialStates:Object.fromEntries(Object.keys(items).map(k=>[k,'pending'])),approverIds:[...new Set(Object.values(items).map(i=>i.approverId))],mentorId:student.mentorId,hodId:config.hodId,officeId:config.officeId,semester:student.semester,section:student.section,updatedAt:stamp()};
  }
  async function mapStudent(uid,student,offerings) {
    offerings ||= await matchingOfferings(student);
    if(!offerings.length) {await db.doc(`students/${uid}/clearance/plan`).set({valid:false},{merge:true});return 0;}
    const plan=await planFor(student,offerings),batch=db.batch();
    // Include pre-existing enrollments when preparing a plan; never silently omit them.
    const enrolled=await db.collection('enrollments').where('studentId','==',uid).get();
    const selected=new Set(offerings.map(o=>o.id));
    const selectedSpecificity=Math.max(...offerings.map(o=>Number(Boolean(text(o.department)))+Number(Boolean(text(o.scheme)))));
    for(const o of offerings) {
      const existing=enrolled.docs.find(d=>d.data().offeringId===o.id);
      batch.set(existing?.ref || db.doc(`enrollments/${uid}__${o.id}`),{studentId:uid,offeringId:o.id,teacherId:o.teacherId,mentorId:student.mentorId,semester:student.semester,section:student.section,department:student.department,scheme:student.scheme,subjectId:o.subjectId,subjectCode:o.subjectCode,active:true},{merge:true});
    }
    const merged=new Map(offerings.map(o=>[o.id,o]));
    for(const enrollment of enrolled.docs) {
      if(enrollment.data().active!==true) continue;
      const o=(await db.doc(`offerings/${enrollment.data().offeringId}`).get()).data();
      if(!o || Number(o.semester)!==Number(student.semester) || text(o.section).toUpperCase()!==text(student.section).toUpperCase()) fail('Existing enrollment needs explicit administrative review.');
      const specificity=Number(Boolean(text(o.department)))+Number(Boolean(text(o.scheme)));
      if(selectedSpecificity===2 && !selected.has(enrollment.data().offeringId) && specificity<selectedSpecificity &&
        (!text(o.department) || canonicalDepartment(o.department)===canonicalDepartment(student.department)) &&
        (!text(o.scheme) || text(o.scheme)===text(student.scheme))) {
        // Retain the original record and all marks; only remove the fallback
        // from the current roster/plan when more specific offerings exist.
        batch.set(enrollment.ref,{active:false},{merge:true});continue;
      }
      merged.set(enrollment.data().offeringId,{...o,id:enrollment.data().offeringId});
    }
    if(merged.size>30) fail('At most 30 active subjects per student are supported.');
    batch.set(db.doc(`students/${uid}`),{offeringIds:[...merged.keys()],teacherIds:[...new Set([...merged.values()].map(o=>o.teacherId))]},{merge:true});
    batch.set(db.doc(`students/${uid}/clearance/plan`),merged.size===offerings.length?plan:await planFor(student,[...merged.values()]));
    await batch.commit();return offerings.length;
  }
  async function activation(uid,p) {
    const user=await auth.getUser(uid),ref=db.doc(`provisioningJobs/${uid}`);
    if(demo) {await ref.set({activation:'emulator-password',updatedAt:stamp()},{merge:true});return {activation:'emulator-password',demoPassword:'DemoPassword123!'};}
    try {
      const link=await auth.generatePasswordResetLink(user.email);
      await sendActivation(user.email,link,p);
      await ref.set({activation:'sent',updatedAt:stamp()},{merge:true});return {activation:'sent'};
    } catch(error) {
      await ref.set({activation:'delivery-failed',updatedAt:stamp()},{merge:true});
      return {activation:'delivery-failed',warning:'Account created; activation delivery failed. Configure mail delivery and retry activation, or use Forgot password to send Firebase’s standard reset email.'};
    }
  }
  async function provision(caller,input,requestId) {
    if(!/^[A-Za-z0-9_-]{8,100}$/.test(text(requestId))) fail('A stable requestId is required for retry safety.');
    const uid=`p_${hash(`${caller}:${requestId}`).slice(0,48)}`,jobRef=db.doc(`provisioningJobs/${uid}`),old=(await jobRef.get()).data();
    const p=await policy();
    const {row,warnings}=await validate(input,{uid:old?uid:null,p});
    if(row.existingUid && row.existingUid!==uid) {
      const student=(await db.doc(`students/${row.existingUid}`).get()).data();
      const subjectsMapped=await mapStudent(row.existingUid,student);
      return {uid:row.existingUid,email:row.collegeEmail,accountCreated:false,academicMappingCreated:subjectsMapped>0,mentorMapped:Boolean(student.mentorId),subjectsMapped,warnings};
    }
    const digest=hash(JSON.stringify({email:row.collegeEmail,role:row.role,usn:row.usn || '',facultyId:row.facultyId,name:row.name,department:row.department,semester:row.semester || '',section:row.section || '',scheme:row.scheme,mentorId:row.mentorId || '',phone:row.phone}));
    if(old && old.digest!==digest) fail('Retry ID already belongs to another row.','already-exists');
    if(old?.state==='complete') {
      const subjectsMapped=row.role==='student'?await mapStudent(uid,(await db.doc(`students/${uid}`).get()).data()):0;
      const result={...old.result,subjectsMapped,academicMappingCreated:row.role==='student' && subjectsMapped>0};
      await jobRef.set({result,updatedAt:stamp()},{merge:true});
      return {...result,...(demo?{demoPassword:'DemoPassword123!'}:{})};
    }
    const keys=[['email',row.collegeEmail],[row.role==='student'?'usn':'facultyId',row.role==='student'?row.usn:row.facultyId]].map(([kind,value])=>db.doc(`uniqueIdentities/${kind}_${hash(value)}`));
    await db.runTransaction(async t=>{
      const snapshots=await Promise.all(keys.map(ref=>t.get(ref)));
      if(snapshots.some(s=>s.exists && s.data().uid!==uid)) fail('Duplicate institutional identity.','already-exists');
      for(const ref of keys) t.set(ref,{uid,createdAt:stamp()},{merge:true});
      t.set(jobRef,{caller,digest,state:'reserved',email:row.collegeEmail,updatedAt:stamp()},{merge:true});
    });
    let user;
    try {user=await auth.getUser(uid);} catch(error) {if(error.code!=='auth/user-not-found') throw error;}
    if(user && user.email!==row.collegeEmail) fail('Provisioned identity conflict.','already-exists');
    if(!user) {
      try {user=await auth.createUser({uid,email:row.collegeEmail,displayName:row.name,password:demo?'DemoPassword123!':randomBytes(48).toString('base64url'),disabled:false,emailVerified:false});}
      catch(error) {
        // Concurrent retries of the same operation may have just created this UID.
        if(['auth/uid-already-exists','auth/email-already-exists'].includes(error.code)) {
          try {const same=await auth.getUser(uid);if(same.email===row.collegeEmail) user=same;}catch(lookup){if(lookup.code!=='auth/user-not-found')throw lookup;}
        }
        if(user) { /* Continue the same idempotent row; keep its identity reservations. */ }
        else {
        // A competing duplicate email must not permanently reserve an unrelated USN.
        await db.runTransaction(async t=>{const snapshots=await Promise.all(keys.map(ref=>t.get(ref)));snapshots.forEach((s,i)=>{if(s.data()?.uid===uid)t.delete(keys[i]);});});
        if(error.code==='auth/email-already-exists') fail('Email already exists in Authentication.','already-exists');
        throw error;
        }
      }
    }
    await jobRef.set({state:'auth-created',updatedAt:stamp()},{merge:true});
    const profile={name:row.name,email:row.collegeEmail,phone:row.phone,department:row.department,facultyId:row.facultyId,role:row.role,scheme:row.scheme,updatedAt:stamp()};
    const batch=db.batch();batch.set(db.doc(`users/${uid}`),profile,{merge:true});
    if(row.role==='student') batch.set(db.doc(`students/${uid}`),{uid,...profile,usn:row.usn,semester:row.semester,section:row.section,mentorId:row.mentorId},{merge:true});
    await batch.commit();
    const subjectsMapped=row.role==='student'?await mapStudent(uid,{...profile,...row}):0;
    const delivery=await activation(uid,p);
    const result={uid,name:row.name,usn:row.usn || '',email:row.collegeEmail,section:row.section || '',role:row.role,accountCreated:true,academicMappingCreated:row.role==='student' && subjectsMapped>0,mentorMapped:row.role==='student',subjectsMapped,warnings,...delivery};
    const {demoPassword,...storedResult}=result;
    await jobRef.set({state:'complete',result:storedResult,updatedAt:stamp()},{merge:true});
    return result;
  }
  async function validateOffering(input) {
    const p=await policy(),row={...input};
    row.department=canonicalDepartment(row.department);row.scheme=text(row.scheme);row.semester=Number(row.semester);row.section=text(row.section).toUpperCase();row.subjectCode=text(row.subjectCode);row.subjectName=text(row.subjectName);row.teacherEmail=email(row.teacherEmail);
    if(!p.departments.includes(row.department) || !p.sections.includes(row.section) || !row.scheme || !Number.isInteger(row.semester) || row.semester<1 || row.semester>12) fail('Valid department, scheme, semester and section are required.');
    if(!row.subjectCode || !row.subjectName || row.subjectCode.length>40 || row.subjectName.length>200) fail('Confirmed subject code and name are required; do not guess source fields.');
    const teacher=await resolve('email',row.teacherEmail,['subject_faculty','mentor']);
    if(!teacher) fail('An existing teacher email is required.');row.teacherId=teacher.uid;
    row.components=typeof row.components==='string'?JSON.parse(row.components || '[]'):row.components;
    if(!Array.isArray(row.components) || !row.components.length || row.components.length>10 || new Set(row.components.map(c=>c.id)).size!==row.components.length || row.components.some(c=>!c || !/^[A-Za-z0-9_-]{1,50}$/.test(c.id) || !text(c.label) || !Number.isFinite(c.max) || c.max<=0 || c.max>10000)) fail('Provide 1–10 unique assessment components with IDs, labels and positive maxima.');
    row.active=row.active!==false && text(row.active).toLowerCase()!=='false';
    row.credits=text(row.credits)===''?null:Number(row.credits);
    if(row.credits!==null && (!Number.isFinite(row.credits) || row.credits<0 || row.credits>30)) fail('Credits must be numeric when supplied.');
    row.subjectId=`subject_${hash([row.department,row.scheme,row.subjectCode].join('|')).slice(0,32)}`;
    row.id=`class_${hash([row.department,row.scheme,row.semester,row.section,row.subjectCode].join('|')).slice(0,32)}`;
    const previous=(await db.doc(`offerings/${row.id}`).get()).data();
    if(previous && (previous.teacherId!==row.teacherId || JSON.stringify(previous.components)!==JSON.stringify(row.components))) fail('Existing offering teacher/assessments differ. Use advanced editing with explicit plan refresh; bulk import will not rewrite existing marks mappings.');
    return row;
  }
  async function previewOfferings(inputs) {
    if(!Array.isArray(inputs) || inputs.length<1 || inputs.length>100) fail('Preview 1–100 offering rows per chunk.');
    const rows=[],seen=new Set();
    for(let index=0;index<inputs.length;index++) try {
      const row=await validateOffering(inputs[index]);if(seen.has(row.id)) fail('Duplicate offering in uploaded rows.','already-exists');seen.add(row.id);
      rows.push({index,status:'VALID',row});
    } catch(error) {rows.push({index,status:'ERROR',row:inputs[index],error:error.message});}
    return {rows,total:rows.length,valid:rows.filter(r=>r.status==='VALID').length,errors:rows.filter(r=>r.status==='ERROR').length};
  }
  async function importOffering(input) {
    const row=await validateOffering(input),batch=db.batch();
    batch.set(db.doc(`subjects/${row.subjectId}`),{name:row.subjectName,code:row.subjectCode,department:row.department,scheme:row.scheme,credits:row.credits,updatedAt:stamp()},{merge:true});
    batch.set(db.doc(`offerings/${row.id}`),{subjectId:row.subjectId,subjectName:row.subjectName,subjectCode:row.subjectCode,department:row.department,scheme:row.scheme,semester:row.semester,section:row.section,teacherId:row.teacherId,active:row.active,credits:row.credits,components:row.components,componentIds:row.components.map(c=>c.id),updatedAt:stamp()},{merge:true});
    await batch.commit();return {id:row.id,subjectCode:row.subjectCode,accountCreated:false,nextCursor:null};
  }
  async function mapClass({department,scheme,semester,section,cursor}) {
    const p=await policy(),d=canonicalDepartment(department),s=text(section).toUpperCase();
    if(!p.departments.includes(d) || !p.sections.includes(s) || !Number.isInteger(Number(semester)) || !text(scheme)) fail('Valid class filters required.');
    let q=db.collection('students').where('department','==',d).where('scheme','==',text(scheme)).where('semester','==',Number(semester)).where('section','==',s).orderBy('__name__').limit(20);
    if(cursor) {if(!/^[A-Za-z0-9_-]{1,128}$/.test(cursor)) fail('Invalid cursor.');q=q.startAfter(db.doc(`students/${cursor}`));}
    const students=await q.get(),results=[];
    for(const doc of students.docs) try {results.push({uid:doc.id,subjectsMapped:await mapStudent(doc.id,doc.data())});} catch(error){results.push({uid:doc.id,error:error.message});}
    return {results,nextCursor:students.size===20?students.docs.at(-1).id:null};
  }
  async function savePolicy(input) {
    const allowedDomains=[...new Set((input.allowedDomains || []).map(d=>text(d).toLowerCase().replace(/^@/,'')))];
    if(!allowedDomains.length || allowedDomains.length>20 || allowedDomains.some(d=>!/^([a-z0-9-]+\.)+[a-z]{2,}$/.test(d) || (!demo && d==='demo.test'))) fail('Configure valid college domains; production cannot allow demo.test.');
    const departments=[...new Set((input.departments || []).map(canonicalDepartment))],sections=[...new Set((input.sections || []).map(s=>text(s).toUpperCase()))];
    if(!departments.length || departments.length>50 || departments.some(d=>!d || d.length>100) || !sections.length || sections.length>50 || sections.some(s=>! /^[A-Z0-9-]{1,10}$/.test(s))) fail('Configure departments and sections.');
    const smtpPort=Number(input.smtpPort || 465);if(![465,587].includes(smtpPort)) fail('SMTP port must be 465 or 587.');
    const data={allowedDomains,departments,sections,smtpHost:text(input.smtpHost),smtpPort,smtpUser:text(input.smtpUser),mailFrom:text(input.mailFrom),updatedAt:stamp()};
    if(data.smtpHost && !/^[a-zA-Z0-9.-]+$/.test(data.smtpHost)) fail('Invalid SMTP host.');
    await db.doc('settings/institution').set(data,{merge:true});return {saved:true};
  }
  async function dispatch(uid,data) {
    await admin(uid);
    if(!data || typeof data!=='object') fail('Operation is required.');
    switch(data.action) {
      case 'policy': {const {updatedAt,...p}=await policy();return {...p,demo};}
      case 'savePolicy':return savePolicy(data.policy || {});
      case 'previewAccounts':return previewAccounts(data.rows);
      case 'provision':return provision(uid,data.row,data.requestId);
      case 'previewOfferings':return previewOfferings(data.rows);
      case 'importOffering':return importOffering(data.row);
      case 'mapClass':return mapClass(data);
      case 'retryActivation': {
        if(!/^[A-Za-z0-9_-]{1,128}$/.test(data.uid || '') || !(await db.doc(`users/${data.uid}`).get()).exists) fail('Existing account required.');
        return activation(data.uid,await policy());
      }
      case 'directory': {
        if(!['email','facultyId','usn'].includes(data.field)) fail('Search by email, employee ID or USN.');
        const collection=data.field==='usn'?'students':'users';
        const value=data.field==='email'?email(data.value):data.field==='usn'?text(data.value).toUpperCase():text(data.value);
        const result=await db.collection(collection).where(data.field,'==',value).limit(20).get();return {rows:result.docs.map(d=>({...d.data(),updatedAt:null,uid:d.id}))};
      }
      default:fail('Unknown operation.');
    }
  }
  return {dispatch};
}
