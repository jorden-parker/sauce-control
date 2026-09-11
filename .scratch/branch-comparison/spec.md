# Spec: Branch Comparison

Status: ready-for-agent

## Problem Statement

Reviewing a branch today means reading a diff and guessing which pages it touches, then manually opening two deployments and clicking around both. Screens drift apart silently: a shared component change ripples into dozens of pages nobody checked, and differing API data makes every visual comparison noisy. Reviewers cannot see both versions react to the same interaction at the same time.

## Solution

Sauce Control is a local tool that takes a GitHub Repository, a Target Branch, and its Base Branch, runs both as isolated Instances, and produces a Comparison. The Comparison lists the Affected Pages (pages that load a changed file), captures each at chosen Viewports under chosen Scenarios (identical mocked Endpoint data), and presents Capture Pairs side by side, as a pixel-diff overlay, and as a slider. Alongside the report, both Instances are embedded in device frames and every interaction in one is replayed in the other, so a reviewer can drive both branches at once.

## User Stories

### Setup

1. As a reviewer, I want to save my GitHub Organisation once, so that every later session starts from my team's Repositories.
2. As a reviewer, I want the tool to reuse my existing `gh` login, so that I do not have to create or paste a token.
3. As a reviewer without `gh`, I want to paste a personal access token that is stored in the OS keychain, so that my credential never sits in a plain file.
4. As a reviewer, I want to choose between Docker and Podman as the Container Runtime, so that I can use whichever my workplace permits.
5. As a reviewer with both runtimes installed, I want to see each one's version and running state before choosing, so that I do not accidentally use the one that happens to be running.
6. As a reviewer, I want the tool to offer to start a stopped runtime, so that I do not have to leave the app to fix it.
7. As a reviewer, I want to optionally set a Code Directory, so that clones are faster and Schema Sources can be found on disk without GitHub calls.
8. As a reviewer, I want Repositories missing from my Code Directory to still work, so that the setting is a convenience and not a requirement.

### Selecting what to compare

9. As a reviewer, I want to pick a Repository from a ComboBox that searches the Organisation's repositories, so that I can find it quickly in a large org.
10. As a reviewer, I want to pick a Target Branch from a ComboBox that searches the Repository's branches, so that I can find the branch I am reviewing.
11. As a reviewer, I want the Base Branch to default to the Repository's default branch, so that the common case needs no extra input.
12. As a reviewer, I want to override the Base Branch, so that I can compare against a release or staging branch.
13. As a reviewer, I want to configure the build command, start command, and port once per Repository, with values pre-filled from the package manifest, so that framework differences do not need repeated setup.
14. As a reviewer, I want a warning when the start command looks like a production server, so that I know Affected Page detection may degrade.
15. As a reviewer, I want to paste environment variables per Repository, stored in the keychain, so that Instances can run without leaking secrets to disk.
16. As a reviewer, I want an explicit opt-in checkbox with a warning to use the clone's `.env.local`, so that I can choose convenience knowingly.
17. As a reviewer, I want to pick which Viewports a Comparison captures, from presets and my own custom sizes, so that I check the devices my users have.
18. As a reviewer, I want to pick which Scenarios a Comparison captures, so that I can check empty, error, and recorded states without extra runs.
19. As a reviewer, I want to start a Comparison manually with a Run button, so that I control when a multi-minute build happens.

### Running

20. As a reviewer, I want to see progress stages (clone, build, crawl, capture, diff) with the current one highlighted, so that a long run does not feel stuck.
21. As a reviewer, I want each Instance to genuinely listen on `localhost:3000` inside its container, so that apps with hard-coded OAuth redirect URIs work.
22. As a reviewer, I want both Instances to share a cookie jar, so that logging in once applies to both.
23. As a reviewer, I want time and randomness to be deterministic in both Instances, so that diffs are not noise from timestamps or random IDs.
24. As a reviewer, I want CSS animations disabled during capture, so that screenshots are stable.
25. As a reviewer, I want a clear error with the fix when the Container Runtime is not running, so that I am not left guessing.
26. As a reviewer, I want every container, browser, and proxy to be terminated when the tool exits, so that nothing keeps running or listening after I close it.
27. As a reviewer, I want leftover containers from a crashed previous session to be removed on startup, so that a crash never leaks resources.

### Discovery

