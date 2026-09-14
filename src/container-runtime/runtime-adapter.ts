import type { RuntimeName, RuntimeStatus } from "./runtime-status";

export interface BuildRequest {
  signal?: AbortSignal;
  /** Directory sent as the build context; never written to. */
  context: string;
  /** Inline Dockerfile when the Repository has none; otherwise the context's own. */
  dockerfile: string | undefined;
  labels: Record<string, string>;
  /**
   * Build-time secrets exposed to `RUN --mount=type=secret,id=<id>` steps only.
   * They never enter image layers, arguments or the saved build context.
   */
  secrets?: BuildSecret[];
  tag: string;
}

export interface BuildSecret {
  /** Mount id inside the Dockerfile, e.g. `NODE_AUTH_TOKEN`. */
  id: string;
  value: string;
}

export interface RunRequest {
  signal?: AbortSignal;
  onProgress?: (step: "install" | "start") => void;
  /** Reports failure before owned-container cleanup finishes. */
  onFailure?: (error: unknown) => void;
  development?: { installCommand: string; startCommand: string };
  environment: Record<string, string>;
  /** Host setup exports also available to installation. */
  setupEnvironment?: Record<string, string>;
  image: string;
  labels: Record<string, string>;
  /** The port the application listens on inside the container. */
  port: number;
}

/** What `inspect` reports about one container, trimmed to what the tool shows and cleans. */
export interface ContainerDetails {
  containerId: string;
  /** ISO timestamp of creation. */
  createdAt: string;
  /** Loopback host port published to `port`, when the container is running. */
  hostPort: number | undefined;
  labels: Record<string, string>;
  state: "running" | "stopped";
}

export interface RunningContainer {
  containerId: string;
  /** Loopback host port published to the container port. */
  hostPort: number;
}

/** Drives one Container Runtime through its shared CLI surface. */
export interface RuntimeAdapter {
  /** Builds an image from a read-only context. */
  buildImage: (name: RuntimeName, request: BuildRequest) => Promise<void>;
  /** Installed? Version? Running? Never throws for an absent binary. */
  detect: (name: RuntimeName, signal?: AbortSignal) => Promise<RuntimeStatus>;
  /** Whether something inside the container listens on `port`. */
  isListening: (
    name: RuntimeName,
    containerId: string,
    port: number,
    signal?: AbortSignal
  ) => Promise<boolean>;
  /** Details of the containers; missing ids are skipped. */
  inspectContainers: (
    name: RuntimeName,
    containerIds: string[]
  ) => Promise<ContainerDetails[]>;
  /** Ids of containers, running or not, carrying the label (`key` or `key=value`). */
  listContainers: (name: RuntimeName, label: string) => Promise<string[]>;
  /** Removes every unused image carrying the label (`key` or `key=value`). */
  removeImages: (name: RuntimeName, label: string) => Promise<void>;
  /** Force-removes the containers; missing ids are not an error. */
  removeContainers: (
    name: RuntimeName,
    containerIds: string[]
  ) => Promise<void>;
  /** Starts a hardened detached container. */
  runContainer: (
    name: RuntimeName,
    request: RunRequest
  ) => Promise<RunningContainer>;
  /** Starts stopped containers again; they keep their image, labels, and id. */
  startContainers: (name: RuntimeName, containerIds: string[]) => Promise<void>;
  /** Stops running containers without removing them. */
  stopContainers: (name: RuntimeName, containerIds: string[]) => Promise<void>;
  /** Kick off the runtime's VM/daemon (`podman machine start`, Docker Desktop). Resolves when the command returns, not when ready. */
  start: (name: RuntimeName) => Promise<void>;
}
