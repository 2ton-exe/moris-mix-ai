export function authErrorMessage(error: unknown, fallback: string) {
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined
  switch (code) {
    case 'invalid_credentials': return 'The email or password is incorrect. Please try again.'
    case 'email_not_confirmed': return 'Please verify your email before logging in. You can request a new link on the verification page.'
    case 'weak_password': return 'Choose a stronger password that meets the account password requirements.'
    case 'over_request_rate_limit':
    case 'over_email_send_rate_limit': return 'Too many attempts. Please wait a few minutes and try again.'
    case 'user_already_exists': return 'Unable to create this account. Try logging in or use another email.'
    default: return fallback
  }
}
