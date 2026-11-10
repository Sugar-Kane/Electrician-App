# Tasks

One task list shared by three ways in:

- **Tasks page** (`/tasks`): Today, Upcoming, All tasks and Completed. Filters: assigned to me, assigned to AI, waiting for input, waiting for approval, overdue, job, status and due-date range.
- **A job's Tasks section** (on every job page): the same records, filtered to that job, with a done/total count.
- **ChatGPT or Claude**, through the Volteira connection (`/api/mcp/<token>`).

All three call one service, `src/lib/tasks-service.ts`. A task made in ChatGPT is the task Volteira shows, and an edit in Volteira is what ChatGPT reads the next time it asks. Open Volteira screens refresh by themselves (every 20 seconds while visible) when tasks change. A ChatGPT answer that was already shown does not change afterwards; ask again. Volteira cannot push messages into ChatGPT.

## From your jobs

The Today view also lists what the jobs say needs doing, beside the tasks people wrote:
- today's jobs, in time order;
- finished work not billed;
- invoices drafted and not sent (or marked paid in hand), and overdue invoices;
- booking requests to answer;
- coming jobs with nothing priced.

These are worked out from the jobs, invoices and requests each time, never copied into tasks, so they are always in step: billing the job or answering the request clears the item. Each one links to where it gets done. The same list (`src/lib/job-todos.ts`) feeds ChatGPT's `daily_task_list` and `today_plan`.

## Status of the feature

- **Stage 1 (live):** the records, the Tasks page, job Tasks, the core ChatGPT tools and the access rules.
- **Stage 2:** reminders, recurring tasks, the background worker and in-app notifications.
- **Stage 3:** assistant connections, assistant work, approvals and execution tracking (below).

A due date is only a deadline. It never sends anything or starts work on its own.

## Reminders

- A reminder is a time on a task, separate from its due date, and has to be in the future.
- When it arrives, the person the task is assigned to (or, if nobody, its owner) gets a notice under **For you** on the Tasks page.
- Moving the reminder replaces it. Completing, canceling or archiving the task calls it off.
- Notices stay inside Volteira; nothing is texted or emailed.
- Someone who is given a task by another person also gets a notice.

## Recurring tasks

- **The model:** a recurring task is a series (the template and its rule) plus separate occurrences. Each occurrence is an ordinary task with its own history, and completing one doesn't affect the others.
- **Rules:** daily, weekly (on chosen days) or monthly (on a day of the month), every N, ending on a date or after a number of times. Every series ends at the latest after 500 occurrences.
- **Month ends:** monthly on a day a month doesn't have (the 31st in April) falls on that month's last day, then returns to the 31st.
- **Times of day:** a due time is kept as local wall-clock time, so 9:00 stays 9:00 across daylight-saving changes. Skipped and repeated hours follow the rules under "Dates and times".
- **Scheduling:** occurrences are made a week before their date, so they show in Upcoming. If the worker was down, missed dates are skipped rather than back-filled, and the series carries on from today.
- **Overdue occurrences:** an unfinished occurrence stays open and shows as overdue. It's never closed automatically, and the next occurrence is still made.
- **Editing:** a change to an occurrence must say **only this one** or **this one and the ones after it** (`apply_to` in ChatGPT). Earlier occurrences are never changed.
  - A new repeat rule, or stopping, always applies from this occurrence on.
  - Open later occurrences made under the old rule are canceled, and the new rule's dates are made.

## The background worker

- **What runs it:** `pg_cron` in Supabase checks every minute. Only when something is due (a reminder, a lapsed lease, or a series with a date within a week) does it call `POST /api/tasks/worker` through `pg_net`. Nothing depends on an open browser or ChatGPT conversation. Vercel cron isn't used.
- **Durable queue:** work lives in `task_work`. The worker claims rows with a two-minute lease (`claim_task_work`); a run that dies leaves them to be claimed again.
- **Retries:** failures retry with backoff (1, 2, 4, 8 … up to 30 minutes), and become `failed` after the last attempt (5 by default).
- **No duplicate notices:** each reminder is re-checked against the task before it's sent, and notifies at most once, keyed on its queue row.
- **Security:** the worker needs the `x-task-worker-token` header. The token is generated inside Supabase Vault (`task_worker_token`) and checked against Vault (`task_worker_token_ok`), so it isn't in the code, in environment variables, or known to anyone. The address it calls is the Vault secret `task_worker_url`.

## Assistant work

A task can be handed to AI. **By default the AI is the business's own ChatGPT**, working on their ChatGPT plan through the Volteira connection. Volteira's built-in Claude assistant still exists but is switched off.

