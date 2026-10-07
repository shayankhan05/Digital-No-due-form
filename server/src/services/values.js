export const FieldValue={serverTimestamp:()=>new Date(),arrayRemove:(...values)=>({__operation:'arrayRemove',values})};
export class HttpsError extends Error{constructor(code,message){super(message);this.code=code;}}
