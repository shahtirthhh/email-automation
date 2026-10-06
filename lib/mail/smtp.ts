import "server-only";
import nodemailer from "nodemailer";
import { gmailCredentials } from "@/lib/env";
import { AUTOMATION_HEADER, type IncomingEmail } from "@/lib/mail/imap";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function forwardEmail(email: IncomingEmail, recipients: string[], note: string) {
  const auth = gmailCredentials();
  const transport = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth,
  });

  const { fields, parsed } = email;
  const sender = fields.fromName === fields.from ? fields.from : `${fields.fromName} <${fields.from}>`;
  const headerLines = [
    "---------- Forwarded message ---------",
    `From: ${sender}`,
    `Date: ${fields.date}`,
    `Subject: ${fields.subject}`,
    `To: ${fields.to}`,
  ];
  const originalHtml = parsed.html || `<pre>${escapeHtml(fields.text)}</pre>`;

  try {
    const info = await transport.sendMail({
      from: auth.user,
      to: recipients,
      subject: /^fwd?:/i.test(fields.subject) ? fields.subject : `Fwd: ${fields.subject}`,
      text: [note, headerLines.join("\n"), fields.text].filter(Boolean).join("\n\n"),
      html: [
        note ? `<p>${escapeHtml(note).replace(/\n/g, "<br>")}</p>` : "",
        `<p>${headerLines.map(escapeHtml).join("<br>")}</p>`,
        originalHtml,
      ].join("\n"),
      attachments: parsed.attachments.map((attachment) => ({
        filename: attachment.filename,
        content: attachment.content,
        contentType: attachment.contentType,
        cid: attachment.cid,
        contentDisposition: attachment.contentDisposition === "inline" ? "inline" : "attachment",
      })),
      headers: { [AUTOMATION_HEADER]: "forward" },
    });
    return { accepted: info.accepted.map(String), rejected: info.rejected.map(String) };
  } finally {
    transport.close();
  }
}
