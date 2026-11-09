import { defineConfig } from "prisma/config";
import { loadEnvFileIfExists } from "./src/lib/env/load-env-file";

loadEnvFileIfExists();

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env["DATABASE_URL"],
  },
});
