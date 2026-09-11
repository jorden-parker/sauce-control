# 09: Endpoint recording

**What to build:** While an Instance is used or crawled, the tool records every outbound Endpoint it calls and the responses, with credentials stripped. A reviewer sees the list, a warning about personal data, and a purge button.

**Blocked by:** 05 (Two Instances behind the Proxy)

**Status:** ready-for-agent

- [ ] Proxy captures outbound HTTP requests and responses from both Instances
- [ ] `Authorization` and `Cookie` headers are always redacted before storage
- [ ] Endpoints listed in the UI per Repository with method, path pattern, and sample count
- [ ] Warning that recordings may contain personal data and a purge button that deletes them
- [ ] Proxy tests cover capture, redaction, and purge
