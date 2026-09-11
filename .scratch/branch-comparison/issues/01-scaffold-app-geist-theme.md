# 01: Scaffold app with Geist theme

**What to build:** A reviewer opens the tool locally, sees a Geist-styled settings page, saves their GitHub Organisation, restarts the tool, and finds it still saved.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Next.js App Router application with shadcn/ui components themed with Geist tokens and the Geist font
- [ ] SQLite persistence and an OS keychain wrapper are available to later tickets
- [ ] All listening sockets bind `127.0.0.1` only
- [ ] Settings page saves the Organisation and reloads it after restart
- [ ] Playwright UI test covers saving and reloading the Organisation
