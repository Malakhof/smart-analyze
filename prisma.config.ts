import { defineConfig } from "prisma/config";

// Load dotenv only in dev (not available in production Docker)
try { require("dotenv/config"); } catch {}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env["DATABASE_URL"]!,
  },
});
