import {matchesStudent} from './clearance.js';
export async function canRead(store,actor,path,data){
  if(actor.role==='admin')return true;const [collection,id,child]=path.split('/'),uid=actor.uid,role=actor.role;
  if(collection==='users')return child==='notifications'?id===uid:id===uid||data.role!=='student';
  if(collection==='students'){if(child==='clearance')return id===uid;if(id===uid)return true;if(role==='mentor'&&data.mentorId===uid)return true;if(['subject_faculty','mentor'].includes(role)){const enrollment=await store.collection('enrollments').where('studentId','==',id).where('teacherId','==',uid).where('active','==',true).get();for(const e of enrollment.docs){const offering=(await store.doc(`offerings/${e.data().offeringId}`).get()).data();if(offering&&offering.teacherId===uid&&matchesStudent(data,offering))return true;}}return false;}
  if(collection==='settings')return role==='student'&&id==='workflow';
  if(collection==='subjects')return true;
  if(collection==='hallTickets'){if(data.studentId===uid)return true;if(role==='office'){const request=(await store.doc(`noDueRequests/${data.requestId}`).get()).data();return data.issuedById===uid||request?.officeId===uid;}return false;}
  if(collection==='offerings'){if(data.teacherId===uid)return true;if(role==='mentor'){const enrolled=await store.collection('enrollments').where('offeringId','==',id).where('mentorId','==',uid).where('active','==',true).limit(1).get();return !enrolled.empty;}if(role==='student'){const enrolled=await store.collection('enrollments').where('studentId','==',uid).where('offeringId','==',id).where('active','==',true).limit(1).get(),s=(await store.doc(`students/${uid}`).get()).data();return !enrolled.empty&&enrolled.docs[0].data().teacherId===data.teacherId&&matchesStudent(s||{},data);}return false;}
  if(['enrollments','marks'].includes(collection)){const s=(await store.doc(`students/${data.studentId}`).get()).data();if(data.studentId===uid||role==='mentor'&&s?.mentorId===uid)return true;const o=(await store.doc(`offerings/${data.offeringId}`).get()).data();return ['subject_faculty','mentor'].includes(role)&&data.teacherId===uid&&o?.teacherId===uid&&matchesStudent(s||{},o);}
  if(collection==='assignments'){const o=(await store.doc(`offerings/${data.offeringId}`).get()).data();return !!o&&canRead(store,actor,`offerings/${data.offeringId}`,o);}
  if(collection==='noDueRequests'){const r=child?(await store.doc(`noDueRequests/${id}`).get()).data():data;return !!r&&(r.studentId===uid||role==='mentor'&&r.mentorId===uid||role==='hod'&&r.hodId===uid||role==='office'&&r.officeId===uid||['subject_faculty','mentor','library','accounts'].includes(role)&&r.approverIds?.includes(uid));}
  return false;
}
export async function scopeQuery(store,actor,path,query){
  if(actor.role==='admin')return query;const [collection,id,child]=path.split('/'),uid=actor.uid,role=actor.role;
  if(child){if(collection==='users'&&child==='notifications'&&id===uid)return query;if(collection==='noDueRequests'&&child==='approvals'&&await canRead(store,actor,`noDueRequests/${id}`,(await store.doc(`noDueRequests/${id}`).get()).data()))return query;throw Object.assign(new Error('Forbidden collection.'),{code:'permission-denied'});}
  if(collection==='noDueRequests')return query.where(role==='student'?'studentId':role==='mentor'?'mentorId':role==='hod'?'hodId':role==='office'?'officeId':'approverIds', ['student','mentor','hod','office'].includes(role)?'==':'array-contains',uid);
  if(collection==='hallTickets'&&['student','office'].includes(role)){if(role==='student')return query.where('studentId','==',uid);const requests=await store.collection('noDueRequests').where('officeId','==',uid).get(),issued=await store.collection('hallTickets').where('issuedById','==',uid).get();return query.where('__name__','in',[...new Set([...requests.docs.map(d=>d.id),...issued.docs.map(d=>d.id)])]);}
  if(collection==='students'){if(role==='mentor')return query.where('mentorId','==',uid);if(['subject_faculty'].includes(role))return query.where('teacherIds','array-contains',uid);if(role==='student')return query.where('__name__','==',uid);}
  if(collection==='offerings'){if(['subject_faculty','mentor'].includes(role))return query.where('teacherId','==',uid);if(role==='student'){const s=(await store.doc(`students/${uid}`).get()).data();return query.where('__name__','in',s?.offeringIds||[]);}}
  if(['enrollments','marks'].includes(collection)){if(role==='student')return query.where('studentId','==',uid);if(['subject_faculty','mentor'].includes(role))return query.where(role==='mentor'&&!query.filters.some(([field,op,value])=>field==='teacherId'&&op==='=='&&value===uid)?'mentorId':'teacherId','==',uid);}
  if(['subjects','assignments','users'].includes(collection))return query;
  throw Object.assign(new Error('Forbidden collection.'),{code:'permission-denied'});
}
