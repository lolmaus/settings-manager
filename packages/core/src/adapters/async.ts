import { BaseAdapter } from './base.js';

/**
 * Strategies for handling concurrent write requests.
 *
 * - `abort`: Cancels the previous pending request using AbortController.
 * - `optimistic`: Fires requests immediately. Relies on the server to handle conflict/ordering.
 * - `queue`: Waits for the previous request to resolve before starting the next.
 */
export type ConcurrencyStrategy = 'abort' | 'optimistic' | 'queue';

/**
 * Configuration options for the {@link AsyncAdapter}.
 *
 * @template TData - The shape of the settings object.
 */
export interface AsyncAdapterOptions<TData> {
  /**
   * A function that retrieves settings from your asynchronous storage (e.g. API).
   *
   * @returns A Promise resolving to the settings object.
   */
  read: () => Promise<TData>;

  /**
   * A function that persists settings to your asynchronous storage.
   *
   * @param settings - The full settings object.
   * @param changes - The partial object containing only changed fields.
   * @param signal - An `AbortSignal` provided if `concurrency: 'abort'` is used.
   * Pass this to your `fetch` call to enable cancellation.
   * @returns A Promise resolving to the saved settings (optional) or void.
   */
  write: (
    settings: TData,
    changes: Partial<TData>,
    signal?: AbortSignal
  ) => Promise<TData | void>;

  /**
   * Optional callback for handling write errors (e.g. for toast notifications).
   * If provided, this overrides the default console logging behavior.
   */
  onWriteError?: (error: unknown) => void;

  /**
   * The delay in milliseconds to wait before triggering a write.
   * Useful to prevent flooding the API while the user is dragging a slider.
   *
   * @default 500
   */
  debounceMs?: number;

  /**
   * The strategy to use when multiple write requests occur rapidly.
   *
   * @default 'abort'
   */
  concurrency?: ConcurrencyStrategy;
}

/**
 * A generic adapter helper for asynchronous storage (REST APIs, IndexedDB, etc.).
 *
 * It handles the complex logic of debouncing and race-condition management
 * so you only need to provide the raw `read` and `write` functions.
 *
 * @example
 * ```ts
 * const adapter = new AsyncAdapter({
 * read: () => fetch('/api/settings').then(r => r.json()),
 * write: (data, _, signal) => fetch('/api/settings', {
 * method: 'PUT',
 * body: JSON.stringify(data),
 * signal
 * }),
 * concurrency: 'abort'
 * });
 * ```
 */
export class AsyncAdapter<
  TData = unknown,
  TError = unknown
> extends BaseAdapter<TData, TError> {
  protected options: AsyncAdapterOptions<TData>;
  protected debounceTimer: ReturnType<typeof setTimeout> | null = null;
  protected abortController: AbortController | null = null;
  protected writeQueue: Promise<void> = Promise.resolve();

  constructor(options: AsyncAdapterOptions<TData>) {
    super();
    this.options = options;
  }

  /**
   * Handles errors using the custom handler from options (if present),
   * otherwise falls back to the BaseAdapter's default behavior.
   */
  override onWriteError(error: TError): void {
    if (this.options.onWriteError) {
      this.options.onWriteError(error);
    } else {
      super.onWriteError(error);
    }
  }

  /**
   * Executes the user-provided `read` function.
   */
  read(): Promise<TData> {
    return this.options.read();
  }

  /**
   * Schedules a write operation.
   *
   * This method applies debouncing and handles the configured concurrency strategy.
   *
   * @param settings - The full settings object.
   * @param changes - The changed properties.
   */
  write(
    settings: TData,
    changes: Partial<TData>
  ): Promise<TData | void> | void {
    const { debounceMs = 500, concurrency = 'abort' } = this.options;

    // Clear existing debounce timer to restart the countdown
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    return new Promise((resolve, reject) => {
      this.debounceTimer = setTimeout(() => {
        this.executeWrite(settings, changes, concurrency)
          .then(resolve)
          .catch((err) => {
            // Ignore AbortErrors as they are intentional cancellations
            if (err instanceof Error && err.name === 'AbortError') {
              return;
            }
            this.onWriteError(err as TError);
            reject(err);
          });
      }, debounceMs);
    });
  }

  /**
   * internal executor that applies the concurrency strategy.
   */
  private async executeWrite(
    settings: TData,
    changes: Partial<TData>,
    strategy: ConcurrencyStrategy
  ): Promise<TData | void> {
    // --- Strategy 1: Abort (Default) ---
    if (strategy === 'abort') {
      // Cancel any currently running request
      if (this.abortController) {
        this.abortController.abort();
      }
      this.abortController = new AbortController();

      // Pass the new signal to the user's write function
      return this.options.write(settings, changes, this.abortController.signal);
    }

    // --- Strategy 2: Queue ---
    if (strategy === 'queue') {
      // Chain onto the existing promise
      const operation = this.writeQueue
        .then(() => this.options.write(settings, changes))
        .catch(() => {
          // Swallow errors in the chain so the queue doesn't stall,
          // but the individual promise (returned to caller) will still reject.
        });

      this.writeQueue = operation as Promise<void>;
      return operation;
    }

    // --- Strategy 3: Optimistic ---
    // Fire and forget (from the adapter's perspective).
    // The Manager handles rollbacks if this throws.
    return this.options.write(settings, changes);
  }
}