28. As a reviewer, I want Pages discovered from the sitemap when present, so that discovery is fast and complete.
29. As a reviewer, I want Pages discovered by crawling the accessibility tree, so that apps built with react-aria (where links and buttons are not anchor tags) are fully explored.
30. As a reviewer, I want non-navigating interactions such as modals and tabs recorded as Page States, so that dialogs get compared too.
31. As a reviewer, I want crawl depth, page limit, query stripping, and numeric-segment collapsing to be configurable per Repository, so that large apps stay bounded.
32. As a reviewer, I want to add or remove Pages by hand, so that discovery gaps do not block me.
33. As a reviewer, I want the Comparison to list only Affected Pages by default, so that I focus on what the change could have touched.
34. As a reviewer, I want a banner when source maps are missing and all Pages are being compared, so that degraded detection is never silent.
35. As a reviewer, I want Endpoints discovered from real traffic while crawling, so that discovery works for any framework and dynamic URLs.
36. As a reviewer, I want `Authorization` and `Cookie` headers always redacted from recordings, so that credentials never persist.
37. As a reviewer, I want a warning that recordings may contain personal data and a purge button, so that I can clean up responsibly.

### Scenarios

38. As a reviewer, I want a `recorded` Scenario built from the Base Instance's real responses, so that both Instances see identical data.
39. As a reviewer, I want `empty`, `error`, and `slow` Scenarios generated from the recorded responses' inferred schema, so that edge states are covered without manual work.
40. As a reviewer, I want to attach an optional Schema Source (upload, URL, or another Repository in the Organisation), so that Scenarios for matching Endpoints are generated from the real API contract.
41. As a reviewer, I want one-click detection of OpenAPI files in the current Repository or the Code Directory, so that I do not have to know the path.
42. As a reviewer, I want Endpoints matched to a Schema Source by path pattern rather than host, so that local and spec server URLs do not need to agree.
43. As a reviewer, I want to write a manual Scenario by editing responses, so that I can reproduce a specific bug report.

### Reviewing the report

44. As a reviewer, I want the report listed by Affected Page, so that the top level is short and meaningful.
45. As a reviewer, I want to expand a Page and toggle Viewport and Scenario, so that I can drill in without a wall of images.
46. As a reviewer, I want a side-by-side view of a Capture Pair, so that I can compare directly.
47. As a reviewer, I want a unified diff view that overlays changed pixels in magenta on the Target capture, so that I can see where a change landed at a glance.
48. As a reviewer, I want a slider view that wipes between Base and Target, so that I can inspect subtle shifts.
49. As a reviewer, I want each Capture Pair to show the percentage of changed pixels, so that I can sort and skip trivial ones.
50. As a reviewer, I want captures displayed inside a device frame matching the Viewport, so that context is obvious.
51. As a reviewer, I want past Comparisons kept, so that I can revisit a run or compare to a previous one.

### Embedded Instances

52. As a reviewer, I want both Instances embedded side by side in device frames, so that I can use the real apps, not just screenshots.
53. As a reviewer, I want the same Viewport toggle to resize both embedded Instances and the report captures, so that one control drives everything.
54. As a reviewer, I want navigation, clicks, text input, focus, hover, and scroll in one Instance replayed in the other, so that both stay in the same state.
55. As a reviewer, I want replay to target elements by accessibility role and name first, then test id, then CSS path, so that moved or restyled elements still match.
56. As a reviewer, I want a desync badge when the replayed element cannot be found in the sibling, so that I know the branches diverged rather than the tool failed.

### Look and feel

57. As a reviewer, I want the tool to follow Vercel's Geist Design System, so that it feels like the rest of my Vercel-adjacent tooling.

## Implementation Decisions

