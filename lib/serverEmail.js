import nodemailer from "nodemailer";

// Comcast/Xfinity's mail servers are known to aggressively reject batched
// BCC email from personal Gmail accounts (554 errors), even when every
// other provider accepts the exact same message fine. A single, direct,
// one-recipient email looks far less "bulk" to their filtering than the
// same message bundled with dozens of hidden BCC recipients, so those
// addresses get sent individually below instead of batched.
function isComcastLike(email) {
  const domain = (email.split("@")[1] || "").toLowerCase();
  return domain === "comcast.net" || domain === "xfinity.com";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Sends a batch of emails via Gmail SMTP. Shared by the manual Admin > Email
// tool and the automated Saturday/Sunday reminder cron, so the sending logic
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
  const comcastRecipients = recipients.filter(isComcastLike);
  const otherRecipients = recipients.filter((r) => !isComcastLike(r));

  let sent = 0;
  const errors = [];
  let batchCount = 0;

  // Comcast/Xfinity: one email per recipient, no BCC, with a short pause
  // between sends so it doesn't look like a burst to their filtering.
  for (const recipient of comcastRecipients) {
    try {
      await transporter.sendMail({
        from: `"${fromName}" <${user}>`,
        to: recipient,
        subject,
        text: message,
      });
      sent += 1;
      batchCount += 1;
    } catch (e) {
      errors.push(`${recipient}: ${e.message}`);
    }
    await sleep(300);
  }

  // Everyone else: batched as before (one real recipient as "To", the rest
  // in "Bcc" so people don't see each other's addresses).
  const batchSize = 40;
  const batches = [];
  for (let i = 0; i < otherRecipients.length; i += batchSize) {
    batches.push(otherRecipients.slice(i, i + batchSize));
  }

  for (const batch of batches) {
    try {
      const [firstRecipient, ...restRecipients] = batch;
      await transporter.sendMail({
        from: `"${fromName}" <${user}>`,
        to: firstRecipient,
        bcc: restRecipients.length > 0 ? restRecipients : undefined,
        subject,
        text: message,
      });
      sent += batch.length;
      batchCount += 1;
    } catch (e) {
      errors.push(e.message);
    }
  }

  return { sent, total: recipients.length, batchCount, errors };
}
