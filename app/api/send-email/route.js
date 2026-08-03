import { sendBulkEmail } from "../../../lib/serverEmail";

// Manual send, triggered from Admin > Email ("Remind missing picks" / "Email everyone").
export async function POST(request) {
  try {
    const { subject, message, recipients } = await request.json();

    if (!subject || !message || !Array.isArray(recipients) || recipients.length === 0) {
      return Response.json({ error: "Missing subject, message, or recipients." }, { status: 400 });
    }

    const result = await sendBulkEmail({ subject, message, recipients });
    if (result.error) return Response.json({ error: result.error }, { status: 500 });
    return Response.json(result);
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
