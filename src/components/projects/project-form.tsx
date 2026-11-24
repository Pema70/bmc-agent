"use client";

import { useState, useTransition, type FormEvent } from "react";
import type { ProjectFormState } from "@/app/projekty/actions";
import { FormField } from "@/components/auth/form-field";
import { PROJECT_DESCRIPTION_MAX_LENGTH, PROJECT_NAME_MAX_LENGTH } from "@/lib/schemas/project";

type ProjectFormProps = {
  action: (formData: FormData) => Promise<ProjectFormState>;
  submitLabel: string;
  pendingLabel: string;
  initial?: { name: string; description: string };
};

export function ProjectForm({ action, submitLabel, pendingLabel, initial }: ProjectFormProps) {
  const [state, setState] = useState<ProjectFormState | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    startTransition(async () => {
      setState(await action(formData));
    });
  }

  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;
  const descriptionError = fieldErrors?.description;

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
      <FormField
        label="Nazwa"
        name="name"
        required
        defaultValue={initial?.name}
        error={fieldErrors?.name}
        hint={`Od 1 do ${PROJECT_NAME_MAX_LENGTH} znaków.`}
      />

      <div className="flex flex-col gap-1">
        <label htmlFor="description" className="text-sm font-medium">
          Opis (opcjonalnie)
        </label>
        <textarea
          id="description"
          name="description"
          rows={4}
          defaultValue={initial?.description}
          aria-invalid={descriptionError ? true : undefined}
          aria-describedby={descriptionError ? "description-error" : "description-hint"}
          className="rounded-lg border border-border bg-surface px-3 py-2 text-text outline-none focus:border-ring aria-invalid:border-danger"
        />
        {descriptionError ? (
          <p id="description-error" className="text-sm text-danger">
            {descriptionError}
          </p>
        ) : (
          <p id="description-hint" className="text-sm text-muted">
            Najwyżej {PROJECT_DESCRIPTION_MAX_LENGTH} znaków.
          </p>
        )}
      </div>

      {state ? (
        <p role={state.ok ? "status" : "alert"} className={state.ok ? "text-sm text-low-fg" : "text-sm text-danger"}>
          {state.message}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="self-start rounded-lg bg-cta px-4 py-2 font-bold disabled:opacity-60"
      >
        {pending ? pendingLabel : submitLabel}
      </button>
    </form>
  );
}
