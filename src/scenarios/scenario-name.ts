export const SCENARIO_NAMES = ["recorded", "empty", "error", "slow"] as const;
export type ScenarioName = (typeof SCENARIO_NAMES)[number];

export const isScenarioName = (name: string): name is ScenarioName =>
  SCENARIO_NAMES.some((candidate) => candidate === name);
