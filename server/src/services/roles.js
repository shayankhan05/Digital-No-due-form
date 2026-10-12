export const managementRoles=['admin','super_admin'];
export const isManager=role=>managementRoles.includes(role);
export const isSuperAdmin=role=>role==='super_admin';
