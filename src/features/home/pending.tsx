"use client";

import { useMemo } from "react";
import { BellRing, CalendarClock, ClipboardCheck, Hourglass, ListChecks, Lock, Megaphone, Users } from "lucide-react";
import { useAccess } from "@/hooks/use-access";
import { useAllSales, useCampaigns, useEvents, useMeetings } from "@/hooks/use-data";
import { todayDateOnly } from "@/lib/format";
import { buildPending, type PendingItem, type PendingKind } from "./pending-rules";

export type { PendingItem } from "./pending-rules";

export const PENDING_ICONS: Record<PendingKind, React.ReactNode> = {
  meeting: <ClipboardCheck />,
  unpaid: <Hourglass />,
  reserved: <Lock />,
  draw: <Megaphone />,
  task: <ListChecks />,
  event: <CalendarClock />,
  "meeting-soon": <Users />,
};

export const PENDING_FALLBACK_ICON = <BellRing />;

/** O que está esperando uma ação da pessoa, conforme o cargo e os módulos liberados. */
export function usePending() {
  const access = useAccess();
  const hasMeetings = access.canModule("meetings");
  const canApproveMeetings = hasMeetings && access.can("meetings.approve");
  const hasEvents = access.canModule("events");
  const hasCampaigns = access.canModule("campaigns");
  const followsPayments = hasCampaigns && access.can("campaigns.approve");
  const oversight = access.role?.level === "presidency";

  const meetings = useMeetings(hasMeetings);
  const events = useEvents(hasEvents);
  const campaigns = useCampaigns(hasCampaigns);
  const sales = useAllSales(hasCampaigns);

  const queries = [hasMeetings && meetings, hasEvents && events, hasCampaigns && campaigns, hasCampaigns && sales].filter((q) => !!q);
  const userId = access.user?.id;
  const items: PendingItem[] = useMemo(
    () =>
      buildPending({
        today: todayDateOnly(),
        userId,
        oversight,
        meetings: meetings.data,
        canApproveMeetings,
        events: events.data,
        campaigns: campaigns.data,
        sales: sales.data,
        followsPayments,
      }),
    [userId, oversight, meetings.data, canApproveMeetings, events.data, campaigns.data, sales.data, followsPayments],
  );
  const failed = queries.find((q) => q.isError);
  return {
    items,
    loading: queries.some((q) => q.isLoading),
    error: failed ? failed.error : null,
    retry: () => queries.forEach((q) => q.isError && void q.refetch()),
  };
}
