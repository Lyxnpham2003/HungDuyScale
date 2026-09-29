// Pure helpers for "Tìm hộp cân": which addresses to try, and a bounded worker pool.

export const DEFAULT_PREFIX = "172.16.10";

const OCTET = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;

// "172.16.10" / "172.16.10." / "172.16.10.x" → "172.16.10"
export function normalizePrefix(input) {
  const s = String(input ?? "")
    .trim()
    .replace(/\.(x|\*)?$/i, "");
  const parts = s.split(".");
  if (parts.length !== 3 || !parts.every((p) => OCTET.test(p))) {
    return { prefix: null, error: `Dải mạng "${String(input ?? "").trim()}" không hợp lệ (ví dụ 172.16.10).` };
  }
  return { prefix: s, error: null };
}

export function prefixOf(ip) {
  const m = /^(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}$/.exec(String(ip ?? "").trim());
  return m ? m[1] : null;
}

export function hostsIn(prefix) {
  return Array.from({ length: 254 }, (_, i) => `${prefix}.${i + 1}`);
}

// Runs worker(item) with at most `limit` in flight; results keep the input order.
export async function runPool(items, limit, worker, onProgress = () => {}) {
  const results = new Array(items.length);
  let next = 0;
  let done = 0;
  async function lane() {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i], i);
      done++;
      onProgress(done, items.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
  return results;
}
