// Application data comes only from the authenticated Express API.
import {post} from './api.js';
class DateValue{constructor(value){this.date=new Date(value);this.seconds=Math.floor(this.date.getTime()/1000);}toDate(){return this.date;}}
export function revive(value){return value?.__date?new DateValue(value.__date):Array.isArray(value)?value.map(revive):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,revive(v)])):value;}
export function collection(base,...parts){return {path:[base?.path,...parts].filter(Boolean).join('/')};}
export function doc(base,...parts){return {path:[base?.path,...parts].filter(Boolean).join('/'),get id(){return this.path.split('/').at(-1);}};}
export const where=(...filter)=>({filter}),orderBy=(field,direction='asc')=>({order:[field,direction]}),limit=size=>({size}),startAfter=cursor=>({cursor:cursor?.id||cursor});
export const query=(ref,...clauses)=>Object.assign({...ref,filters:[],orders:[]},clauses.reduce((options,c)=>{if(c.filter)options.filters.push(c.filter);if(c.order)options.orders.push(c.order);if(c.size)options.limit=c.size;if(c.cursor)options.cursor=c.cursor;return options;},{filters:[],orders:[]}));
const snapshot=(ref,data,exists=true)=>({id:ref.id,ref,exists:()=>exists,data:()=>revive(data)});
export async function getDoc(ref){const result=await post('/api/data/read',{path:ref.path});return snapshot(ref,result.data,result.exists);}
export async function getDocs(ref){const result=await post('/api/data/query',{path:ref.path,filters:ref.filters||[],orders:ref.orders?.length?ref.orders:[['__name__','asc']],limit:ref.limit||30,cursor:ref.cursor});const docs=result.rows.map(row=>snapshot(doc(ref,row.id),row.data));return {docs,size:result.scanned,empty:!docs.length,cursor:result.cursor,more:result.more};}
export const serverTimestamp=()=>({__type:'timestamp'}),arrayRemove=(...values)=>({__type:'arrayRemove',values});
export function writeBatch(){const operations=[];return {set:(ref,data,options)=>operations.push({type:'set',path:ref.path,data,options}),update:(ref,data)=>operations.push({type:'update',path:ref.path,data}),commit:()=>post('/api/data/write',{operations})};}
export const setDoc=(ref,data,options)=>post('/api/data/write',{operations:[{type:'set',path:ref.path,data,options}]}),updateDoc=(ref,data)=>post('/api/data/write',{operations:[{type:'update',path:ref.path,data}]});
export function onSnapshot(ref,next,error){let stopped=false,busy=false;const refresh=async()=>{if(stopped||busy)return;busy=true;try{const snapshot=ref.filters||ref.orders?await getDocs(ref):await getDoc(ref);if(!stopped)next(snapshot);}catch(e){if(!stopped)error?.(e);}finally{busy=false;}};refresh();const timer=setInterval(refresh,3000);return ()=>{stopped=true;clearInterval(timer);};}
