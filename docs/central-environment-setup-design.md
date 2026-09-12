# Central Environment Setup Command

Status: accepted and implemented.

The Environment Setup Command should be configured centrally and reused across Repositories. The previous per-Repository location does not fit the user's company-wide authentication workflow.

## Settled decisions

- Configure one shared Environment Setup Command in Settings, alongside other central configuration.
- Provide a link from Compare to its Settings location.
- The command applies across the whole local app, including after changing GitHub Organisation. There are no named setup profiles.
- Automatically run the shared command once before every new Comparison. An empty command disables setup; no per-Comparison switch is offered.
- Keep existing host execution, export capture and merge precedence, shared snapshots, restart reuse, credential handling, timeout and cancellation behavior.
- Remove the Environment Setup Command field from Repository configuration.
- If existing Repository configurations contain one distinct non-empty command, migrate it automatically into Settings. If none exist, leave setup empty.
- If several distinct non-empty commands exist, show them in Settings and require the user to choose or edit the shared command before starting another Comparison. An explicitly saved empty command resolves migration by disabling setup.
- Once a shared setting has been saved or migrated, it is authoritative. Clearing it must not reactivate an old Repository command.

## User flow

Settings contains an Environment Setup Command field and save control, explaining that it applies to all Repositories and Organisations. Compare always provides a link to that section, including when setup is empty or migration needs attention. Migration conflicts explain why Run is unavailable and link to Settings for resolution.

Saving changes affects the next Comparison; an existing Comparison and its Instance restarts retain their snapshot. Save command text only, never captured variable values.

## Verification

Verify persistence across Repository and Organisation changes, empty-command disabling, migration of identical commands, conflict resolution, and no fallback to old commands after saving shared setup. Check the Settings save flow, Compare link, conflict blocker and removal of the Repository field in the browser. Retain existing tests for execution and credential delivery.

Verification passed: Settings save/reload, Compare navigation, removal of the Repository field, migration conflict selection, Organisation changes and empty-command persistence in the browser. Settings and startup tests cover automatic migration, shared execution across Repositories and server-side conflict blocking.
