import { DatabaseSync } from "node:sqlite";
import type { InstanceRole } from "@/proxy/proxy";
import { endpointRecordingsDatabasePath } from "@/settings/data-directory";

/** One outbound HTTP call an Instance made, as the Proxy saw it. */
export interface EndpointCall {
  method: string;
  requestBody: Uint8Array;
  requestHeaders: Record<string, string | string[] | undefined>;
  responseBody: Uint8Array;
  responseHeaders: Record<string, string | string[] | undefined>;
  /** Which Instance made the call. */
  role: InstanceRole;
  status: number;
  /** The absolute URL called. */
  url: string;
}

/** A stored call: credential headers carry `[redacted]` in place of their values. */
export type EndpointSample = EndpointCall & { recordedAt: string };

/** An outbound HTTP API the application calls, with how many calls to it are recorded. */
export interface Endpoint {
  method: string;
  origin: string;
  /** The path with ids replaced: `{n}` for numeric segments, `{uuid}` for UUIDs. */
  pathPattern: string;
  samples: number;
}

/** Recorded Endpoint calls, kept per Repository. */
export interface EndpointRecordings {
  close: () => void;
  /** The Repository's Endpoints, ordered by origin, then path pattern, then method. */
  endpoints: (repository: string) => Endpoint[];
  /** Deletes every call recorded for the Repository; returns how many there were. */
  purge: (repository: string) => number;
  record: (repository: string, call: EndpointCall) => void;
  /** Every call recorded for the Repository, oldest first. */
  samples: (repository: string) => EndpointSample[];
}

interface Row {
  method: string;
  recorded_at: string;
  request_body: Uint8Array;
  request_headers: string;
  response_body: Uint8Array;
  response_headers: string;
  role: EndpointCall["role"];
  status: number;
  url: string;
}

const SCHEMA = `CREATE TABLE IF NOT EXISTS endpoint_calls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    repository TEXT NOT NULL,
    role TEXT NOT NULL,
    recorded_at TEXT NOT NULL,
    method TEXT NOT NULL,
    url TEXT NOT NULL,
    request_headers TEXT NOT NULL,
    request_body BLOB NOT NULL,
    status INTEGER NOT NULL,
    response_headers TEXT NOT NULL,
    response_body BLOB NOT NULL
  );
  CREATE INDEX IF NOT EXISTS endpoint_calls_repository ON endpoint_calls (repository);`,
  NUMERIC_SEGMENT = /\/\d+(?=\/|$)/gu,
  UUID_SEGMENT =
    /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\/|$)/giu,
  pathPattern = (pathname: string): string =>
    pathname
      .replaceAll(UUID_SEGMENT, "/{uuid}")
      .replaceAll(NUMERIC_SEGMENT, "/{n}"),
  byOriginThenPattern = (left: Endpoint, right: Endpoint): number =>
    left.origin.localeCompare(right.origin) ||
    left.pathPattern.localeCompare(right.pathPattern) ||
    left.method.localeCompare(right.method),
  CREDENTIAL_HEADERS = new Set([
    "authorization",
    "cookie",
    "proxy-authorization",
    "set-cookie",
  ]),
  /** The headers with every credential's value replaced, whatever the name's case. */
  redacted = (headers: EndpointCall["requestHeaders"]): string =>
    JSON.stringify(
      Object.fromEntries(
        Object.entries(headers).map(([name, value]) => [
          name,
          CREDENTIAL_HEADERS.has(name.toLowerCase()) ? "[redacted]" : value,
        ])
      )
    ),
  fromRow = (row: Row): EndpointSample => ({
    method: row.method,
    recordedAt: row.recorded_at,
    requestBody: row.request_body,
    requestHeaders: JSON.parse(
      row.request_headers
    ) as EndpointCall["requestHeaders"],
    responseBody: row.response_body,
    responseHeaders: JSON.parse(
      row.response_headers
    ) as EndpointCall["responseHeaders"],
    role: row.role,
    status: row.status,
    url: row.url,
  });

/** Opens (creating if needed) the recordings database at `databasePath`. */
export const openEndpointRecordings = (
  databasePath: string
): EndpointRecordings => {
  const database = new DatabaseSync(databasePath);
  database.exec(SCHEMA);
  const insert = database.prepare(
      `INSERT INTO endpoint_calls
         (repository, role, recorded_at, method, url, request_headers, request_body, status, response_headers, response_body)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ),
    selectCalls = database.prepare(
      "SELECT method, url FROM endpoint_calls WHERE repository = ?"
    ),
    selectSamples = database.prepare(
      "SELECT * FROM endpoint_calls WHERE repository = ? ORDER BY id"
    ),
    deleteCalls = database.prepare(
      "DELETE FROM endpoint_calls WHERE repository = ?"
    );
  return {
    close: () => {
      database.close();
    },
    endpoints: (repository) => {
      const grouped = new Map<string, Endpoint>();
      for (const { method, url } of selectCalls.all(repository) as {
        method: string;
        url: string;
      }[]) {
        const { origin, pathname } = new URL(url),
          endpoint = { method, origin, pathPattern: pathPattern(pathname) },
          key = JSON.stringify(endpoint);
        grouped.set(key, {
          ...endpoint,
          samples: (grouped.get(key)?.samples ?? 0) + 1,
        });
      }
      return [...grouped.values()].toSorted(byOriginThenPattern);
    },
    purge: (repository) => Number(deleteCalls.run(repository).changes),
    record: (repository, call) => {
      insert.run(
        repository,
        call.role,
        new Date().toISOString(),
        call.method,
        call.url,
        redacted(call.requestHeaders),
        call.requestBody,
        call.status,
        redacted(call.responseHeaders),
        call.responseBody
      );
    },
    samples: (repository) =>
      (selectSamples.all(repository) as unknown as Row[]).map(fromRow),
  };
};

let processRecordings: EndpointRecordings | undefined;

/** The process-wide recordings in the data directory. */
export const endpointRecordings = (): EndpointRecordings => {
  processRecordings ??= openEndpointRecordings(
    endpointRecordingsDatabasePath()
  );
  return processRecordings;
};
