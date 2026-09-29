export const HISTORY_MAX = 20;

// Newest first; returns a new array.
export function addEntry(list, entry, max = HISTORY_MAX) {
  return [entry, ...(list || [])].slice(0, max);
}
