"use client";

import { useMemo } from "react";
import { useAccess } from "@/hooks/use-access";
import { useCampaigns, useEvents, useMeetings, useSportsTeams } from "@/hooks/use-data";
import { buildAgenda } from "./agenda";

/** Agenda unificada com o que o cargo pode ver (eventos, reuniões, rifas e esportes). */
export function useAgenda() {
  const access = useAccess();
  const hasEvents = access.canModule("events");
  const hasMeetings = access.canModule("meetings");
  const hasCampaigns = access.canModule("campaigns");
  const hasSports = access.canModule("sports");
  const events = useEvents(hasEvents);
  const meetings = useMeetings(hasMeetings);
  const campaigns = useCampaigns(hasCampaigns);
  const teams = useSportsTeams(hasSports);
  const queries = [hasEvents && events, hasMeetings && meetings, hasCampaigns && campaigns, hasSports && teams].filter((q) => !!q);

  const items = useMemo(
    () =>
      buildAgenda({
        events: hasEvents ? events.data : [],
        meetings: hasMeetings ? meetings.data : [],
        campaigns: hasCampaigns ? campaigns.data : [],
        teams: hasSports ? teams.data : [],
      }),
    [hasEvents, hasMeetings, hasCampaigns, hasSports, events.data, meetings.data, campaigns.data, teams.data],
  );
  const failed = queries.find((q) => q.isError);
  return {
    items,
    loading: queries.some((q) => q.isLoading),
    error: failed ? failed.error : null,
    retry: () => queries.filter((q) => q.isError).forEach((q) => void q.refetch()),
  };
}
