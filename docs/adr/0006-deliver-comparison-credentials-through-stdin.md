---
status: accepted
---

# Deliver Comparison credentials through stdin

Sauce Control sends a structured credential payload through stdin to a trusted launcher inside each Instance's container. The launcher gives dependency installation only `NODE_AUTH_TOKEN` from the merged Repository variables, and gives the development server the remaining values. Values must not appear in command arguments, container inspection configuration, images, saved settings or a separate secret store; files are parsed as data and never sourced as shell code.

This retains ADR 0001's shared Docker/Podman CLI approach while replacing ordinary environment flags for credential delivery. Native secret mechanisms have differing availability and storage behavior, and environment configuration fails the agreed inspection requirement. The launcher approach avoids that extra secret-store lifecycle, at the cost of owning launch, output handling and restart coordination.

Both Instances use one snapshot held only in Sauce Control process memory for the Comparison's lifetime. Individual restarts receive that same snapshot again. A new Comparison rereads the selected files. Runtime capability and non-exposure must be verified on both Docker and Podman with synthetic values; unsupported protection stops the run rather than triggering a weaker fallback. The consuming branch code and local administrators remain trusted, and output handling must address accidental logging of credentials.

This decision is implemented. Live Docker and Podman 6.1.1 verification on macOS passed, including saved Environment File delivery, npm installation, stage separation, inspection/history/log protection and restart reinjection. Adapter tests cover both CLI variants.

Suppress raw dependency-installation and development-server output. Expose only launcher-owned progress and safe error summaries; never forward raw child output into Sauce Control errors or runtime logs. This deliberately reduces debugging detail to protect credentials, including values an application prints in a transformed form.
