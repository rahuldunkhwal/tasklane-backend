import { Resend } from 'resend';
import { env } from '../config/env.js';

const resend = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null;

export type Email = { to: string; subject: string; html: string; text: string };

export async function sendEmail(email: Email) {
  if (!resend) {
    // Printing reset links in production logs would let anyone with log access reset passwords
    if (env.NODE_ENV === 'production') {
      throw new Error('RESEND_API_KEY is not set: cannot send emails in production');
    }
    // Development without a key (e.g. a reviewer running the project): print instead of sending
    console.log(
      `\n[email not sent: RESEND_API_KEY is empty]\nTo: ${email.to}\nSubject: ${email.subject}\n${email.text}\n`,
    );
    return;
  }

  // Resend doesn't throw when sending fails: it returns { error }, so we have to check it ourselves
  const { error } = await resend.emails.send({
    from: env.MAIL_FROM,
    to: [email.to],
    subject: email.subject,
    html: email.html,
    text: email.text,
  });
  if (error) {
    throw new Error(`Resend failed to send email: ${error.message}`);
  }
}
