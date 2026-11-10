import { prisma } from "@/lib/db/client";
import type { ProjectInput, ProjectRole } from "@/lib/schemas/project";

export type ProjectSummary = {
  id: string;
  name: string;
  description: string;
  updatedAt: Date;
  role: ProjectRole;
};

export async function listProjectsForUser(userId: string): Promise<ProjectSummary[]> {
  const memberships = await prisma.projectMember.findMany({
    where: { userId },
    select: {
      role: true,
      project: { select: { id: true, name: true, description: true, updatedAt: true } },
    },
    orderBy: { project: { updatedAt: "desc" } },
  });
  return memberships.map(({ role, project }) => ({ ...project, role }));
}

export async function getProjectRole(projectId: string, userId: string): Promise<ProjectRole | null> {
  const membership = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId } },
    select: { role: true },
  });
  return membership?.role ?? null;
}

export async function getProject(
  projectId: string,
): Promise<{ id: string; name: string; description: string } | null> {
  return prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true, description: true },
  });
}

export async function createProject(userId: string, input: ProjectInput): Promise<{ id: string }> {
  // Zagnieżdżony zapis Prisma wykonuje się w jednej transakcji: projekt nie powstanie bez właściciela.
  return prisma.project.create({
    data: {
      name: input.name,
      description: input.description,
      members: { create: { userId, role: "OWNER" } },
    },
    select: { id: true },
  });
}

export type UpdateProjectResult = { ok: true } | { ok: false; error: "NOT_FOUND" };

export async function updateProjectDetails(
  projectId: string,
  userId: string,
  input: ProjectInput,
): Promise<UpdateProjectResult> {
  // Warunek OWNER jest częścią zapytania, więc nie zależy od wcześniejszego sprawdzenia w akcji.
  const { count } = await prisma.project.updateMany({
    where: { id: projectId, members: { some: { userId, role: "OWNER" } } },
    data: { name: input.name, description: input.description },
  });
  return count === 0 ? { ok: false, error: "NOT_FOUND" } : { ok: true };
}
