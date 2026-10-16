/**
 * Marcação otimista de presença: a caixa muda na hora do clique e volta a
 * mostrar o dado do servidor assim que a gravação termina (com sucesso, o
 * projeto já foi relido; com falha, vale o valor salvo). Cada clique leva um
 * número próprio, para que o fim de um clique antigo não descarte a marcação
 * de um clique mais novo na mesma pessoa que ainda está em andamento.
 */
export type AttendanceMarks = Record<string, { present: boolean; token: number }>;

/** Registra o clique (o mais recente vale). */
export function markAttendance(marks: AttendanceMarks, attendeeId: string, present: boolean, token: number): AttendanceMarks {
  return { ...marks, [attendeeId]: { present, token } };
}

/** Gravação concluída (ok ou falha): descarta a marcação, se ela ainda for deste clique. */
export function settleAttendance(marks: AttendanceMarks, attendeeId: string, token: number): AttendanceMarks {
  if (marks[attendeeId]?.token !== token) return marks;
  const next = { ...marks };
  delete next[attendeeId];
  return next;
}

/** Valor exibido: a marcação pendente ou, sem ela, o dado do servidor. */
export function shownAttendance(marks: AttendanceMarks, attendee: { id: string; present: boolean }) {
  return marks[attendee.id]?.present ?? attendee.present;
}
