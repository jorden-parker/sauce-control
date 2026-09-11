# 10: Recorded and inferred Scenarios

**What to build:** A reviewer picks a Scenario and both Instances receive identical mocked Endpoint responses. The `recorded` Scenario replays Base responses; `empty`, `error`, and `slow` are generated from the inferred schema.

**Blocked by:** 09 (Endpoint recording)

**Status:** in-review

- [x] `recorded` Scenario built from the Base Instance's responses
- [x] JSON schema inferred from recorded responses per Endpoint
- [x] `empty`, `error`, and `slow` variants derived mechanically from the schema
- [x] Proxy answers matched Endpoint requests from the active Scenario for both Instances
- [x] Scenario selector in the Comparison setup
- [x] Proxy tests cover Scenario application; Comparison Runner tests assert generated Scenarios for the fixture

## Comments

2026-09-11: Implemented test-first at the three boundaries the user confirmed: the Comparison Runner with the fixture Repository and fake Container Runtime (`src/comparison/scenarios.test.ts`), the Proxy over HTTP (`src/proxy/proxy.test.ts`), and Comparison setup in Playwright (`e2e/scenarios.spec.ts`). Each new behavior was observed failing before implementation.

Every running Comparison collects its own Base responses in memory, independently of persisted recordings. `scenarios()` generates `recorded`, `empty`, `error`, and `slow`. JSON schemas merge all Base samples per Endpoint, including every array item, optional object properties, nullable and mixed types, and integer/number widening. Empty values retain object shape with empty arrays, strings, zeroes, false, or null as appropriate; mixed types use the first observed alternative. Error returns HTTP 500 with `{"error":"Scenario error"}`; slow replays the recorded response after three seconds. Non-JSON responses replay unchanged and have no inferred schema. Binary bodies retain their original bytes. Credential and transport headers are excluded from generated responses.

The Comparison setup offers the four Scenarios, defaulting to `recorded`. Discovery and Affected Page detection run against real Endpoints first. The runner then activates the selected Scenario on both Proxy ports before exposing the embedded Instances. The status names the active Scenario and how many Endpoints it mocks. Mock responses are not added to recordings; the Proxy recomputes framing, prevents cookie installation and caching, and rewrites recorded redirects through its Endpoint route.

Matching follows the existing Endpoint identity: method, origin, and path with numeric/UUID segments collapsed. The first Base response for each identity is replayed deterministically to both Instances; query strings and request bodies do not distinguish responses. Unmatched Endpoints continue live through the existing local-address guard. Calls made inside the container remain outside Scenario control, as specified in ADR 0005. Choose another Scenario by stopping and running again.

The publishing commit uses the existing fixture and Container Runtime interfaces. Compatibility edits for the concurrent development-container work remain with that work.

Verification: 25 tests pass in `src/comparison/scenarios.test.ts` and `src/proxy/proxy.test.ts`; the new Playwright test passes, including actual empty response data in both frames. `pnpm typecheck`, scoped oxlint, scoped oxfmt checks, and `git diff --check` pass. Full-suite run: 175 passing tests, two skipped, and two Docker smoke failures during dependency installation in the concurrent container changes (before the final additional mixed-scalar test). Full Playwright run: 10 pass, one existing Repository Config test fails because it still expects the renamed `Build command` field. Full lint also reports errors in the concurrent environment-files/runtime work; the ticket's files pass lint. The optional agent-browser CLI is not installed; browser verification used the project's Chromium/Playwright suite.

Publishing verification: isolated ticket 10 from the concurrent Environment File changes. All 164 unit/integration tests pass (two skipped), all 11 Playwright tests pass, and typecheck, full lint, and full format checks pass.
