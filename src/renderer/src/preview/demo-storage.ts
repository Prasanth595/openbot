/** One demo owns these display values. The browser's saved product data is never read or cleared. */
export function createDemoStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(String(key)) ?? null,
    key: (index) => [...values.keys()][Math.trunc(index) >>> 0] ?? null,
    removeItem: (key) => {
      values.delete(String(key));
    },
    setItem: (key, value) => {
      values.set(String(key), String(value));
    },
  };
}

export function installDemoStorage(storage: Storage): () => void {
  const previous = Object.getOwnPropertyDescriptor(window, "localStorage");
  const ownedGetter = () => storage;
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    enumerable: previous?.enumerable ?? true,
    get: ownedGetter,
  });
  return () => {
    if (Object.getOwnPropertyDescriptor(window, "localStorage")?.get !== ownedGetter) return;
    if (previous) Object.defineProperty(window, "localStorage", previous);
    else Reflect.deleteProperty(window, "localStorage");
  };
}
