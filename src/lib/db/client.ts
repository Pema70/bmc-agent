import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

function createPrismaClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("Brak zmiennej środowiskowej DATABASE_URL (patrz .env.example).");
  }
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

// Jeden klient na proces: w trybie dev hot reload tworzyłby nowe połączenia przy każdej zmianie.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
