import "server-only";
import { ImapFlow } from "imapflow";
import { simpleParser, type AddressObject, type ParsedMail } from "mailparser";
import { gmailCredentials } from "@/lib/env";

/** Header stamped on everything this app sends, so it never reacts to its own mail. */
export const AUTOMATION_HEADER = "X-Email-Automation";

export type IncomingEmail = {
  uid: number;
  receivedAt: Date;
  /** String fields exposed to templates as {{email.*}}. */
  fields: {
    from: string;
    fromName: string;
    to: string;
    subject: string;
    text: string;
    date: string;
    messageId: string;
  };
  parsed: ParsedMail;
  /** Bounces, auto-replies and our own forwards. Running flows on these risks mail loops. */
  automated: boolean;
};

export type Inbox = {
  uidValidity: string;
  uidNext: number;
  /** UIDs greater than `afterUid`, ascending. */
  listNewUids(afterUid: number): Promise<number[]>;
  fetch(uid: number): Promise<IncomingEmail | null>;
  fetchLatest(): Promise<IncomingEmail | null>;
};

function addressText(value: AddressObject | AddressObject[] | undefined): string {
  if (!value) return "";
  return (Array.isArray(value) ? value : [value])
    .flatMap((group) => group.value.map((entry) => entry.address ?? ""))
    .filter(Boolean)
    .join(", ");
}

function isAutomated(parsed: ParsedMail, fromAddress: string): boolean {
  if (parsed.headers.has(AUTOMATION_HEADER.toLowerCase())) return true;
  const autoSubmitted = String(parsed.headers.get("auto-submitted") ?? "").toLowerCase();
  if (autoSubmitted && autoSubmitted !== "no") return true;
  return /^(mailer-daemon|postmaster)@/i.test(fromAddress);
}

async function toIncoming(uid: number, source: Buffer, internalDate: Date | string | undefined) {
  const parsed = await simpleParser(source);
  const sender = parsed.from?.value[0];
  const from = sender?.address ?? "";
  const receivedAt = internalDate ? new Date(internalDate) : (parsed.date ?? new Date());
  const email: IncomingEmail = {
    uid,
    receivedAt,
    fields: {
      from,
      fromName: sender?.name || from,
      to: addressText(parsed.to),
      subject: parsed.subject ?? "(no subject)",
      text: parsed.text ?? "",
      date: (parsed.date ?? receivedAt).toISOString(),
      messageId: parsed.messageId ?? "",
    },
    parsed,
    automated: isAutomated(parsed, from),
  };
  return email;
}

/** Opens the Gmail INBOX over IMAP for the duration of `fn`. Reading never marks mail as seen. */
export async function withInbox<T>(fn: (inbox: Inbox) => Promise<T>): Promise<T> {
  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: gmailCredentials(),
    logger: false,
  });
  // Without a listener, a dropped socket surfaces as an uncaught exception.
  client.on("error", () => {});

  try {
    await client.connect();
  } catch (error) {
    const reason = (error as { responseText?: string }).responseText ?? (error as Error).message;
    throw new Error(`Could not sign in to Gmail over IMAP: ${reason}`);
  }

  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const mailbox = client.mailbox;
      if (!mailbox) throw new Error("Could not open INBOX.");

      const fetchBy = async (range: string, byUid: boolean) => {
        const message = await client.fetchOne(
          range,
          { uid: true, source: true, internalDate: true },
          { uid: byUid },
        );
        if (!message || !message.source) return null;
        return toIncoming(message.uid, message.source, message.internalDate);
      };

      return await fn({
        uidValidity: String(mailbox.uidValidity),
        uidNext: mailbox.uidNext,
        async listNewUids(afterUid) {
          const uids = await client.search({ uid: `${afterUid + 1}:*` }, { uid: true });
          // "n:*" always matches the newest message, even when its UID is below n.
          return (uids || []).filter((uid) => uid > afterUid).sort((a, b) => a - b);
        },
        fetch: (uid) => fetchBy(String(uid), true),
        fetchLatest: async () => (mailbox.exists > 0 ? fetchBy("*", false) : null),
      });
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
}