- **Architecture**: a local Next.js application (App Router) with shadcn/ui components themed with Geist tokens and the Geist font. Persistence in SQLite; secrets (tokens, environment variables) in the OS keychain. All servers bind `127.0.0.1` only.
- **Modules**:
  - **Settings**: Organisation, Container Runtime, Code Directory, GitHub credential source.
  - **Repository Config**: build/start commands, port, environment variable policy, crawl limits, Viewport set, Schema Sources.
  - **GitHub Client**: lists repositories and branches, resolves default branch, clones over HTTPS using the `gh` token or keychain PAT. Uses the Code Directory checkout as a clone reference when present.
  - **Container Runtime adapter**: shells out to `docker` or `podman` through the shared CLI surface only. Detects installed runtimes, versions, and running state; can start a stopped one. Labels containers with a session id; removes by label on exit and sweeps on startup. Containers run with no host network, all capabilities dropped, memory and CPU caps, and a read-only build context. Uses the repository Dockerfile if present, otherwise generates one from the configured commands.
  - **Instance Builder**: clones both branches, builds and starts one container per branch, waits for readiness on port 3000 inside each container.
  - **Proxy**: sits in front of both Instances. Injects the sync script, deterministic `Date.now` and seeded `Math.random`, and an animation-disabling stylesheet; shares one cookie jar across both; records outbound Endpoint traffic with `Authorization` and `Cookie` redacted; applies the active Scenario by answering matched Endpoint requests from mocks.
  - **Crawler**: uses Playwright. Seeds from `sitemap.xml` when present, then walks the accessibility tree clicking nodes with roles `link`, `button`, `menuitem`, `tab`, `option`. URL changes produce Pages; non-navigating changes produce Page States with the interaction sequence to reach them. Applies the Repository's crawl limits.
  - **Affected Page detector**: records loaded modules per Page via source maps and intersects with the changed-file list between Base and Target. Missing source maps or non-module changes fall back to all Pages and raise the banner.
  - **Scenario Generator**: infers JSON schema from recorded responses; derives `empty`, `error`, and `slow` variants; uses an attached Schema Source (matched by path pattern) where available; stores manual Scenarios.
  - **Capture Engine**: Playwright screenshots per Page or Page State, Viewport, and Scenario against each Instance; pixel diff with a changed-pixel percentage and a magenta overlay image; images stored on disk keyed by content hash.
  - **Comparison Runner**: orchestrates the above into a Comparison with progress stages, and is the primary testing seam.
  - **UI**: Organisation setup, Repository and Target Branch ComboBoxes, Repository Config, Run screen with stages, Report (Page list, Viewport/Scenario toggles, side-by-side, overlay, slider), Embedded Instances with sync and desync badge, shared Viewport toggle and device frame component reused by both report and embed.
- **Sync protocol**: injected script serialises events (navigation, click, input, focus, hover, scroll) with a target descriptor (role and accessible name, then test id, then CSS path) and posts them to the parent window, which forwards them to the sibling frame. The receiver resolves the descriptor in order and reports a desync when none match.
- **Runtime choice rules**: one runtime installed is used silently; both installed prompts once with version and state shown and nothing preselected, saving the choice; a saved runtime later missing prompts explicitly. See ADR 0001.
- **Detection strategy**: runtime over static analysis. See ADR 0002.

## Testing Decisions

- A good test drives a seam with realistic inputs and asserts on observable outputs: the Comparison produced, the HTTP responses served, the pixels on screen. Tests never assert on internal module calls.
- **Comparison Runner** is tested with a fixture Repository (a tiny static app with two branches and known changed files) and a fake Container Runtime adapter that serves the fixture directly. Assertions cover discovered Pages and Page States, Affected Pages, Endpoints, generated Scenarios, and Capture Pairs including diff percentages.
- **Proxy** is tested as a plain HTTP server against a fixture upstream: script injection, cookie sharing, determinism shims, header redaction, Scenario application, and recording.
- **UI** is tested with Playwright against the running Next.js app with the Comparison Runner stubbed: ComboBox search and selection, Viewport toggle driving both frames and captures, the three diff views, and sync replay including the desync badge.
- The real Container Runtime adapter has one smoke test per runtime, skipped when that runtime is absent, covering start, label cleanup, and startup sweep.
- No prior art exists; the repository is new.

## Out of Scope

- Hosted or multi-tenant deployment, GitHub OAuth login.
- Static analysis of routes or types; framework-specific route conventions.
- Inbound API route testing (mocking requests to the application's own API routes).
- Encryption at rest for recordings.
- Frameworks beyond whatever runs under the configured start command; no special handling for any framework.
- A background watchdog process; startup sweep is the crash recovery mechanism.
- Comparing more than two branches at once.

## Further Notes

- Vocabulary follows `CONTEXT.md`. Decisions with lasting consequences are in `docs/adr/0001` (container isolation and runtime choice) and `docs/adr/0002` (runtime detection).
- Docker and Podman on macOS each need a VM; the tool must check and explain rather than fail opaquely.
- Security is a first-order requirement: local-only binding, keychain secrets, hardened containers, redacted recordings, and guaranteed teardown are not optional polish.
