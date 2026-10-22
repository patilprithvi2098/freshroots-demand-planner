// Sign-in is by username and password. Supabase Auth needs an email, so each username maps to an
// internal address on a reserved domain that can never receive mail.
export const USERNAME_DOMAIN = "users.freshroots.invalid";
export const USERNAME_PATTERN = /^[a-z0-9._-]{1,40}$/;

export function normaliseUsername(input: string): string {
  return input.trim().toLowerCase();
}

export function emailForUsername(username: string): string {
  return `${normaliseUsername(username)}@${USERNAME_DOMAIN}`;
}

/** "raghav@users.freshroots.invalid" → "raghav"; other emails are shown as they are. */
export function displayName(email: string): string {
  return email.endsWith(`@${USERNAME_DOMAIN}`) ? email.slice(0, -USERNAME_DOMAIN.length - 1) : email;
}
