// Each row retains its existing provisioning transaction and stable request ID.
// Bound concurrent network work and persist every outcome before taking another row.
export async function runImportRows({start,end,previous=[],process,checkpoint}){
 let cursor=start;const results=[];
 const workers=Array.from({length:Math.min(3,end-start)},async()=>{
  while(cursor<end){const index=cursor++,saved=previous.find(r=>r.index===index&&!r.error);
   if(saved){results.push(saved);continue;}
   const outcome=await process(index);await checkpoint(outcome);results.push(outcome);
  }
 });
 const settled=await Promise.allSettled(workers),failed=settled.find(r=>r.status==='rejected');
 // Drain in-flight rows before releasing the job lease; late workers cannot race a retry.
 if(failed)throw failed.reason;
 return results.sort((a,b)=>a.index-b.index);
}
