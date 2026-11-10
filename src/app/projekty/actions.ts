"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireProjectRole } from "@/lib/auth/permissions";
import { requireSession } from "@/lib/auth/session";
import { createProject, updateProjectDetails } from "@/lib/db/projects";
import { ProjectInput, projectFieldErrors, type ProjectFieldErrors } from "@/lib/schemas/project";

export type ProjectFormState = { ok: true; message: string } | { ok: false; message: string; fieldErrors?: ProjectFieldErrors };

function formValue(formData: FormData, key: string): string | undefined {
  const value = formData.get(key);
  return typeof value === "string" ? value : undefined;
}

function readProjectForm(formData: FormData) {
  return ProjectInput.safeParse({
    name: formValue(formData, "name"),
    description: formValue(formData, "description"),
  });
}

export async function createProjectAction(formData: FormData): Promise<ProjectFormState> {
  const session = await requireSession();

  const parsed = readProjectForm(formData);
  if (!parsed.success) {
    return { ok: false, message: "Popraw zaznaczone pola.", fieldErrors: projectFieldErrors(parsed.error) };
  }

  const project = await createProject(session.user.id, parsed.data);
  revalidatePath("/projekty");
  redirect(`/projekty/${project.id}`);
}

export async function updateProjectAction(projectId: string, formData: FormData): Promise<ProjectFormState> {
  const access = await requireProjectRole(projectId, "OWNER");
  if (!access.ok) {
    return { ok: false, message: "Tylko właściciel może edytować nazwę i opis projektu." };
  }

  const parsed = readProjectForm(formData);
  if (!parsed.success) {
    return { ok: false, message: "Popraw zaznaczone pola.", fieldErrors: projectFieldErrors(parsed.error) };
  }

  const result = await updateProjectDetails(access.projectId, access.session.user.id, parsed.data);
  if (!result.ok) {
    return { ok: false, message: "Nie znaleziono projektu albo nie masz już do niego uprawnień." };
  }

  revalidatePath("/projekty");
  revalidatePath(`/projekty/${access.projectId}`);
  return { ok: true, message: "Zapisano zmiany." };
}
