/** A named device size at which Pages are captured and displayed, with a matching device frame. */
export interface Viewport {
  height: number;
  name: string;
  /** Device pixel ratio for captures. */
  scale: number;
  width: number;
}

/** The Viewport the embedded Instances use until the shared toggle exists. */
export const DEFAULT_VIEWPORT: Viewport = {
  height: 844,
  name: "Phone",
  scale: 3,
  width: 390,
};
