# 02: GitHub access and Repository / Target Branch ComboBoxes

**What to build:** A reviewer picks a Repository from a searchable ComboBox listing the Organisation's repositories, then a Target Branch from a searchable ComboBox, and sees the Base Branch pre-filled with the default branch and overridable.

**Blocked by:** 01 (Scaffold app with Geist theme)

**Status:** in-review

- [x] Token comes from `gh auth token` when available, otherwise from a personal access token pasted in settings and stored in the keychain, never in SQLite or logs
- [x] Repository ComboBox searches the Organisation's repositories
- [x] Target Branch ComboBox searches the selected Repository's branches
- [x] Base Branch defaults to the Repository default branch and can be overridden
- [x] Selection is persisted as the start of a Comparison
- [x] Playwright UI test with the GitHub client stubbed covers both ComboBoxes and the Base Branch override

## Comments

- Unit seams: `resolveGitHubToken` (gh first, keychain fallback), `createGitHubClient` (repositories, branches, Link pagination, error status), and `SettingsStore.saveComparisonSelection`.
- UI covered by `e2e/comparison-selection.spec.ts` with `SAUCE_CONTROL_GITHUB=stub` selecting `stubGitHubClient`. Run with `pnpm test:e2e`; it builds into `.next-e2e` so it can run beside `next dev`.
- Searching is client-side over the full list (all pages fetched). Revisit if an Organisation has thousands of repositories.
