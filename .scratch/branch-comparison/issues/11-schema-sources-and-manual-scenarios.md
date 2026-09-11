# 11: Schema Sources and manual Scenarios

**What to build:** A reviewer attaches an OpenAPI Schema Source by upload, URL, or another Repository, or detects one in the current Repository or Code Directory. Matching Endpoints get Scenarios generated from the real contract. A reviewer can also hand-edit a Scenario.

**Blocked by:** 10 (Recorded and inferred Scenarios)

**Status:** in-review

- [x] Schema Sources listed on the Repository Config: upload, URL, or `owner/repo` path within the Organisation
- [x] One-click detection scans the current Repository clone and the Code Directory for `openapi.*` and `swagger.*`; no Organisation-wide GitHub scan
- [x] Endpoints matched to spec paths by path pattern, ignoring host
- [x] Unmatched Endpoints keep the inferred schema
- [x] Manual Scenario editor for per-Endpoint responses
- [x] Comparison Runner tests with a fixture spec assert contract-derived Scenarios and the fallback

## Comments

2026-09-11: Implemented with red → green cycles at the user-confirmed Comparison Runner and Repository Config Playwright boundaries. Schema Sources accept JSON/YAML uploads, HTTP(S) URLs, and a named Repository/path in the saved Organisation. Local detection reads the current Comparison clones and the saved Code Directory, skips symbolic links and dependency folders, and bounds traversal. Sources and manual Scenarios persist per Repository in settings; Compare offers saved manual names and applies the selected responses to both Instances.

Contract generation supports OpenAPI 3 and Swagger 2 JSON response schemas, document-local references, object composition and enums. Matching uses HTTP method and path parameters, ignores hosts and prefers concrete paths. Unmatched Endpoints retain inferred schemas. External references must be bundled into the attached document (stated in the UI); this is a Scenario generator, not a complete OpenAPI schema validator. Detected or updated documents take effect on the next Comparison.

Validation: 11 Comparison Runner Scenario tests pass (six added), and all five new Playwright workflows pass. Typecheck, lint and formatting pass. The broad Vitest run had 195 passes, three skips and three failures outside this ticket: the existing UTF-8 error-text expectation and two real Docker smoke tests (container preparation and concurrent prune). The full browser run had 16 passes and one existing interaction-sync startup failure; its isolated retry passed (6.0 seconds).
