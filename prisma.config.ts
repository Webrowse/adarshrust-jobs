import dotenv from "dotenv"
dotenv.config({ path: ".env.local" })
dotenv.config()

import { defineConfig } from "prisma/config"

// One URL everywhere now. Railway had a split between an internal address for
// the running app and a public proxy the build could reach; Neon is a single
// endpoint reachable from the local admin and from GitHub Actions alike.
export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: process.env["DATABASE_URL"],
  },
})