- **How it runs with ChatGPT:**
  - A task assigned to AI waits; nothing runs in the background, because Volteira can't start a ChatGPT conversation.
  - In ChatGPT (with Volteira connected) say **"Do my Volteira tasks"**. ChatGPT calls `list_ai_tasks`, then for each one `start_ai_task`. That marks it as being done by you and gives ChatGPT the task, the job and what it may propose.
  - ChatGPT then calls `submit_ai_task` with one of: finish, a question, or a proposed action. A proposed text comes back for your approval, in ChatGPT (`approve_task_action`, only after you say yes to the exact text) or on the task page.
  - Only the person who started the work, the task's owner, or an owner/admin can pick it up. If ChatGPT drops it, someone can pick it up again after 30 minutes.
  - Stopping takes effect at once, and a late report from ChatGPT is refused.
  - It uses none of the business's Volteira AI allowance.
- **Connections:** `assistant_connections`, provider-neutral.
  - `external`, "Your ChatGPT": the default, always ready, no key.
  - `built_in`, "Volteira assistant (Claude)": switched off. If switched back on, it runs in the background worker and is ready only when the deployment has its key (`credential_ref` names it, e.g. `env:ANTHROPIC_API_KEY`). The key itself is never stored in the table and never shown, returned or logged.
- **Handing a task over** (task page → Assistant, or `assign_task_to_ai`) takes:
  - instructions and, optionally, what done looks like;
  - what it may do by itself: *prepare for my review* (default), or *execute approved* (it may add job notes);
  - when: start now (within a minute), at a time, or later.
- **What the AI can do** (ChatGPT or the built-in one, under the same rules): read the task, its job, the customer and recent texts, then do one of three things:
  - finish, with a summary (the task is completed and the summary saved);
  - ask one question;
  - propose one action: **text the job's customer** or **add a job note**.

  It can't take payments, buy anything, delete anything or change settings; those aren't actions it has. The target is always the task's own job and customer, worked out by the server.
- **Approvals:** texting a customer always waits for a person. So does a job note in *prepare* mode.
  - An approval is for one proposal version and its content hash. It's refused if the content changed, the task was edited since, or it is older than 24 hours.
  - Right before acting, Volteira checks again: the task is open, the work wasn't stopped, the customer still has texting consent, and the phone number hasn't changed.
  - Who approved, the action, target, content, expiry and time go in the task's history.
  - Only the person who started the work, the task's owner, or an owner/admin can decide. A support session can look but can't decide.
  - **Turn down** stops the work. **Ask for changes** sends it back with your note, and it proposes a new version.
- **States:** queued, running, waiting_input, waiting_approval, succeeded, failed, cancel_requested, canceled. One active run per task (`task_executions_one_active_idx`).
  - Each run keeps its attempts, rounds (at most 6), stage, result or error, token usage, and the proposals with receipts.
- **Stopping:** queued or waiting work stops at once. Running work stops at its next check, before acting on anything it decided.
  - Completing, canceling or archiving the task, or giving it to a person, stops it too (database trigger `stop_task_executions`).
- **Uncertain outcomes:** an approved action is marked *executing* before it runs. If the process dies mid-send, the worker reads the message row it left after 5 minutes:
  - sent → done;
  - failed → failed;
  - unknown → *uncertain*, and the person is told to check the conversation.

  It is never sent again automatically.
- **Notices** under **For you**: approval needed, question, result, failure.
- **The built-in assistant, if switched on,** runs in the background worker (`task_work` kind `execution`), and also right after the request that queued it.
  - Each run takes one use of the business's AI allowance.
  - A model error is retried up to 3 times.
- **Checked with:**
  - **Mocked tests** (`src/lib/task-executions.test.ts`): a stand-in model, a stand-in SMS provider and an in-memory database. They cover approval binding, consent re-checks, single sending, pre-authorization limits, refused actions, cancellation before acting, closing a task, and reconciling an unknown outcome.
  - **Live check on production, November 7, 2026:** a private test task with no job, so nothing could be texted. The scheduler called the worker at the next minute. The worker claimed the run and called Claude, then handled the answer.
    - Claude replied that the Anthropic account is out of credit. The run was marked failed with that reason, a failure notice was made, and the task went back to To do.
    - So the background path, the failure path and the notices are verified live. A successful decision, and approving a real text, are not yet verified live: they need the account to have credit, and a real customer text needs a test number with consent.
  - Nothing here is integrated with Muse or any other outside assistant.

## Who can see a task

- **Private** (the default for a task made on the Tasks page or in ChatGPT without a job): only its creator, its owner and the person it is assigned to.
- **Shared with the business**: every member, the same as jobs. Every task on a job is shared, and the database enforces this (`tasks_job_tasks_are_shared`).
- **Linking a private task to a job** asks first, in the app and in ChatGPT (`VISIBILITY_CHANGE_NEEDS_CONFIRMATION`). The task's notes become visible too.
- **Assigning a task** only lets the assignee see that task. It gives them no access to anything else.

