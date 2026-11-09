import { describe, expect, it } from "vitest";
import { APP_DESCRIPTION, APP_NAME } from "@/lib/app-info";

// Test kontrolny: sprawdza, że Vitest działa i rozwiązuje alias "@/".
describe("app-info", () => {
  it("udostępnia nazwę i opis aplikacji", () => {
    expect(APP_NAME).toBe("BMC Agent");
    expect(APP_DESCRIPTION.length).toBeGreaterThan(0);
  });
});
