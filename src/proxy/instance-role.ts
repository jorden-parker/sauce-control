/** Which Instance of a Comparison something belongs to. Free of Node imports, so client components can use it. */
export const INSTANCE_ROLES = ["base", "target"] as const;

export type InstanceRole = (typeof INSTANCE_ROLES)[number];
