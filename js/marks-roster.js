export const compareUSN=(a,b)=>String(a??'').trim().localeCompare(String(b??'').trim(),'en',{numeric:true,sensitivity:'base'});
export const rosterMatches=(student,term)=>[student.usn,student.name].some(value=>String(value??'').toLowerCase().includes(String(term??'').trim().toLowerCase()));
