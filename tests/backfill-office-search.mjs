// Add only derived search-index documents to the current loopback demo.
import {localAdmin} from './bulk-fixture.mjs';
import {syncOfficeSearchIndex} from '../functions/office-search.js';
const server=localAdmin('demo-digital-no-due',8180,9199);
try{let cursor=null,count=0;do{let q=server.db.collection('students').orderBy('__name__').limit(50);if(cursor)q=q.startAfter(cursor);const page=await q.get();for(const student of page.docs){await syncOfficeSearchIndex(server.db,student.id);count++;}cursor=page.size===50?page.docs.at(-1):null;}while(cursor);console.log(JSON.stringify({indexed:count,studentDocumentsModified:0}));}finally{await server.app.delete();}
