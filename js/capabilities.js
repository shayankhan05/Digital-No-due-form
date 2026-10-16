// Leadership promotion preserves teaching and mentor capabilities on the same UID.
export const isFaculty=profile=>['subject_faculty','mentor'].includes(profile?.role)||profile?.role==='hod'&&['subject_faculty','mentor'].includes(profile.leadershipPreviousRole);
export const isMentor=profile=>profile?.role==='mentor'||isFaculty(profile)&&profile.isMentor===true||profile?.role==='hod'&&profile.leadershipPreviousRole==='mentor';
export const hasRole=(profile,roles)=>roles.includes(profile.role)||roles.includes('mentor')&&isMentor(profile)||roles.includes('subject_faculty')&&isFaculty(profile);
