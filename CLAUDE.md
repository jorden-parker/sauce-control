# Sauce Control

A local tool that compares a branch of a GitHub repository against its base branch: runs both in isolated containers, detects affected pages, and shows visual and interactive differences side by side.

## Agent skills

### Issue tracker

Issues live as markdown files under `.scratch/<feature>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary, label strings equal to role names. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
