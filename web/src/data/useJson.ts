import { useEffect, useState } from "react";

export type FetchState<T> =
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "ready"; data: T };

/**
 * Fetches one committed static JSON artifact from web/public/data/ at
 * runtime. The app reads only these committed exports. No model
 * computation happens here; this hook
 * only retrieves and parses JSON that scripts/export_showcase_data.py
 * already produced.
 */
export function useJson<T>(path: string): FetchState<T> {
  const [state, setState] = useState<FetchState<T>>({ status: "loading" });

  useEffect(() => {
    if (!path) {
      setState({ status: "loading" });
      return;
    }
    let cancelled = false;
    setState({ status: "loading" });

    fetch(path)
      .then((res) => {
        if (!res.ok) {
          throw new Error(`${res.status} ${res.statusText}`);
        }
        return res.json() as Promise<T>;
      })
      .then((data) => {
        if (!cancelled) setState({ status: "ready", data });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : String(err);
          setState({ status: "error", error: message });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [path]);

  return state;
}
