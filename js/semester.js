// Shared engineering-semester contract for UI, imports and server boundaries.
export const SEMESTER_ERROR = 'Semester must be an integer from 1 to 8.';
export const SEMESTERS = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8]);
export function validSemester(value) {
  return ['string', 'number'].includes(typeof value) && String(value).trim() !== ''
    && Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 8;
}
export function assertSemester(value) {
  if (!validSemester(value)) throw Object.assign(new Error(SEMESTER_ERROR), {code: 'invalid-argument'});
  return Number(value);
}
export function optionalSemester(value) {
  return value === undefined || value === '' ? undefined : assertSemester(value);
}
