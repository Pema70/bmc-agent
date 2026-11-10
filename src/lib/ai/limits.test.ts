import { beforeEach, describe, expect, it, vi } from "vitest";

const { count, aggregate, findFirst } = vi.hoisted(() => ({
  count: vi.fn(),
  aggregate: vi.fn(),
  findFirst: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({ prisma: { llmCallLog: { count, aggregate, findFirst } } }));

import { checkUserLimits } from "@/lib/ai/limits";

const now = new Date("2026-11-10T12:00:00Z");
const limits = {
  maxSteps: 3,
  maxRequestsPerHour: 30,
  maxTokensPerDay: 1000,
  maxOutputTokens: 2000,
  maxMessageChars: 4000,
  historyLimit: 30,
  maxPendingProposals: 20,
};

function usage(requests: number, input: number | null, output: number | null) {
  count.mockResolvedValue(requests);
  aggregate.mockResolvedValue({ _sum: { inputTokens: input, outputTokens: output } });
}

beforeEach(() => {
  vi.clearAllMocks();
  findFirst.mockResolvedValue({ createdAt: new Date("2026-11-10T11:30:00Z") });
});

describe("checkUserLimits", () => {
  it("przepuszcza użytkownika poniżej limitów", async () => {
    usage(5, 100, 200);

    expect(await checkUserLimits("u1", now, limits)).toEqual({ ok: true });
    expect(count).toHaveBeenCalledWith({ where: { userId: "u1", createdAt: { gte: new Date("2026-11-10T11:00:00Z") } } });
  });

  it("przepuszcza użytkownika bez historii (sumy null)", async () => {
    usage(0, null, null);

    expect(await checkUserLimits("u1", now, limits)).toEqual({ ok: true });
  });

  it("blokuje po przekroczeniu limitu zapytań na godzinę i podaje czas oczekiwania", async () => {
    usage(30, 0, 0);

    const result = await checkUserLimits("u1", now, limits);

    expect(result).toMatchObject({ ok: false, error: "REQUESTS", retryAfterSec: 30 * 60 });
    expect(result.ok === false && result.message).toContain("30 min");
  });

  it("blokuje po przekroczeniu dziennego limitu tokenów", async () => {
    usage(1, 600, 400);
    findFirst.mockResolvedValue({ createdAt: new Date("2026-11-10T00:00:00Z") });

    const result = await checkUserLimits("u1", now, limits);

    expect(result).toMatchObject({ ok: false, error: "TOKENS", retryAfterSec: 12 * 3600 });
  });

  it("sprawdza tylko własne wywołania użytkownika", async () => {
    usage(0, 0, 0);

    await checkUserLimits("u2", now, limits);

    expect(aggregate).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ userId: "u2" }) }));
  });
});
