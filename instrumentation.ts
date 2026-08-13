/**
 * Boot hook. All real work lives in instrumentation-node.ts, imported behind
 * an inline NEXT_RUNTIME check: the check is a build-time constant, so the
 * Edge bundle dead-code-eliminates the import and never tries to compile the
 * Node-only dependency graph behind it (prisma → pg).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { onServerBoot } = await import("./instrumentation-node")
    void onServerBoot()
  }
}
