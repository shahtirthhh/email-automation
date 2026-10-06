# Email automation

Build flows that run when a new email arrives in a Gmail inbox. Flows are drawn with
[React Flow](https://reactflow.dev/), the UI uses [shadcn/ui](https://ui.shadcn.com/), state lives in
MongoDB, and a [Vercel Cron Job](https://vercel.com/docs/cron-jobs) polls the inbox.

## Steps

| Step          | Behaviour                                                                             |
| ------------- | ------------------------------------------------------------------------------------- |
| New email     | Trigger. Optional "sender contains" and "subject contains" filters.                   |
| Forward email | Sends the email, with attachments, to the addresses you list, from the Gmail account. |
| Call an API   | `POST`s your JSON to a URL. The secret is sent as `Authorization: Bearer <secret>`.   |
| Send in Slack | Dummy. Records what it would post.                                                    |
| AI extraction | Dummy. Sets `extracted.summary` and `extracted.category` to placeholder values.       |

Text fields and the JSON body accept variables such as `{{email.subject}}`. In the JSON body they must
sit inside quoted strings; values are escaped for you.

## Setup

1. `cp .env.example .env.local` and fill it in. The Gmail account needs 2-Step Verification and an
   [app password](https://myaccount.google.com/apppasswords).
2. `npm install && npm run dev`
3. Locally there is no cron. Use **Check inbox now** on the home page, or
   `curl -H "Authorization: Bearer $CRON_SECRET" localhost:3000/api/cron/poll`.

On Vercel, set the same variables. `vercel.json` schedules `/api/cron/poll` every minute, which needs a
Pro plan. Hobby only allows one run per day, so change the schedule to something like `0 9 * * *` there.

## When emails are processed

- New workflows start **off**, and a workflow with an invalid step cannot be switched on.
- A workflow only sees email received after it was last switched on. The first poll, and every poll
  while all workflows are off, moves the inbox cursor forward without processing anything.
- **Test run** performs the flow once on the newest email in the inbox, after a confirmation that lists
  where it will send. It works while the workflow is off.
- Each email runs at most once per workflow. A failed step is logged under **Runs** and not retried.
- Bounces, auto-replies and the app's own forwards are ignored so a flow cannot loop.

## Layout

- `lib/workflow/` holds the node types, validation, templating and the executor.
- `lib/mail/` reads Gmail over IMAP and forwards over SMTP.
- `lib/poll.ts` is the polling loop; `app/api/cron/poll/route.ts` exposes it to the cron.
- `app/actions.ts` holds the Server Actions used by the UI; `proxy.ts` is the password gate.
- `components/workflow/` is the editor.
