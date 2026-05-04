/**
 * Central CRM merge helpers for Formitize-style flat field maps.
 * Typed customer columns are still updated via SQL COALESCE in the webhook;
 * this module supports JSON merge and future backfill scripts.
 */

export type FlatFieldMap = Record<string, string>;

/**
 * Shallow merge: `incoming` keys win on collision (newer submission overlays older).
 */
export function mergeFlatFieldMaps(
  existing: unknown,
  incoming: FlatFieldMap,
): FlatFieldMap {
  const base: FlatFieldMap =
    existing !== null &&
    typeof existing === "object" &&
    !Array.isArray(existing)
      ? { ...(existing as FlatFieldMap) }
      : {};
  return { ...base, ...incoming };
}
