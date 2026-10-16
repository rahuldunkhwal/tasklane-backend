import { renderEmailHtml } from '../../utils/email-template.js';
import type { Email } from '../../utils/email.js';

// Both an HTML and a plain-text version: some email apps only show plain text
export function passwordResetEmail(to: string, link: string, minutesValid: number): Email {
  return {
    to,
    subject: 'Reset your Tasklane password',
    text: [
      'We received a request to reset your Tasklane password.',
      '',
      `Open this link to choose a new password (valid for ${minutesValid} minutes):`,
      link,
      '',
      "If you didn't ask for this, you can ignore this email. Your password won't change.",
    ].join('\n'),
    html: renderEmailHtml({
      heading: 'Reset your password',
      paragraphs: [
        'We received a request to reset your Tasklane password.',
        `This link is valid for ${minutesValid} minutes.`,
      ],
      button: { label: 'Choose a new password', href: link },
      footnote:
        "If you didn't ask for this, you can ignore this email. Your password won't change.",
    }),
  };
}
