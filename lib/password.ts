export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 64;

export type PasswordRule = { id: string; label: string; ok: boolean };

/** The rules a new password must meet. Used for the live checklist and the final check. */
export function passwordRules(pw: string): PasswordRule[] {
  return [
    { id: "length", label: `${PASSWORD_MIN}-${PASSWORD_MAX} characters`, ok: pw.length >= PASSWORD_MIN && pw.length <= PASSWORD_MAX },
    { id: "upper", label: "An uppercase letter (A-Z)", ok: /[A-Z]/.test(pw) },
    { id: "number", label: "A number (0-9)", ok: /[0-9]/.test(pw) },
    { id: "special", label: "A special character (e.g. ! @ # $ %)", ok: /[^A-Za-z0-9\s]/.test(pw) },
    { id: "space", label: "No spaces", ok: pw.length > 0 && !/\s/.test(pw) },
  ];
}

export function passwordProblems(pw: string): string[] {
  return passwordRules(pw).filter((r) => !r.ok).map((r) => r.label);
}

export function isStrongPassword(pw: string): boolean {
  return passwordProblems(pw).length === 0;
}
