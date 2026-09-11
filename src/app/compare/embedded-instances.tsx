"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { DeviceFrame } from "@/components/device-frame";
import { INSTANCE_ROLES, type InstanceRole } from "@/proxy/proxy";
import type { SyncEvent, SyncMessage } from "@/sync/sync-script";
import { DEFAULT_VIEWPORT } from "@/viewport/viewport";

const LABELS: Record<InstanceRole, string> = {
    base: "Base Instance",
    target: "Target Instance",
  },
  sibling = (role: InstanceRole): InstanceRole =>
    role === "base" ? "target" : "base",
  isSyncMessage = (data: unknown): data is SyncMessage =>
    typeof data === "object" &&
    data !== null &&
    (data as SyncMessage).source === "sauce-control",
  /** How the badge names what the sibling could not find. */
  describeEvent = (event: SyncEvent): string => {
    if (!("target" in event) || event.target === undefined) {
      return event.kind;
    }
    const { name, role, testId } = event.target;
    if (role !== undefined) {
      return name ? `${role} “${name}”` : role;
    }
    return testId === undefined ? event.target.cssPath : `test id ${testId}`;
  };

/**
 * Both Instances side by side. Every interaction one frame reports is forwarded to the
 * other; a frame that finds no counterpart for it raises the desync badge, and nothing is
 * repaired automatically.
 */
export const EmbeddedInstances = ({
  urls,
}: {
  urls: Record<InstanceRole, string>;
}) => {
  const frames = useRef<Record<InstanceRole, HTMLIFrameElement | null>>({
      base: null,
      target: null,
    }),
    [desync, setDesync] = useState<Partial<Record<InstanceRole, string>>>({});

  useEffect(() => {
    const origins = {
        base: new URL(urls.base).origin,
        target: new URL(urls.target).origin,
      },
      onMessage = (event: MessageEvent<unknown>) => {
        if (!isSyncMessage(event.data)) {
          return;
        }
        // Each Instance has its own origin, which is also the reliable check: Chromium stops
        // Reporting the iframe's contentWindow as the source once a replayed click navigated it.
        const from = INSTANCE_ROLES.find(
          (role) => event.origin === origins[role]
        );
        if (from === undefined) {
          return;
        }
        if (event.data.type === "event") {
          const to = sibling(from),
            message: SyncMessage = {
              event: event.data.event,
              source: "sauce-control",
              type: "replay",
            };
          frames.current[to]?.contentWindow?.postMessage(message, origins[to]);
        } else if (event.data.type === "desync") {
          const reason = describeEvent(event.data.event);
          setDesync((current) => ({ ...current, [from]: reason }));
        }
      };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [urls.base, urls.target]);

  return (
    <section className="flex flex-col gap-4" aria-label="Embedded Instances">
      <div className="flex flex-col gap-6 md:flex-row">
        {INSTANCE_ROLES.map((role) => (
          <DeviceFrame
            key={role}
            label={LABELS[role]}
            viewport={DEFAULT_VIEWPORT}
            badge={
              <div
                className="absolute left-1/2 top-3 z-10 -translate-x-1/2 items-center gap-2 rounded-full bg-destructive px-3 py-1 text-xs font-medium text-white shadow"
                data-testid={`desync-${role}`}
                hidden={desync[role] === undefined}
                role="status"
                style={{
                  display: desync[role] === undefined ? "none" : "flex",
                }}
              >
                <span>Desync: no match for {desync[role]}</span>
                <Button
                  className="h-5 px-1 text-white hover:bg-white/20 hover:text-white"
                  onClick={() =>
                    setDesync(({ [role]: _dismissed, ...rest }) => rest)
                  }
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  Dismiss
                </Button>
              </div>
            }
          >
            <iframe
              ref={(element) => {
                frames.current[role] = element;
              }}
              className="block border-0"
              height={DEFAULT_VIEWPORT.height}
              src={urls[role]}
              title={LABELS[role]}
              width={DEFAULT_VIEWPORT.width}
            />
          </DeviceFrame>
        ))}
      </div>
    </section>
  );
};
