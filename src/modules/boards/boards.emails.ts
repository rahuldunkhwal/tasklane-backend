import { escapeHtml, renderEmailHtml } from '../../utils/email-template.js';
import type { Email } from '../../utils/email.js';

// Sent when a board owner invites someone (usually a person without an account yet).
// Both an HTML and a plain-text version: some email apps only show plain text.
export function boardInviteEmail(
  to: string,
  link: string,
  inviterName: string,
  boardTitle: string,
): Email {
  // inviterName and boardTitle come from users, so escape them before putting them in HTML.
  const safeInviter = escapeHtml(inviterName);
  const safeTitle = escapeHtml(boardTitle);
  return {
    to,
    subject: `${inviterName} shared "${boardTitle}" with you on Tasklane`,
    text: [
      `${inviterName} shared the board "${boardTitle}" with you on Tasklane (view-only).`,
      '',
      'Open this link to view it (sign up or log in first if you need to):',
      link,
      '',
      "If you weren't expecting this, you can ignore this email.",
    ].join('\n'),
    html: renderEmailHtml({
      heading: `${inviterName} shared a board with you`,
      paragraphs: [
        `<strong>${safeInviter}</strong> shared the board "<strong>${safeTitle}</strong>" with you on Tasklane (view-only).`,
        'Sign up or log in first if you need to, then open the board below.',
      ],
      button: { label: 'Open the board', href: link },
      footnote: "If you weren't expecting this, you can ignore this email.",
    }),
  };
}
