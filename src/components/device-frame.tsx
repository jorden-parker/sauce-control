"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import type { Viewport } from "@/viewport/viewport";

/**
 * A device bezel around content rendered at the Viewport's exact size, scaled down to fit
 * the space the frame is given. Shared by the embedded Instances and the report captures.
 */
export const DeviceFrame = ({
  badge,
  children,
  label,
  viewport,
}: {
  /** Shown over the top edge of the screen, for the desync notice. */
  badge?: ReactNode;
  children: ReactNode;
  label: string;
  viewport: Viewport;
}) => {
  const container = useRef<HTMLDivElement>(null),
    [scale, setScale] = useState(1);

  useEffect(() => {
    const element = container.current;
    if (element === null) {
      return;
    }
    const fit = () =>
        setScale(Math.min(1, element.clientWidth / viewport.width)),
      observer = new ResizeObserver(fit);
    fit();
    observer.observe(element);
    return () => observer.disconnect();
  }, [viewport.width]);

  return (
    <figure
      className="flex min-w-0 flex-1 flex-col gap-2"
      data-testid="device-frame"
    >
      <figcaption className="text-sm font-medium">
        {label}{" "}
        <span className="text-muted-foreground">
          {viewport.name} · {viewport.width}×{viewport.height}
        </span>
      </figcaption>
      <div
        ref={container}
        className="relative rounded-[2rem] border-[10px] border-neutral-900 bg-neutral-900 shadow-lg dark:border-neutral-700"
      >
        {badge}
        <div
          className="overflow-hidden rounded-[1.4rem] bg-background"
          style={{ height: viewport.height * scale }}
        >
          <div
            style={{
              height: viewport.height,
              transform: `scale(${scale})`,
              transformOrigin: "top left",
              width: viewport.width,
            }}
          >
            {children}
          </div>
        </div>
      </div>
    </figure>
  );
};
