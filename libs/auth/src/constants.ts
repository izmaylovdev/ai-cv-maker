/**
 * localStorage key for the JWT access token.
 *
 * Single source of truth across `ui-angular` and `ui-react`.
 * Both apps share the same origin in production (proxied by Nginx),
 * so they share the same localStorage namespace — using the same key
 * means a token written by Angular is readable by React and vice-versa.
 */
export const TOKEN_KEY = 'cv_token';

/**
 * localStorage key for the signed-in user's email address.
 *
 * Stored separately so the UI can display the email without decoding
 * the JWT on every render.
 */
export const EMAIL_KEY = 'cv_email';
