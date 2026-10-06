export let db;
export const functions = null;
export const auth = { currentUser: null };
export function useContext(database, uid) { db = database; auth.currentUser = {uid}; }
