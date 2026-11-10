import { z } from "zod";

export const PROJECT_NAME_MAX_LENGTH = 100;
export const PROJECT_DESCRIPTION_MAX_LENGTH = 2000;

export const ProjectRole = z.enum(["OWNER", "EDITOR", "VIEWER"]);
export type ProjectRole = z.infer<typeof ProjectRole>;

export const PROJECT_ROLE_LABELS: Record<ProjectRole, string> = {
  OWNER: "Właściciel",
  EDITOR: "Edytor",
  VIEWER: "Podgląd",
};

// Identyfikator z adresu URL lub z formularza: tylko kształt, istnienie sprawdza baza.
export const ProjectId = z.string().trim().min(1).max(64);

export const ProjectInput = z.object({
  name: z
    .string({ error: "Podaj nazwę projektu." })
    .trim()
    .min(1, { error: "Podaj nazwę projektu." })
    .max(PROJECT_NAME_MAX_LENGTH, { error: `Nazwa może mieć najwyżej ${PROJECT_NAME_MAX_LENGTH} znaków.` }),
  description: z
    .string()
    .trim()
    .max(PROJECT_DESCRIPTION_MAX_LENGTH, {
      error: `Opis może mieć najwyżej ${PROJECT_DESCRIPTION_MAX_LENGTH} znaków.`,
    })
    .optional()
    .transform((value) => value ?? ""),
});
export type ProjectInput = z.infer<typeof ProjectInput>;

export type ProjectFieldErrors = Partial<Record<keyof ProjectInput, string>>;

export function projectFieldErrors(error: z.ZodError): ProjectFieldErrors {
  const fieldErrors: ProjectFieldErrors = {};
  for (const issue of error.issues) {
    const field = issue.path[0];
    if ((field === "name" || field === "description") && !fieldErrors[field]) {
      fieldErrors[field] = issue.message;
    }
  }
  return fieldErrors;
}
