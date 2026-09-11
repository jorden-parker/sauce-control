# 10: Recorded and inferred Scenarios

**What to build:** A reviewer picks a Scenario and both Instances receive identical mocked Endpoint responses. The `recorded` Scenario replays Base responses; `empty`, `error`, and `slow` are generated from the inferred schema.

**Blocked by:** 09 (Endpoint recording)

**Status:** ready-for-agent

- [ ] `recorded` Scenario built from the Base Instance's responses
- [ ] JSON schema inferred from recorded responses per Endpoint
- [ ] `empty`, `error`, and `slow` variants derived mechanically from the schema
- [ ] Proxy answers matched Endpoint requests from the active Scenario for both Instances
- [ ] Scenario selector in the Comparison setup
- [ ] Proxy tests cover Scenario application; Comparison Runner tests assert generated Scenarios for the fixture
