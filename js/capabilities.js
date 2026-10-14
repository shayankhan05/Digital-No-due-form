// Legacy mentor users and faculty with an explicit mentor capability share one UID.
export const isMentor=profile=>profile?.role==='mentor'||profile?.role==='subject_faculty'&&profile.isMentor===true;
export const hasRole=(profile,roles)=>roles.includes(profile.role)||roles.includes('mentor')&&isMentor(profile);
