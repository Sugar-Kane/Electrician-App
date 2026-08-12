"use client";

import Link from "next/link";
import { Ban, CalendarClock, FileText, FolderOpen, MoreHorizontal, Pencil } from "lucide-react";

import { Menu, MenuItem, MenuSeparator } from "@/components/ui/menu";

/**
 * The things a job can have done to it that are not the work.
 *
 * All four used to be on the job page itself. Editing the arrival window was a
 * form with two datetime pickers, a status dropdown and a notification
 * checkbox, sitting inline between the notes and the cancel button — roughly a
 * third of the page, for something that happens once a fortnight and never on a
 * ladder. Cancelling had a card of its own at the bottom of every job, forever,
 * because one job in fifty gets called off.
 *
 * They are here instead. Cancel stays red where it lands, because a destructive
 * action that looks like the others is one somebody taps by accident, and it
 * opens the confirmation rather than doing anything.
 */
export function JobMenu({ jobNumber, hasContract }: { jobNumber: string; hasContract: boolean }) {
  const edit = `/jobs/${jobNumber}/edit`;

  return (
    <Menu
      label="Job settings"
      align="right"
      trigger={
        // Wide enough to be a target rather than a decoration: the menu's own
        // padding leaves a 20px icon in a 32px button otherwise.
        <span className="grid h-9 w-9 place-items-center">
          <MoreHorizontal className="h-5 w-5" aria-hidden />
        </span>
      }
    >
      <Link href={edit} role="menuitem">
        <MenuItem icon={<Pencil className="h-[18px] w-[18px]" aria-hidden />}>Edit job</MenuItem>
      </Link>

      <Link href={`${edit}#window`} role="menuitem">
        <MenuItem
          icon={<CalendarClock className="h-[18px] w-[18px]" aria-hidden />}
          description="Move the arrival window and tell the customer"
        >
          Reschedule
        </MenuItem>
      </Link>

      <Link href={`/jobs/${jobNumber}#contract`} role="menuitem">
        <MenuItem icon={<FileText className="h-[18px] w-[18px]" aria-hidden />}>
          {hasContract ? "View contract" : "Generate contract"}
        </MenuItem>
      </Link>

      <Link href={`/files?job=${jobNumber}`} role="menuitem">
        <MenuItem icon={<FolderOpen className="h-[18px] w-[18px]" aria-hidden />}>Files</MenuItem>
      </Link>

      <MenuSeparator />

      <Link href={`${edit}#cancel`} role="menuitem">
        <span className="tap-row flex min-h-14 items-center gap-3 rounded-chip px-3 py-2 text-critical hover:bg-critical/[0.07]">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-chip bg-critical/10">
            <Ban className="h-[18px] w-[18px]" aria-hidden />
          </span>
          <span className="text-sm font-semibold">Cancel job</span>
        </span>
      </Link>
    </Menu>
  );
}
