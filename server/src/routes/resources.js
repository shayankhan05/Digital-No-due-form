import {Router} from 'express';
import {canRead,scopeQuery} from '../services/authorization.js';
import {saveMark,serialize,validPath} from './data.js';
const resources={students:'students',teachers:'users',offerings:'offerings',enrollments:'enrollments',marks:'marks',assignments:'assignments',requests:'noDueRequests',notifications:null,'hall-tickets':'hallTickets'};
export function resourceRoutes(store){const router=Router();
  for(const [resource,collection]of Object.entries(resources)){
    router.get(`/${resource}`,async(req,res)=>{const path=collection||`users/${req.actor.uid}/notifications`;let q=store.collection(path);if(resource==='teachers')q=q.where('role','in',['subject_faculty','mentor']);for(const key of ['studentId','offeringId','teacherId','mentorId','status','section','semester'])if(req.query[key]!==undefined){if(typeof req.query[key]!=='string'||req.query[key].length>128)throw new Error('Invalid filter.');q=q.where(key,'==',key==='semester'?Number(req.query[key]):req.query[key]);}q=await scopeQuery(store,req.actor,path,q);if(req.query.cursor)q=q.startAfter(String(req.query.cursor));const size=Math.min(100,Math.max(1,Number(req.query.limit)||30)),page=await q.orderBy('__name__').limit(size).get(),rows=[];for(const doc of page.docs)if(await canRead(store,req.actor,doc.ref.path,doc.data()))rows.push({id:doc.id,...serialize(doc.data())});res.json({rows,nextCursor:page.size===size?page.docs.at(-1).id:null});});
    if(collection)router.get(`/${resource}/:id`,async(req,res)=>{const path=validPath(`${collection}/${req.params.id}`),doc=await store.doc(path).get();if(!doc.exists)return res.status(404).json({error:{code:'not-found',message:'Record not found.'}});if(!await canRead(store,req.actor,path,doc.data()))return res.status(403).json({error:{code:'permission-denied',message:'Not your record.'}});res.json({id:doc.id,...serialize(doc.data())});});
  }
  router.get('/requests/:id/approvals',async(req,res)=>{const path=validPath(`noDueRequests/${req.params.id}/approvals`),query=await scopeQuery(store,req.actor,path,store.collection(path));res.json({rows:(await query.limit(50).get()).docs.map(d=>({id:d.id,...serialize(d.data())}))});});
  router.put('/marks/:id',async(req,res)=>{validPath(`marks/${req.params.id}`);await saveMark(store,req.actor,req.params.id,req.body);res.json({saved:true});});
  return router;
}
