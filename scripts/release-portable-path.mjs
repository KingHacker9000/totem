const WINDOWS_RESERVED_BASENAMES = new Set([
  "con",
  "prn",
  "aux",
  "nul",
  ...Array.from({ length: 9 }, (_, index) => `com${index + 1}`),
  ...Array.from({ length: 9 }, (_, index) => `lpt${index + 1}`),
]);

const WINDOWS_INVALID_CHARS = /[<>:"|?*]/u;

function hasWindowsControlCharacter(component) {
  return [...component].some((character) => character.codePointAt(0) <= 0x1f);
}

export function portablePathKey(path) {
  return path.normalize("NFC").toLowerCase();
}

export function assertPortableReleasePath(path) {
  if (typeof path !== "string" || path.length === 0) {
    throw new Error("release path must be a non-empty string");
  }
  if (path.includes("\\")) {
    throw new Error(`release path must use forward slashes: ${path}`);
  }
  if (path.startsWith("/") || path.endsWith("/")) {
    throw new Error(`release path must be a relative file path: ${path}`);
  }

  const components = path.split("/");
  for (const component of components) {
    if (!component || component === "." || component === "..") {
      throw new Error(`release path has an unsafe component: ${path}`);
    }
    if (component.endsWith(".") || component.endsWith(" ")) {
      throw new Error(
        `release path component has a Windows-unsafe trailing dot/space: ${path}`,
      );
    }
    if (
      WINDOWS_INVALID_CHARS.test(component) ||
      hasWindowsControlCharacter(component)
    ) {
      throw new Error(
        `release path component has Windows-invalid characters: ${path}`,
      );
    }
    const basename = component.split(".", 1)[0].toLowerCase();
    if (WINDOWS_RESERVED_BASENAMES.has(basename)) {
      throw new Error(
        `release path uses a Windows-reserved device name: ${path}`,
      );
    }
  }

  return portablePathKey(path);
}

export function assertPortablePathSet(paths, label = "release paths") {
  const seen = new Map();
  for (const path of paths) {
    const key = assertPortableReleasePath(path);
    const previous = seen.get(key);
    if (previous !== undefined && previous !== path) {
      throw new Error(
        `${label} contain a case-fold collision: ${previous} <-> ${path}`,
      );
    }
    if (previous === path) {
      throw new Error(`${label} contain a duplicate path: ${path}`);
    }
    seen.set(key, path);
  }
  return seen;
}
