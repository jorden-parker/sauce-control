export type RuntimeName = "docker" | "podman";

export const RUNTIME_NAMES: readonly RuntimeName[] = ["docker", "podman"];

/** What the shared CLI surface reports about one Container Runtime. */
export type RuntimeStatus =
  | { installed: false; name: RuntimeName }
  | { installed: true; name: RuntimeName; running: boolean; version: string };

export type InstalledRuntime = Extract<RuntimeStatus, { installed: true }>;

export const isRuntimeName = (value: string): value is RuntimeName =>
  (RUNTIME_NAMES as readonly string[]).includes(value);
