import Link from "next/link";
import { Bell, UserRoundPlus } from "lucide-react";

import { markTaskNotificationsRead } from "@/app/tasks/actions";
import type { TaskNotification } from "@/lib/tasks-service";

function when(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

/**
 * Reminders and assignments for the signed-in person, unread first. They are
 * Volteira's own notices, shown here; nothing is texted or emailed.
 */
export function TaskNotifications({ notifications, unread, timeZone }: { notifications: TaskNotification[]; unread: number; timeZone: string }) {
  if (notifications.length === 0) return null;
  return (
    <section aria-labelledby="task-notices-heading" className="rounded-panel border border-brand/30 bg-surface p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 id="task-notices-heading" className="inline-flex items-center gap-2 text-sm font-semibold text-ink">
          <Bell className="h-4 w-4 text-brand" aria-hidden />
          For you{unread ? ` · ${unread} new` : ""}
        </h2>
        {unread ? (
          <form action={markTaskNotificationsRead}>
            <button type="submit" className="tap-target min-h-9 rounded-control px-2 text-xs font-semibold text-ink-muted hover:text-ink">
              Mark all read
            </button>
          </form>
        ) : null}
      </div>
      <ul className="grid gap-1.5">
        {notifications.map((notice) => (
          <li key={notice.id} className={`flex items-start gap-2 rounded-control px-2 py-2 text-sm ${notice.read ? "text-ink-muted" : "bg-brand/5 text-ink"}`}>
            {notice.kind === "assigned" ? <UserRoundPlus className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> : <Bell className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />}
            <div className="min-w-0 flex-1">
              {notice.task_id ? (
                <Link href={`/tasks/${notice.task_id}`} className="font-semibold hover:underline">
                  {notice.title}
                </Link>
              ) : (
                <span className="font-semibold">{notice.title}</span>
              )}
              {notice.body ? <p className="text-xs text-ink-muted">{notice.body}</p> : null}
              <p className="text-xs text-ink-faint">
                {notice.read ? "" : "New · "}
                {when(notice.created_at, timeZone)}
              </p>
            </div>
            {!notice.read ? (
              <form action={markTaskNotificationsRead}>
                <input type="hidden" name="notification_id" value={notice.id} />
                <button type="submit" className="tap-target min-h-9 rounded-control px-2 text-xs font-semibold text-ink-muted hover:text-ink" aria-label={`Mark "${notice.title}" read`}>
                  Mark read
                </button>
              </form>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
