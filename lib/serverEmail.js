import nodemailer from "nodemailer";

// Sends a batch of emails via Gmail SMTP. Shared by the manual Admin > Email
// tool and the automated Saturday reminder cron job, so the sending logic
// (batching, from-name, error handling) only lives in one place.
export async function sendBulkEmail({ subject, message, recipients }) {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) {
    return { error: "Email sending isn't configured yet — set GMAIL_USER and GMAIL_APP_PASSWORD." };
  }
  if (!recipients || recipients.length === 0) {
    return { sent: 0, total: 0, batchCount: 0, errors: [] };
  }

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user, pass },
  });

  const fromName = process.env.GMAIL_FROM_NAME || "Survivor Pool";
  const batchSize = 40;
  const batches = [];
  for (let i = 0; i < recipients.length; i += batchSize) {
    batches.push(recipients.slice(i, i + batchSize));
  }

  let sent = 0;
  const errors = [];
  for (const batch of batches) {
    try {
      // Addressing "To" as the sender with every real recipient hidden in
      // Bcc is also a common spam/phishing pattern, and Gmail's own spam
      // detection is especially good at catching exactly that between two
      // Gmail accounts. Using one real recipient as "To" and the rest as
      // "Bcc" avoids that pattern while still keeping everyone else's
      // address hidden from each other.
      const [firstRecipient, ...restRecipients] = batch;
      await transporter.sendMail({
        from: `"${fromName}" <${user}>`,
        to: firstRecipient,
        bcc: restRecipients.length > 0 ? restRecipients : undefined,
        subject,
        text: message,
      });
      sent += batch.length;
    } catch (e) {
      errors.push(e.message);
    }
  }

  return { sent, total: recipients.length, batchCount: batches.length, errors };
}
