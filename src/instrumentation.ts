/** Runs once per server start: crash recovery sweep and exit cleanup for Instances. */
export const register = async (): Promise<void> => {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { bootstrapSession } = await import("./instance/session-bootstrap");
    await bootstrapSession();
  }
};
