"use client";

import { useDirectory } from "@/hooks/use-data";
import { Avatar } from "@/components/ui/misc";

/** Avatar de um integrante: mostra a foto de perfil quando houver, senão as iniciais. */
export function MemberAvatar({ id, name, size = 32, className }: { id?: string; name?: string; size?: number; className?: string }) {
  const dir = useDirectory();
  const member = dir.member(id);
  return <Avatar name={name ?? member?.name ?? dir.memberName(id)} id={id} size={size} className={className} src={member?.photo} />;
}
