# Sauce Control

A local tool that compares a branch of a GitHub repository against its base branch by running both, detecting which pages a change affects, and showing visual and interactive differences side by side.

## Language

**Organisation**:
The GitHub organisation whose repositories are available for comparison. Saved once, reused across sessions.
_Avoid_: Org, owner, account

**Repository**:
A GitHub repository within the Organisation, selected for a Comparison.
_Avoid_: Repo, project

**Base Branch**:
The branch a Target Branch is compared against. Defaults to the Repository's default branch.
_Avoid_: Main, master, source, trunk

**Target Branch**:
The branch under review, containing the changes being compared against the Base Branch.
_Avoid_: Feature branch, head, PR branch

**Comparison**:
A Base Branch and Target Branch of one Repository considered together, with everything derived from them.
_Avoid_: Diff, review, session

**Instance**:
A locally built and running copy of the application from one branch of a Comparison. Every Comparison has exactly two: one per branch.
_Avoid_: Deployment, server, preview, environment

**Leftover**:
An Instance, its image, or its clone directory whose owning Sauce Control process has exited. Removed when Sauce Control starts and when it exits.
_Avoid_: Orphan, stale container, zombie

**Container Runtime**:
The user's chosen engine for running Instances: Docker or Podman.
_Avoid_: Docker (as a generic term), engine, backend

**Viewport**:
A named device size (width, height, scale) at which Pages are captured and displayed, with a matching device frame.
_Avoid_: Device, breakpoint, resolution, frame

**Page**:
A URL path served by an Instance, discovered from the sitemap or by crawling.
_Avoid_: Route, screen, URL

**Affected Page**:
A Page whose loaded source modules include at least one file changed between Base Branch and Target Branch.
_Avoid_: Changed page, impacted route

**Endpoint**:
An outbound HTTP API the application calls at runtime, discovered by observing an Instance's traffic.
_Avoid_: API, service, dependency, upstream

**Page State**:
A Page plus the interaction sequence needed to reach a non-navigating UI state, such as an open modal or a selected tab.
_Avoid_: Sub-page, view, modal state

**Capture Pair**:
The Base and Target screenshots of one Page or Page State at one Viewport under one Scenario, together with their pixel diff.
_Avoid_: Snapshot, screenshot pair, diff row

**Code Directory**:
An optional local folder where the user keeps checkouts. Read-only; used to find Schema Sources and speed up clones. Repositories absent from it are fetched from GitHub as normal.
_Avoid_: Workspace, source root, projects folder

**Schema Source**:
An optional OpenAPI document, from this Repository or another, used to generate Scenarios for matching Endpoints.
_Avoid_: Spec, contract, API definition

**Scenario**:
A named set of mocked Endpoint responses applied identically to both Instances, such as `recorded`, `empty`, or `error`.
_Avoid_: Mock, fixture, use case, variant
