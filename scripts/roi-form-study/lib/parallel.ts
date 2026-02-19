export interface ParallelResult<T, R> {
  item: T;
  result?: R;
  error?: Error;
}

export async function runParallel<T, R>(opts: {
  items: T[];
  fn: (item: T) => Promise<R>;
  concurrency: number;
  label?: (item: T) => string;
  onStart?: (item: T, index: number) => void;
  onDone?: (item: T, result: R, index: number) => void;
  onError?: (item: T, err: Error, index: number) => void;
}): Promise<ParallelResult<T, R>[]> {
  const results: ParallelResult<T, R>[] = [];
  const queue = opts.items.map((item, i) => ({ item, index: i }));
  let active = 0;

  return new Promise((resolve) => {
    function next() {
      while (active < opts.concurrency && queue.length > 0) {
        const { item, index } = queue.shift()!;
        active++;
        opts.onStart?.(item, index);

        opts
          .fn(item)
          .then((result) => {
            results.push({ item, result });
            opts.onDone?.(item, result, index);
          })
          .catch((err) => {
            const error = err instanceof Error ? err : new Error(String(err));
            results.push({ item, error });
            opts.onError?.(item, error, index);
          })
          .finally(() => {
            active--;
            if (queue.length === 0 && active === 0) {
              resolve(results);
            } else {
              next();
            }
          });
      }
    }

    if (queue.length === 0) resolve(results);
    else next();
  });
}
