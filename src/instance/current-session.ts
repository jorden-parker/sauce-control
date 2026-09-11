import { randomUUID } from "node:crypto";

/** Id labelled onto every container this process starts, so exit and startup cleanup can find them. */
export const currentSessionId: string = randomUUID();
