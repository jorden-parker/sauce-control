# 05: Two Instances behind the Proxy

**What to build:** A reviewer runs a Comparison and both Base and Target Instances come up, each reachable through the tool's Proxy. Logging in on one applies to the other. Timestamps and random values are identical across both. Animations are disabled.

**Blocked by:** 04 (Build and run one Instance)

**Status:** ready-for-agent

- [ ] Both branches built and run concurrently, each on `localhost:3000` in its own container
- [ ] Proxy routes to either Instance by path or header and rewrites HTML to inject scripts
- [ ] One shared cookie jar across both Instances
- [ ] Injected deterministic `Date.now` and seeded `Math.random`
- [ ] Injected stylesheet disables CSS animations and transitions
- [ ] Proxy tests run against a fixture upstream and cover routing, injection, cookie sharing, and the determinism shims
