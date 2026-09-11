/** Cookies from both Instances, keyed by name; both see the same jar so a login on one applies to the other. */
export interface CookieJar {
  /** The `Cookie` header to send upstream, or undefined when empty. */
  header: () => string | undefined;
  /** Applies `Set-Cookie` headers from an upstream response. */
  store: (setCookies: string[]) => void;
}

const expired = (attributes: string[]): boolean =>
  attributes.some((attribute) => {
    const [key, value] = attribute
      .split("=")
      .map((part) => part.trim().toLowerCase());
    return (
      (key === "max-age" && Number(value) <= 0) ||
      (key === "expires" &&
        value !== undefined &&
        Date.parse(value) < Date.now())
    );
  });

export const createCookieJar = (): CookieJar => {
  const cookies = new Map<string, string>();
  return {
    header: () =>
      cookies.size === 0
        ? undefined
        : [...cookies].map(([name, value]) => `${name}=${value}`).join("; "),
    store: (setCookies) => {
      for (const setCookie of setCookies) {
        const [pair = "", ...attributes] = setCookie.split(";"),
          separator = pair.indexOf("="),
          name = pair.slice(0, separator).trim(),
          value = pair.slice(separator + 1).trim();
        if (separator === -1 || name === "") {
          continue;
        }
        if (expired(attributes)) {
          cookies.delete(name);
        } else {
          cookies.set(name, value);
        }
      }
    },
  };
};
