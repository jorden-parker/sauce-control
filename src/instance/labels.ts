/** Labels stamped onto every container and image this tool creates, so cleanup can find them without state. */
export const APP_LABEL = "sauce-control.app",
  BRANCH_LABEL = "sauce-control.branch",
  REPOSITORY_LABEL = "sauce-control.repository",
  SESSION_LABEL = "sauce-control.session";

const DEFAULT_APP = "sauce-control";

/**
 * Which Sauce Control owns an Instance. One process owns everything carrying its value, so a
 * second copy (the Playwright suite) sets SAUCE_CONTROL_APP_LABEL to keep out of the first one's way.
 */
export const appLabelValue = (): string =>
  process.env.SAUCE_CONTROL_APP_LABEL ?? DEFAULT_APP;

/** The `key=value` filter selecting every container or image this Sauce Control owns. */
export const appLabel = (): string => `${APP_LABEL}=${appLabelValue()}`;
