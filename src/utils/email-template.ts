// Shared Tasklane-branded HTML shell for transactional emails (invites, password resets).
//
// Email clients ignore <style> blocks and CSS variables, and some rewrite the <head>, so every
// colour here is an inline literal taken from the Tasklane palette (frontend/src/index.css).
// We use a centred table for the layout because that is the one thing every client renders the same.

// Escape text that will sit inside HTML, so a name like `<b>` or `a & b` can't break the markup
// or inject tags. Used for every value that comes from a user (inviter name, board title).
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

type EmailButton = { label: string; href: string };

type EmailLayout = {
  heading: string; // plain text; escaped here
  paragraphs: string[]; // trusted HTML — caller escapes any dynamic parts with escapeHtml()
  button?: EmailButton;
  footnote?: string; // trusted HTML (static text in practice)
};

export function renderEmailHtml({ heading, paragraphs, button, footnote }: EmailLayout): string {
  const body = paragraphs
    .map((p) => `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#111210;">${p}</p>`)
    .join('');

  const buttonHtml = button
    ? `<p style="margin:24px 0 8px;">
         <a href="${button.href}" style="display:inline-block;background:#c8f54a;color:#111210;text-decoration:none;font-weight:700;font-size:15px;padding:12px 24px;border-radius:999px;">${escapeHtml(button.label)}</a>
       </p>`
    : '';

  const footnoteHtml = footnote
    ? `<p style="margin:16px 0 0;font-size:13px;line-height:1.6;color:#5d6155;">${footnote}</p>`
    : '';

  return `
  <div style="margin:0;padding:24px;background:#f3f4ee;font-family:'Segoe UI',Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;margin:0 auto;border-collapse:collapse;">
      <tr>
        <td style="padding:0 0 16px;font-size:22px;font-weight:700;letter-spacing:-0.02em;color:#111210;">
          Task<span style="background:#c8f54a;color:#111210;border-radius:999px;padding:2px 10px;">lane</span>
        </td>
      </tr>
      <tr>
        <td style="background:#ffffff;border:1px solid #e5e7df;border-radius:16px;padding:28px;">
          <h1 style="margin:0 0 16px;font-size:19px;font-weight:700;color:#111210;">${escapeHtml(heading)}</h1>
          ${body}
          ${buttonHtml}
          ${footnoteHtml}
        </td>
      </tr>
      <tr>
        <td style="padding:16px 4px 0;font-size:12px;color:#5d6155;">
          Tasklane &middot; Everything in its lane.
        </td>
      </tr>
    </table>
  </div>`;
}
