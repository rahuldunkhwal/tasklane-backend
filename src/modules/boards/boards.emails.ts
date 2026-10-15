import type { Email } from '../../utils/email.js';

// Sent when a board owner invites someone (usually a person without an account yet).
// Both an HTML and a plain-text version: some email apps only show plain text.
export function boardInviteEmail(
  to: string,
  link: string,
  inviterName: string,
  boardTitle: string,
): Email {
  return {
    to,
    subject: `${inviterName} shared "${boardTitle}" with you on Task Board`,
    text: [
      `${inviterName} shared the board "${boardTitle}" with you on Task Board (view-only).`,
      '',
      'Open this link to view it (sign up or log in first if you need to):',
      link,
      '',
      "If you weren't expecting this, you can ignore this email.",
    ].join('\n'),
    html: `
      <p><strong>${inviterName}</strong> shared the board "<strong>${boardTitle}</strong>" with you on Task Board (view-only).</p>
      <p><a href="${link}">Open the board</a> (sign up or log in first if you need to).</p>
      <p>If you weren't expecting this, you can ignore this email.</p>
    `,
  };
}
