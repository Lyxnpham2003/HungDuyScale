export function createBackoff(min = 1000, max = 30000) {
  let current = min;
  return {
    next() {
      const delay = current;
      current = Math.min(current * 2, max);
      return delay;
    },
    reset() {
      current = min;
    },
  };
}
