"use client";

import { useMemo } from "react";
import { useAccess } from "@/hooks/use-access";
import { useCampaigns, useEvents, useMeetings } from "@/hooks/use-data";
import { buildAgenda } from "./agenda";

/** Agenda unificada com o que o cargo pode ver (eventos, reuniões e rifas). */
export function useAgenda() {
  const access = useAccess();
  const hasEvents = access.canModule("events");
  const hasMeetings = access.canModule("meetings");
  const hasCampaigns = access.canModule("campaigns");
  const events = useEvents(hasEvents);
  const meetings = useMeetings(hasMeetings);
  const campaigns = useCampaigns(hasCampaigns);
  const queries = [hasEvents && events, hasMeetings && meetings, hasCampaigns && campaigns].filter((q) => !!q);

  const items = useMemo(
    () => buildAgenda({ events: hasEvents ? events.data : [], meetings: hasMeetings ? meetings.data : [], campaigns: hasCampaigns ? campaigns.data : [] }),
    [hasEvents, hasMeetings, hasCampaigns, events.data, meetings.data, campaigns.data],
  );
  const failed = queries.find((q) => q.isError);
  return {
    items,
    loading: queries.some((q) => q.isLoading),
    error: failed ? failed.error : null,
    retry: () => queries.filter((q) => q.isError).forEach((q) => void q.refetch()),
  };
}
