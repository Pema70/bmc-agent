import { notFound } from "next/navigation";
import { getSession, requireSession, type AppSession } from "@/lib/auth/session";
import { getProjectRole } from "@/lib/db/projects";
import { ProjectId, type ProjectRole } from "@/lib/schemas/project";

const ROLE_RANK: Record<ProjectRole, number> = { VIEWER: 1, EDITOR: 2, OWNER: 3 };

export function hasRole(actual: ProjectRole, required: ProjectRole): boolean {
  return ROLE_RANK[actual] >= ROLE_RANK[required];
}

export type ProjectAccess =
  | { ok: true; session: AppSession; projectId: string; role: ProjectRole }
  | { ok: false; error: "FORBIDDEN"; session: AppSession; projectId: string; role: ProjectRole };

type ResolvedAccess =
  | ProjectAccess
  | { ok: false; error: "NOT_FOUND"; session: AppSession };

async function resolveProjectAccess(
  session: AppSession,
  projectId: unknown,
  minRole: ProjectRole,
): Promise<ResolvedAccess> {
  const parsedId = ProjectId.safeParse(projectId);
  if (!parsedId.success) {
    return { ok: false, error: "NOT_FOUND", session };
  }

  const role = await getProjectRole(parsedId.data, session.user.id);
  if (!role) {
    return { ok: false, error: "NOT_FOUND", session };
  }

  const access = { session, projectId: parsedId.data, role };
  return hasRole(role, minRole) ? { ok: true, ...access } : { ok: false, error: "FORBIDDEN", ...access };
}

/**
 * Brak sesji: przekierowanie na /logowanie. Osoba spoza projektu (lub błędny identyfikator): 404,
 * żeby nie zdradzać, że projekt istnieje (D1). Członek z za niską rolą dostaje FORBIDDEN,
 * który strona lub akcja musi obsłużyć jawnie.
 */
export async function requireProjectRole(projectId: unknown, minRole: ProjectRole): Promise<ProjectAccess> {
  const session = await requireSession();
  const access = await resolveProjectAccess(session, projectId, minRole);
  if (!access.ok && access.error === "NOT_FOUND") {
    notFound();
  }
  return access as ProjectAccess;
}

export type ProjectAccessResult =
  | ProjectAccess
  | { ok: false; error: "UNAUTHENTICATED" }
  | { ok: false; error: "NOT_FOUND"; session: AppSession };

/**
 * Wariant dla route handlerów (API): bez redirect i notFound, żeby odpowiedź była JSON-em
 * z kodem 401 / 404 / 403. Wynik z ok: false trzeba sprawdzić przed jakimkolwiek odczytem danych.
 */
export async function getProjectAccess(projectId: unknown, minRole: ProjectRole): Promise<ProjectAccessResult> {
  const session = await getSession();
  if (!session) {
    return { ok: false, error: "UNAUTHENTICATED" };
  }
  return resolveProjectAccess(session, projectId, minRole);
}
