// Shared lifecycle vocabulary; terminal identities remain reserved for explicit restoration.
export const INACTIVE_STATES = ['inactive','deactivated','deleted','deactivating','deleting','exited','exiting'];
export const isInactive = profile => INACTIVE_STATES.includes(profile?.accountStatus) || profile?.authDisabled === true;
export function accountStateError(profile) {
 if (['exited','exiting'].includes(profile?.accountStatus)) return {code:'account/exited',message:'Your account is no longer active in this institution.'};
 if (isInactive(profile)) return {code:'account/inactive',message:profile?.scope==='institution'?'Your account has been deactivated. Please contact the institution administrator.':'Your account has been deactivated. Please contact your department administrator.'};
 return null;
}
