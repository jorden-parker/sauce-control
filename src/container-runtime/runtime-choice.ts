import type { RuntimeAdapter } from "./runtime-adapter";
import {
  type InstalledRuntime,
  RUNTIME_NAMES,
  type RuntimeName,
  type RuntimeStatus,
} from "./runtime-status";

/**
 * What the tool should do given the saved Container Runtime and what is
 * installed. Rules follow ADR 0001.
 */
export type RuntimeChoice =
  | { kind: "choose"; candidates: InstalledRuntime[] }
  | { kind: "none" }
  | {
      kind: "saved-missing";
      candidates: InstalledRuntime[];
      saved: RuntimeName;
    }
  | { kind: "use"; runtime: InstalledRuntime };

export const resolveRuntimeChoice = ({
  saved,
  statuses,
}: {
  saved: RuntimeName | undefined;
  statuses: readonly RuntimeStatus[];
}): RuntimeChoice => {
  const candidates = statuses.filter(
      (status): status is InstalledRuntime => status.installed
    ),
    savedRuntime = candidates.find((status) => status.name === saved);
  if (savedRuntime) {
    return { kind: "use", runtime: savedRuntime };
  }
  if (saved !== undefined) {
    return { candidates, kind: "saved-missing", saved };
  }
  const [only] = candidates;
  if (only && candidates.length === 1) {
    return { kind: "use", runtime: only };
  }
  if (candidates.length === 0) {
    return { kind: "none" };
  }
  return { candidates, kind: "choose" };
};

/** Detect every known runtime through the adapter and apply the choice rules. */
export const loadRuntimeChoice = async (
  adapter: Pick<RuntimeAdapter, "detect">,
  saved: RuntimeName | undefined
): Promise<RuntimeChoice> =>
  resolveRuntimeChoice({
    saved,
    statuses: await Promise.all(
      RUNTIME_NAMES.map((name) => adapter.detect(name))
    ),
  });
