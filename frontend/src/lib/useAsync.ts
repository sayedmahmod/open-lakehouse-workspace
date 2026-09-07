"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface AsyncState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

/** Run an async loader on mount (and whenever `deps` change), with a manual
 *  `reload` for refresh buttons. Stale responses are discarded. */
export function useAsync<T>(loader: () => Promise<T>, deps: unknown[] = []): AsyncState<T> & { reload: () => void; setData: (value: T) => void } {
  const [state, setState] = useState<AsyncState<T>>({ data: null, error: null, loading: true });
  const generation = useRef(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const run = useCallback(() => {
    const current = ++generation.current;
    setState((prev) => ({ ...prev, loading: true, error: null }));
    loaderRef.current()
      .then((data) => {
        if (current === generation.current) setState({ data, error: null, loading: false });
      })
      .catch((err: unknown) => {
        if (current === generation.current) {
          setState({ data: null, error: err instanceof Error ? err.message : String(err), loading: false });
        }
      });
  }, []);

  useEffect(() => {
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const setData = useCallback((value: T) => setState({ data: value, error: null, loading: false }), []);

  return { ...state, reload: run, setData };
}

/** Poll a loader on an interval — used for running queries and job runs. */
export function useInterval(callback: () => void, delayMs: number | null) {
  const saved = useRef(callback);
  saved.current = callback;

  useEffect(() => {
    if (delayMs === null) return;
    const id = setInterval(() => saved.current(), delayMs);
    return () => clearInterval(id);
  }, [delayMs]);
}
