# 02: GitHub access and Repository / Target Branch ComboBoxes

**What to build:** A reviewer picks a Repository from a searchable ComboBox listing the Organisation's repositories, then a Target Branch from a searchable ComboBox, and sees the Base Branch pre-filled with the default branch and overridable.

**Blocked by:** 01 (Scaffold app with Geist theme)

**Status:** in-progress

- [ ] Token comes from `gh auth token` when available, otherwise from a personal access token pasted in settings and stored in the keychain, never in SQLite or logs
- [ ] Repository ComboBox searches the Organisation's repositories
- [ ] Target Branch ComboBox searches the selected Repository's branches
- [ ] Base Branch defaults to the Repository default branch and can be overridden
- [ ] Selection is persisted as the start of a Comparison
- [ ] Playwright UI test with the GitHub client stubbed covers both ComboBoxes and the Base Branch override
