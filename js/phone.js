export const PHONE_ERROR = 'Phone number must contain exactly 10 digits.';
export function validPhone(value) { return typeof value === 'string' && /^[0-9]{10}$/.test(value); }
export function phoneError(value, required = false) {
  return !required && (value === undefined || value === null || value === '') ? '' : validPhone(value) ? '' : PHONE_ERROR;
}
export function wirePhoneInput(input) {
  input.type = 'tel'; input.inputMode = 'numeric'; input.maxLength = 10; input.pattern = '[0-9]{10}';
  const validate = () => input.setCustomValidity(phoneError(input.value, input.required));
  input.addEventListener('input', validate);
  input.addEventListener('invalid', validate);
  input.addEventListener('beforeinput', event => {
    if (event.data && /[^0-9]/.test(event.data)) { event.preventDefault(); input.setCustomValidity(PHONE_ERROR); input.reportValidity(); }
  });
  validate();
}
