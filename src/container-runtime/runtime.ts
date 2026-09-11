import { cliRuntimeAdapter } from "./cli-runtime-adapter";
import type { RuntimeAdapter } from "./runtime-adapter";

/** Process-wide Container Runtime adapter. Tests replace this module with a fake. */
export const runtimeAdapter: RuntimeAdapter = cliRuntimeAdapter;
