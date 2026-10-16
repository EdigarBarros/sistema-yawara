"use client";

import { useParams } from "next/navigation";
import { useAccess } from "@/hooks/use-access";
import { useMeeting } from "@/hooks/use-data";
import { useBreadcrumbTitle } from "@/stores/breadcrumb";
import { canEditMeeting } from "@/lib/policies";
import { PageHeader } from "@/components/shared/page";
import { RecordErrorState, PageSkeleton, RestrictedState } from "@/components/shared/states";
import { MeetingForm } from "@/features/meetings/meeting-form";

export default function EditMeetingPage() {
  const { id } = useParams<{ id: string }>();
  const access = useAccess();
  const { data: meeting, isLoading, isError, error } = useMeeting(id);
  useBreadcrumbTitle(`/secretaria/${id}`, meeting?.title);
  if (isLoading) return <PageSkeleton />;
  if (isError || !meeting) return <RecordErrorState error={error} notFound="Reunião não encontrada" backHref="/secretaria" />;
  const allowed = !!access.ctx && canEditMeeting(access.ctx, meeting);
  return (
    <>
      <PageHeader back={{ href: `/secretaria/${id}`, label: meeting.title }} eyebrow={meeting.code} title="Editar reunião" />
      {allowed ? (
        <MeetingForm meeting={meeting} />
      ) : (
        <RestrictedState title="Edição indisponível" description="Atas aprovadas ou arquivadas não podem ser editadas, e seu perfil precisa de permissão de edição." />
      )}
    </>
  );
}
