import { notFound } from "next/navigation";
import { requireSession, type AppSession } from "@/lib/auth/session";
import { getProjectRole } from "@/lib/db/projects";
import { ProjectId, type ProjectRole } from "@/lib/schemas/project";

const ROLE_RANK: Record<ProjectRole, number> = { VIEWER: 1, EDITOR: 2, OWNER: 3 };

export function hasRole(actual: ProjectRole, required: ProjectRole): boolean {
  return ROLE_RANK[actual] >= ROLE_RANK[required];
}

export type ProjectAccess =
  | { ok: true; session: AppSession; projectId: string; role: ProjectRole }
  | { ok: false; error: "FORBIDDEN"; session: AppSession; projectId: string; role: ProjectRole };

/**
 * Brak sesji: przekierowanie na /logowanie. Osoba spoza projektu (lub błędny identyfikator): 404,
 * żeby nie zdradzać, że projekt istnieje (D1). Członek z za niską rolą dostaje FORBIDDEN,
 * który strona lub akcja musi obsłużyć jawnie.
 */
export async function requireProjectRole(projectId: unknown, minRole: ProjectRole): Promise<ProjectAccess> {
  const session = await requireSession();

  const parsedId = ProjectId.safeParse(projectId);
  if (!parsedId.success) {
    notFound();
  }

  const role = await getProjectRole(parsedId.data, session.user.id);
  if (!role) {
    notFound();
  }

  const access = { session, projectId: parsedId.data, role };
  return hasRole(role, minRole) ? { ok: true, ...access } : { ok: false, error: "FORBIDDEN", ...access };
}
