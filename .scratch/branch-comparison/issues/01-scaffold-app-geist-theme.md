# 01: Scaffold app with Geist theme

**What to build:** A reviewer opens the tool locally, sees a Geist-styled settings page, saves their GitHub Organisation, restarts the tool, and finds it still saved.

**Blocked by:** None (can start immediately)

**Status:** in-review

- [x] Next.js App Router application with shadcn/ui components themed with Geist tokens and the Geist font
- [x] SQLite persistence and an OS keychain wrapper are available to later tickets
- [x] All listening sockets bind `127.0.0.1` only
- [x] Settings page saves the Organisation and reloads it after restart
- [ ] Playwright UI test covers saving and reloading the Organisation

## Comments

2026-09-11: Implemented. Tests cover the settings store (SQLite via `node:sqlite`) and the keychain wrapper (through a fake adapter); the OS adapter uses `@napi-rs/keyring`. Loopback binding is enforced by `-H 127.0.0.1` in the dev and start scripts. Manually verified: saved an Organisation in the browser, restarted `next start`, value reloaded.
