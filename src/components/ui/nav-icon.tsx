"use client";

import {
  BellRing,
  Boxes,
  Building2,
  CalendarDays,
  ChartNoAxesColumn,
  CreditCard,
  FolderOpen,
  Inbox,
  FileText,
  LayoutDashboard,
  Package,
  Sparkles,
  MessagesSquare,
  PlugZap,
  ReceiptText,
  Route,
  ScrollText,
  Settings,
  UserRound,
  UsersRound,
  type LucideIcon,
} from "lucide-react";

/**
 * Turning an icon name from the navigation config into an icon.
 *
 * The config is import-free so it can be tested and read on the server; icons
 * are a client concern. This is the one place the two meet, and an unknown name
 * falls back rather than crashing a menu.
 */
const ICONS: Record<string, LucideIcon> = {
  BellRing,
  Boxes,
  Building2,
  CalendarDays,
  ChartNoAxesColumn,
  CreditCard,
  FolderOpen,
  Inbox,
  FileText,
  LayoutDashboard,
  Package,
  Sparkles,
  MessagesSquare,
  PlugZap,
  ReceiptText,
  Route,
  ScrollText,
  Settings,
  UserRound,
  UsersRound,
};

export function NavIcon({ name, className }: { name: string; className?: string }) {
  const Icon = ICONS[name] ?? Settings;
  return <Icon className={className ?? "h-[18px] w-[18px]"} strokeWidth={1.8} aria-hidden />;
}
