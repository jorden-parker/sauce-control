import type { RuntimeName, RuntimeStatus } from "./runtime-status";

export interface BuildRequest {
  /** Directory sent as the build context; never written to. */
  context: string;
  /** Inline Dockerfile when the Repository has none; otherwise the context's own. */
  dockerfile: string | undefined;
  labels: Record<string, string>;
  tag: string;
}

export interface RunRequest {
  environment: Record<string, string>;
  image: string;
  labels: Record<string, string>;
  /** The port the application listens on inside the container. */
  port: number;
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
  detect: (name: RuntimeName) => Promise<RuntimeStatus>;
  /** Whether something inside the container listens on `port`. */
  isListening: (
    name: RuntimeName,
    containerId: string,
    port: number
  ) => Promise<boolean>;
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
  /** Kick off the runtime's VM/daemon (`podman machine start`, Docker Desktop). Resolves when the command returns, not when ready. */
  start: (name: RuntimeName) => Promise<void>;
}
