export function validatedTenderImportCleanupPaths(
  companyId: number,
  importId: string,
  values: unknown,
): string[] {
  if (!Number.isInteger(companyId) || !importId) {
    throw new Error("Cleanup scope is invalid");
  }
  const paths = Array.isArray(values)
    ? [...new Set(values.map((path) => String(path).trim()))]
    : [];
  const prefix = `${companyId}/${importId}/`;
  if (
    !paths.length ||
    paths.length > 60 ||
    paths.some((path) =>
      !path.startsWith(prefix) ||
      path.length > 700 ||
      path.includes("..") ||
      path.includes("//") ||
      path.includes("\\")
    )
  ) {
    throw new Error("Cleanup paths are invalid");
  }
  return paths;
}

export function partitionTenderImportCleanupPaths(
  paths: string[],
  referencedPaths: Iterable<string>,
): { removable: string[]; refused: string[] } {
  const referenced = new Set(referencedPaths);
  return {
    removable: paths.filter((path) => !referenced.has(path)),
    refused: paths.filter((path) => referenced.has(path)),
  };
}

export async function redactedTenderImportObjectId(
  objectName: string,
): Promise<string> {
  const identifier = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(objectName),
  );
  return [...new Uint8Array(identifier)].slice(0, 8)
    .map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
