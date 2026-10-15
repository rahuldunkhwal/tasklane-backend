import type { Email } from '../../utils/email.js';

// Both an HTML and a plain-text version: some email apps only show plain text
export function passwordResetEmail(to: string, link: string, minutesValid: number): Email {
  return {
    to,
    subject: 'Reset your Task Board password',
    text: [
      'We received a request to reset your Task Board password.',
      '',
      `Open this link to choose a new password (valid for ${minutesValid} minutes):`,
      link,
      '',
      "If you didn't ask for this, you can ignore this email. Your password won't change.",
    ].join('\n'),
    html: `
      <p>We received a request to reset your Task Board password.</p>
      <p><a href="${link}">Choose a new password</a> (valid for ${minutesValid} minutes)</p>
      <p>If you didn't ask for this, you can ignore this email. Your password won't change.</p>
    `,
  };
}
