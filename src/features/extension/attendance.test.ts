import { describe, expect, it } from "vitest";
import { markAttendance, settleAttendance, shownAttendance, type AttendanceMarks } from "./attendance";

const carla = (present: boolean) => ({ id: "att-carla", present });

describe("presença: marcação otimista", () => {
  it("mostra o clique na hora, antes da resposta do servidor", () => {
    const marks = markAttendance({}, "att-carla", true, 1);
    expect(shownAttendance(marks, carla(false))).toBe(true);
  });

  it("depois de gravar, volta a valer o dado relido do servidor (outra pessoa pode ter mudado)", () => {
    let marks: AttendanceMarks = markAttendance({}, "att-carla", true, 1);
    marks = settleAttendance(marks, "att-carla", 1);
    expect(marks).toEqual({});
    // Outra organizadora desmarcou Carla; o projeto relido diz "ausente".
    expect(shownAttendance(marks, carla(false))).toBe(false);
  });

  it("falha na gravação: volta ao valor salvo", () => {
    const marks = settleAttendance(markAttendance({}, "att-carla", true, 1), "att-carla", 1);
    expect(shownAttendance(marks, carla(false))).toBe(false);
  });

  it("um clique antigo terminando não descarta um clique mais novo ainda em andamento", () => {
    let marks: AttendanceMarks = markAttendance({}, "att-carla", true, 1);
    marks = markAttendance(marks, "att-carla", false, 2);
    marks = markAttendance(marks, "att-carla", true, 3);
    marks = settleAttendance(marks, "att-carla", 1);
    marks = settleAttendance(marks, "att-carla", 2);
    expect(shownAttendance(marks, carla(false))).toBe(true);
    marks = settleAttendance(marks, "att-carla", 3);
    expect(shownAttendance(marks, carla(false))).toBe(false);
  });

  it("concluir a marcação de uma pessoa não afeta a de outra", () => {
    let marks: AttendanceMarks = markAttendance({}, "att-carla", true, 1);
    marks = markAttendance(marks, "att-bruno", true, 2);
    marks = settleAttendance(marks, "att-carla", 1);
    expect(shownAttendance(marks, { id: "att-bruno", present: false })).toBe(true);
  });
});
