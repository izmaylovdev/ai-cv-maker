/**
 * localStorage key for the JWT access token.
 *
 * Single source of truth for all apps in the monorepo (`ui-angular`, `chat-ui`).
 */
export const TOKEN_KEY = 'cv_token';

/**
 * localStorage key for the signed-in user's email address.
 *
 * Stored separately so the UI can display the email without decoding
 * the JWT on every render.
 */
export const EMAIL_KEY = 'cv_email';