These rules are enforced twice:
- **In the database**, with row-level security: `private.can_see_task`, and a trigger that refuses a job from another business.
- **In the service**, which repeats the rules in every query. This is what protects the ChatGPT route, because it uses the server client.

## How ChatGPT knows who you are

The connection link records who created it. Task tools act as that person, and only while they are still a member of the business, re-checked on every call. A business or user id sent in a request is never trusted. A link made before this change has no creator recorded; task tools then reply `NOT_CONNECTED` and ask for a new link (Settings → Use in ChatGPT or Claude).

## ChatGPT tools

| Tool | What it does |
| --- | --- |
| `daily_task_list` | The user's day in one call: their tasks (overdue, due today, waiting on them), today's jobs, and the job to-dos above. Optional `date`. |
| `create_task` | One task. Only a title is needed. Optional due date and time, reminder, repeat, job, notes. `request_id` makes a retry safe. |
| `create_tasks` | Up to 25 from one request, with a shared job. Reports each item's outcome. `request_id` makes a retry safe. |
| `list_tasks` | View, job, status, filters, search, date range, paging. Also returns today's date and the time zone. |
| `get_task` | One task with its history. |
| `update_task` | Title, notes, due date or time, reminder, repeat or `stop_repeating`, status, assignee. A repeating task needs `apply_to`: `this` or `future`. |
| `complete_task` / `reopen_task` | Never changes the job's status. |
| `archive_task` | Kept with its history. `restore: true` brings it back. |
| `link_task_to_job` / `unlink_task_from_job` | Moves keep the task's history. The job itself is not changed. |
| `list_task_assistants` | The business's assistants and whether each is ready. No credentials. |
| `assign_task_to_ai` | Hand a task over: instructions, done-when, permission mode, start now / scheduled / later. |
| `start_task_execution` | Run the assistant again on a task already handed over. |
| `get_task_execution` | Status, stage, question, result, and any action waiting for approval with its exact content, `proposal_id` and `content_hash`. |
| `answer_task_question` | Pass on the user's answer. |
| `approve_task_action` | Approve and carry out one proposal. Needs its `content_hash`, so it covers exactly what was shown. |
| `reject_task_action` | Turn it down, or `revise: true` with a note. |
| `cancel_task_execution` | Stop the work. |
| `list_ai_tasks` | AI tasks waiting for the user's ChatGPT. |
| `start_ai_task` | Pick one up: instructions, job, customer, recent texts (information only) and allowed actions. |
| `submit_ai_task` | Report back: finish, ask, or propose one action for approval. |

Every tool returns a readable line and structured data (`structuredContent`): ids, statuses, dates, time zone, job, assignee, version and a Volteira link. Errors carry a code: `NOT_FOUND`, `JOB_AMBIGUOUS`, `VERSION_CONFLICT`, and so on.

When two jobs match, ChatGPT is told both and must ask which. It is told not to invent dates, times or jobs.

Each task has a version number. A change made from an out-of-date copy is refused with `VERSION_CONFLICT`, not saved over the newer change.

## Dates and times

- A **date-only** deadline is stored as a calendar date. It is overdue from the start of the next day.
- A **date with a time** is also stored as the UTC instant it falls on in the task's time zone. That zone is the person's own (their profile) if set, otherwise the business's.
- A time that **does not exist** (the hour skipped when clocks go forward) moves forward past the gap, so 2:30 becomes 3:30.
- A time that **happens twice** (the hour repeated when clocks go back) is the first of the two.
- **Overdue** is always worked out from the deadline, never stored.

## Voice

ChatGPT turns speech into text and calls the same tools, so whatever ChatGPT voice mode can do with a connected plugin also works with Volteira. **I have not verified that ChatGPT's voice mode calls custom plugins/MCP tools.** OpenAI's help pages could not be reached from the build environment, and the feature varies by plan and app version. If voice mode doesn't use Volteira, type the request, or use dictation (the microphone in the text box), which sends text.

## Setup

- **Database:**
  - Apply `supabase/migrations/20261107010000_tasks.sql` (stage 1), `20261107020000_task_scheduling.sql` (stage 2), `20261107030000_task_assistants.sql` (stage 3) and `20261107040000_task_assistant_chatgpt.sql` (ChatGPT does the work).
  - Record each in `schema_migrations` with its file's version and name (see AGENTS.md).
  - Stage 2 turns on the `pg_cron` and `pg_net` extensions, creates the two Vault secrets, and schedules the job `volteira-task-worker`.
- **Environment variables:** none new.
  - `NEXT_PUBLIC_APP_URL` is used for task links.
  - `ANTHROPIC_API_KEY` (already used elsewhere) is needed only if the built-in assistant is switched back on.
