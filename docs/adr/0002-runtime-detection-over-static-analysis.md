---
status: accepted
---

# Detect Affected Pages and Endpoints at runtime, not by static analysis

The tool must stay framework-agnostic, so it cannot rely on route file conventions or import graphs. Instead it crawls a running Instance via the accessibility tree, records which source modules each Page loads (via source maps and the dev server's module graph) to compute Affected Pages, and captures outbound HTTP traffic through the proxy to discover Endpoints and infer their response schemas.

## Consequences

- Route detection depends on source maps being served by the Instance; production builds without them degrade to "all Pages considered". The tool warns at Repository configuration when the start command looks like a production server, and shows a banner during a Comparison when source maps are missing so the degradation is never silent.
- Changes to non-module files (CSS-only, config) cannot be linked to Pages and also fall back to "all Pages considered".
- Crawls are bounded (depth, page count, query stripping, numeric segment collapsing) and configurable per Repository.
- Static analysis (TypeScript types next to fetch calls) is explicitly out of scope; an optional OpenAPI Schema Source covers the cases where inferred schemas are insufficient.
