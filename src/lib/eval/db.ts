import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import { MAIN_VARIANT_NAME } from "@/lib/db/variants";
import type { CostReading } from "@/lib/eval/budget";
import { EvalEndReason } from "@/lib/eval/cases";
import { BmcState } from "@/lib/schemas/bmc";
import type { EvalDb, ExistingRun, NewRunData } from "@/lib/eval/run-eval";

/**
 * Implementacja `EvalDb` na Prismie (skrypt ewaluacji, plan 10f). Niczego nie kasuje: projekty pomiarowe i wiersze
 * `EvalRun` zostają jako historia. Tokeny, czas i koszt nie są kopiowane do `EvalRun`: liczone z `LlmCallLog` po `projectId`.
 */
export function createEvalDb(client: typeof prisma = prisma): EvalDb {
  return {
    async findUserIdByEmail(email) {
      const user = await client.user.findUnique({ where: { email }, select: { id: true } });
      return user?.id ?? null;
    },

    async listRuns(seriesId): Promise<ExistingRun[]> {
      const rows = await client.evalRun.findMany({
        where: { seriesId, architecture: "SINGLE" },
        select: { id: true, caseId: true, model: true, repetition: true, attempt: true, status: true, projectId: true },
      });
      return rows;
    },

    async stopStaleRuns(seriesId) {
      const result = await client.evalRun.updateMany({
        where: { seriesId, status: "RUNNING" },
        data: { status: "STOPPED", errorCode: "CRASHED", finishedAt: new Date() },
      });
      return result.count;
    },

    async createProject({ userId, name, description, state, entryOrigins }) {
      const project = await client.project.create({
        data: {
          name,
          description,
          members: { create: { userId, role: "OWNER" } },
          variants: {
            create: {
              name: MAIN_VARIANT_NAME,
              isMain: true,
              state: state as Prisma.InputJsonValue,
              entryOrigins: entryOrigins as Prisma.InputJsonValue,
              createdById: userId,
            },
          },
        },
        select: { id: true, variants: { select: { id: true } } },
      });
      const variant = project.variants[0];
      if (!variant) {
        throw new Error("Projekt pomiarowy powstał bez wariantu głównego.");
      }
      return { projectId: project.id, variantId: variant.id };
    },

    async createRun(data: NewRunData) {
      const row = await client.evalRun.create({
        data: { ...data, status: "RUNNING", architecture: "SINGLE" },
        select: { id: true },
      });
      return { id: row.id };
    },

    async finishRun(id, result) {
      await client.evalRun.update({
        where: { id },
        data: {
          status: result.status,
          errorCode: result.errorCode ?? null,
          turnCount: result.turnCount ?? null,
          // Walidacja Zod: kolumna jest tekstem, więc wartość spoza listy nie trafi do bazy.
          endReason: EvalEndReason.nullish().parse(result.endReason) ?? null,
          finishedAt: new Date(),
        },
      });
    },

    async readCost(projectIds): Promise<CostReading> {
      if (projectIds.length === 0) return { totalUsd: 0, unknownCalls: 0 };
      const where = { projectId: { in: [...projectIds] } };
      const [sum, unknown] = await Promise.all([
        client.llmCallLog.aggregate({ where, _sum: { costUsd: true } }),
        // Tylko udane wywołania bez kosztu (model bez ceny): nieudane (bez tokenów) niczego nie kosztują.
        client.llmCallLog.count({ where: { ...where, status: "OK", costUsd: null } }),
      ]);
      return { totalUsd: Number(sum._sum.costUsd?.toString() ?? 0), unknownCalls: unknown };
    },

    async getMainVariant(projectId) {
      const row = await client.bmcVariant.findFirst({
        where: { projectId, isMain: true },
        select: { id: true, version: true, state: true },
      });
      if (!row) return null;
      const state = BmcState.safeParse(row.state);
      if (!state.success) {
        throw new Error(`Niepoprawny stan BMC w wariancie ${row.id}.`);
      }
      return { id: row.id, version: row.version, state: state.data };
    },

    async listPendingProposalIds(projectId, variantId) {
      const rows = await client.proposal.findMany({
        where: { variantId, variant: { projectId }, status: "PENDING" },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { id: true },
      });
      return rows.map((row) => row.id);
    },
  };
}
