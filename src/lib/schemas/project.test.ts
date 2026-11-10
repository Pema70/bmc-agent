import { describe, expect, it } from "vitest";
import {
  PROJECT_DESCRIPTION_MAX_LENGTH,
  PROJECT_NAME_MAX_LENGTH,
  ProjectId,
  ProjectInput,
  projectFieldErrors,
} from "@/lib/schemas/project";

describe("ProjectInput", () => {
  it("przycina spacje w nazwie i opisie", () => {
    expect(ProjectInput.parse({ name: "  Kawiarnia  ", description: "  Opis \n" })).toEqual({
      name: "Kawiarnia",
      description: "Opis",
    });
  });

  it("zamienia brak opisu na pusty string", () => {
    expect(ProjectInput.parse({ name: "Kawiarnia" })).toEqual({ name: "Kawiarnia", description: "" });
  });

  it("odrzuca pustą nazwę i nazwę z samych spacji", () => {
    expect(ProjectInput.safeParse({ name: "" }).success).toBe(false);
    expect(ProjectInput.safeParse({ name: "   " }).success).toBe(false);
    expect(ProjectInput.safeParse({}).success).toBe(false);
  });

  it("pilnuje limitów długości", () => {
    expect(ProjectInput.safeParse({ name: "a".repeat(PROJECT_NAME_MAX_LENGTH) }).success).toBe(true);
    expect(ProjectInput.safeParse({ name: "a".repeat(PROJECT_NAME_MAX_LENGTH + 1) }).success).toBe(false);
    expect(
      ProjectInput.safeParse({ name: "a", description: "b".repeat(PROJECT_DESCRIPTION_MAX_LENGTH) }).success,
    ).toBe(true);
    expect(
      ProjectInput.safeParse({ name: "a", description: "b".repeat(PROJECT_DESCRIPTION_MAX_LENGTH + 1) }).success,
    ).toBe(false);
  });

  it("zwraca polskie komunikaty dla pól", () => {
    const result = ProjectInput.safeParse({ name: "", description: "b".repeat(PROJECT_DESCRIPTION_MAX_LENGTH + 1) });
    if (result.success) {
      expect.fail("oczekiwano błędu walidacji");
    }
    expect(projectFieldErrors(result.error)).toEqual({
      name: "Podaj nazwę projektu.",
      description: `Opis może mieć najwyżej ${PROJECT_DESCRIPTION_MAX_LENGTH} znaków.`,
    });
  });
});

describe("ProjectId", () => {
  it("odrzuca pusty i zbyt długi identyfikator oraz nie-stringi", () => {
    expect(ProjectId.safeParse("cmabc123").success).toBe(true);
    expect(ProjectId.safeParse("").success).toBe(false);
    expect(ProjectId.safeParse("a".repeat(65)).success).toBe(false);
    expect(ProjectId.safeParse(42).success).toBe(false);
  });
});
