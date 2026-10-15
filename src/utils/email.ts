import sgMail from '@sendgrid/mail';
import { env } from '../config/env.js';

export type Email = { to: string; subject: string; html: string; text: string };

// Configure the SendGrid client once, only if a key is present.
const hasKey = Boolean(env.SENDGRID_API_KEY);
if (env.SENDGRID_API_KEY) {
  sgMail.setApiKey(env.SENDGRID_API_KEY);
}

export async function sendEmail(email: Email) {
  if (!hasKey) {
    // Printing reset links in production logs would let anyone with log access reset passwords
    if (env.NODE_ENV === 'production') {
      throw new Error('SENDGRID_API_KEY is not set: cannot send emails in production');
    }
    // Development without a key (e.g. a reviewer running the project): print instead of sending
    console.log(
      `\n[email not sent: SENDGRID_API_KEY is empty]\nTo: ${email.to}\nSubject: ${email.subject}\n${email.text}\n`,
    );
    return;
  }

  try {
    await sgMail.send({
      to: email.to,
      from: env.MAIL_FROM, // must match a sender verified in SendGrid, or it's rejected (403)
      subject: email.subject,
      text: email.text,
      html: email.html,
    });
  } catch (error) {
    // @sendgrid/mail throws on failure; its response body carries the real reason
    // (e.g. "The from address does not match a verified Sender Identity").
    const reason =
      (error as { response?: { body?: { errors?: Array<{ message?: string }> } } }).response?.body
        ?.errors?.[0]?.message ?? (error instanceof Error ? error.message : 'unknown error');
    throw new Error(`SendGrid failed to send email: ${reason}`, { cause: error });
  }
}
