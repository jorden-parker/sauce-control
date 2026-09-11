# 11: Schema Sources and manual Scenarios

**What to build:** A reviewer attaches an OpenAPI Schema Source by upload, URL, or another Repository, or detects one in the current Repository or Code Directory. Matching Endpoints get Scenarios generated from the real contract. A reviewer can also hand-edit a Scenario.

**Blocked by:** 10 (Recorded and inferred Scenarios)

**Status:** ready-for-agent

- [ ] Schema Sources listed on the Repository Config: upload, URL, or `owner/repo` path within the Organisation
- [ ] One-click detection scans the current Repository clone and the Code Directory for `openapi.*` and `swagger.*`; no Organisation-wide GitHub scan
- [ ] Endpoints matched to spec paths by path pattern, ignoring host
- [ ] Unmatched Endpoints keep the inferred schema
- [ ] Manual Scenario editor for per-Endpoint responses
- [ ] Comparison Runner tests with a fixture spec assert contract-derived Scenarios and the fallback
