# @lolmaus/settings-manager

A robust, type-safe settings manager for React applications. Define your settings with **Zod** schemas, handle breaking schema changes via **Migrations**, and sync data to any storage (LocalStorage, REST API, etc.).

It solves the hard parts of settings management out of the box:

- **Zero-Flicker Loading:** Prevents "Flash of Default Content" for async storage by offering a loading state.
- **Race Condition Protection:** Handles concurrency (AbortController, Queueing) and debouncing automatically.
- **Performance:** Selectors ensure components only re-render when specific settings change.
- **Strict Typing:** Infers TypeScript types directly from your Zod history—no manual interface maintenance required.```

⠀

## 1. Installation

Install the `@lolmaus/settings-manager` package using your preferred npm-based package manager.```

⠀

## 2. Quickstart

### 2.1. Define the manager

In e. g. `src/settings/manager.ts`, instantiate the adapter and pass it to the `SettingsManager`.

Chain `.addVersion()` to define your schema history.

Make sure to provide default values via Zod to every setting.

```ts
import { SettingsManager, LocalStorageAdapter, type InferSettings } from '@lolmaus/settings-manager';
import { z } from 'zod';

// 2.1.1. Create your adapter (or import a custom one)
const adapter = new LocalStorageAdapter({ key: 'my-app-settings' });

// 2.1.2. Initialize the manager with the adapter
export const settingsManager = new SettingsManager({ adapter })
  // Define Version 1
  .addVersion({
    version: 1,
    schema: z.object({
      menuExpanded: z.boolean().default(true),
      darkTheme: z.boolean().default(false),
    }),
  })

  // Define Version 2
  .addVersion({
    version: 2,
    schema: z.object({
      menuExpanded: z.boolean().default(true),
      // Changed from boolean 'darkTheme' to 'theme' typed as 'light' | 'dark' | 'high-contrast'
      theme: z.literal(['light', 'dark', 'high-contrast']).default('light'),
    }),

    migration: (prev) => {
      // TypeScript automatically infers 'prev' as the previous version
      return {
        menuExpanded: prev.menuExpanded,
        theme: prev.darkTheme ? 'dark' : 'light',
      };
    },
  });

// 2.1.3. Export the current settings type
export type Settings = InferSettings<typeof settingsManager>;
```

⠀

### 2.2. Wrap your app with the settings provider

Pass your `settingsManager` instance into the `manager` prop of the provider.

```tsx
import { SettingsProvider } from '@lolmaus/settings-manager';
import { settingsManager } from './settings/manager';

export const App = () => (
  <SettingsProvider value={settingsManager}>
    <Dashboard />
  </SettingsProvider>
);
```

⠀

### 2.3. Read settings

Use the hook `useSettings` to read settings:

```tsx
import { useSettings } from '@lolmaus/settings-manager';

export const PageWrapper = ({ children }) => {
  // Get the entire settings object
  const settings = useSettings();

  // Pass a selector to subscribe only to specific changes (renders optimized)
  const theme = useSettings((s) => s.theme);

  return <div data-theme={theme}>{children}</div>;
};
```

⠀

### 2.4. Persist settings

Use the `useUpdateSettings` hook to update settings:

```tsx
import { useUpdateSettings } from '@lolmaus/settings-manager';

export const ThemeToggler = () => {
  const { update } = useUpdateSettings();

  // Assuming this will be user input
  const newPartialSettings = { theme: 'dark' };

  return (
    <div>
      <button onClick={() => update(newPartialSettings)}>Switch to Dark Mode</button>
    </div>
  );
};
```

⠀

## 3. Defining a custom adapter

While the `LocalStorageAdapter` covers basic use cases, you will often need to persist settings to a remote API.```

⠀

### 3.1 The AsyncSettingsAdapter Helper

Writing a robust async adapter from scratch is difficult. You have to handle debouncing (so dragging a slider doesn't DDOS your server), race conditions, and error handling.

We provide a helper class `AsyncSettingsAdapter` that handles this heavy lifting for you.

In e. g. `src/settings/adapter.ts`:

```ts
import { AsyncSettingsAdapter, SettingsManager } from '@lolmaus/settings-manager';

export const apiAdapter = new AsyncSettingsAdapter({
  // How long to wait after the last change before saving (default: 500ms)
  // 500 is the default and can be omitted
  debounceMs: 500,

  // Choose how to handle concurrent save requests
  // 'abort' is the default and can be omitted
  concurrency: 'abort',

  read: async () => {
    const res = await fetch('/api/settings');
    if (!res.ok) throw new Error('Failed to fetch');
    return res.json();
  },

  // 'signal' is provided if you use concurrency: 'abort'
  write: async (settings, _changes, signal) => {
    await fetch('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(settings),
      headers: { 'Content-Type': 'application/json' },
      signal,
    });
  },

  onWriteError: (error) => {
    console.error('[SettingsManager] Background save failed:', error);
    // You could trigger a toast notification here
  },
});
```

Then register your adapter with the SettingsManager:

```ts
import { apiAdapter } from './adapter';

export const settingsManager = new SettingsManager({ adapter });
```

⠀

### 3.2 Handling Concurrency (Race Conditions)

When a user modifies settings rapidly (e.g., dragging a volume slider), multiple save requests are generated. Network latency can cause these requests to arrive out of order, potentially overwriting new settings with old ones.

The `AsyncSettingsAdapter` supports three strategies via the `concurrency` option to solve this:```

⠀

#### 3.2.1 concurrency: abort — default

**Best for:** Modern backends and standard APIs.

When a new save starts, the library automatically aborts the previous pending request using the browser's `AbortController`.

- **Pros:** Prevents race conditions; reduces server load; UI feels snappy.
- **Cons:** Backend/Fetch must support `AbortSignal` (Standard `fetch` does).

```ts
new AsyncSettingsAdapter({
  concurrency: 'abort', // default, can be omitted

  write: async (settings, _changes, signal) => {
    // Pass the signal to fetch!
    await fetch('/api/settings', {
      method: 'POST',
      body: JSON.stringify(settings),
      signal,
    });
  },
});
```

⠀

#### 3.2.2 concurrency: optimistic — ideal solution, requires backend logic

**Best for:** sophisticated backends implementing Optimistic Concurrency Control (OCC).

The library fires requests immediately. It assumes your settings object contains a `version` or `updatedAt` field, and your **server** rejects outdated writes (e.g., returns `409 Conflict`).

- **Pros:** Data integrity is guaranteed by the Single Source of Truth (Server).
- **Cons:** Requires complex backend logic.

No changes are necessary on the frontend to support this strategy.

⠀

#### 3.2.3 concurrency: queue — legacy Fallback

**Best for:** Legacy backends that do not support HTTP request cancellation and do not handle versioning.

The library waits for Request A to finish before sending Request B.

- **Pros:** Safe; works with anything.
- **Cons:** Slow. If the network is laggy, the "Save" indicator may spin for a long time as it processes a queue of outdated updates.

```ts
new AsyncSettingsAdapter({
  concurrency: 'queue',

  write: async (settings) => {
    // This will never run in parallel with another write
    await fetch('/api/settings', {
      /*...*/
    });
  },
});
```

⠀

### 3.3 Handling Backend Responses

Sometimes, the server modifies the data you sent. For example, it might sanitize input, enforce business rules, or update a timestamp (e.g., `lastUpdated`).

To sync these server-side changes back to your UI, simply return the response data from your `write` function.

Return void: The library keeps the "Optimistic Update" (the value the user set).

Return object: The library silently updates the store with the data returned from the server.

```ts
const apiAdapter = new AsyncSettingsAdapter({
  write: async (settings, _changes, signal) => {
    const response = await fetch('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(settings),
      signal,
    });

    const serverData = await response.json();

    // Return the data!
    // The library will automatically replace the data in the store with the one you provided.
    // This is useful if the server adds fields like "updatedAt"
    return serverData;
  },
});
```

Note: Updates triggered by the adapter's return value are treated as "sync" events. They do not trigger a subsequent save loop, but your components that depend on affected settings will rerender.

⠀

### 3.4 Handle loading and error states in the UI

```tsx
import { useUpdateSettings } from '@lolmaus/settings-manager';

export const ThemeToggler = () => {
  const { update, isSaving } = useUpdateSettings();

  // You might want to wrap this in useCallback if you're not using React Compiler
  const toggle = async (newTheme: string) => {
    try {
      // 1. Updates UI immediately (Optimistic)
      // 2. Awaits the adapter's write operation
      await update({ theme: newTheme });
      toast.success('Saved!');
    } catch (err) {
      // 3. At this point, settings will automatically rollback
      // You only need to tell the user why
      toast.error('Failed to save theme');
    }
  };

  return (
    <div>
      <button onClick={toggle}>{isSaving ? 'Saving...' : 'Switch to Dark Mode'}</button>

      {error && <span className="error">Save failed!</span>}
    </div>
  );
};
```

Note that you do not need to disable the button while settings are saving! See 3.2 Handling Concurrency above for details.

## 4. FAQ

### 4.1 Should I use TanStack Query in the adapter?

**Probably not.**

TanStack Query (React Query) is designed for **Server State** (caching, pagination, refetching). This library manages **Client State** (your settings object).

If you use TanStack Query inside the adapter, you are effectively caching the data twice (once in RQ, once in this library).

If you know what you're doing and why, you _can_ bridge them. You would simply use `queryClient.fetchQuery` inside `adapter.read()` and `queryClient.setQueryData` inside `adapter.write()`. This will e. g. let you rely on "Window Focus Refetching" to sync settings across tabs.

⠀

### 4.2 Why does the library depend on Zustand?

Our API for accessing an individual setting is the following:

```ts
// Good
const theme = useSettings((s) => s.theme);
```

If you did this instead:

```ts
// Bad
const { theme } = useSettings();
```

...then every update of every setting would make your component rerender. You don't want that. You only want it to rerender when `theme` changes, and that's something React primitives cannot accomplish.

We use `zustand/vanilla` internally as a micro-dependency to tackle this case.

- It's as small as it gets: less than 1kb. Even if we implemented a store from scratch, we wouldn't save any bytes.
- It provides a robust implementation of `useSyncExternalStore`, ensuring compatibility with React 18+ concurrent features.
- It allows the `SettingsManager` to exist _outside_ of React (in vanilla TS files), while still allowing React components to subscribe to changes.
- It saves us from reinventing the wheel on "Event Emitters" and "State Selectors."
- Makes the library framework-agnostic.

⠀

### 4.3 What's the hassle with migrations? Isn't it an overkill?

Settings schemas are rarely static.

1.  **Month 1:** You ship `darkTheme: boolean`.
2.  **Month 6:** You want `theme: 'light' | 'dark' | 'system'`.

Without migrations, a user returning after 6 months will crash because their localStorage contains `{ theme: true }` but your app expects a string. You would have to scatter `if (typeof theme === 'boolean')` checks all over your UI code. This results in maintenance burden increasing over time.

This library centralizes that logic. Your UI code stays clean and typed strictly to the _latest_ version, while the library handles the messy history in the background.

⠀

### 4.4 What happens if I omit a migration and there's an incompatibility?

If `adapter.read()` returns data that does not match the current Zod schema, and no migration fixes it, **Zod will throw a validation error**.

By default, the `SettingsManager` catches this error, logs it to the console, and **falls back to default values** defined in your schema. This ensures the app doesn't crash (White Screen of Death) just because settings file was corrupted or outdated.```

⠀

### 4.5 How do I reset a setting to its default value?

Simply pass `undefined` to the updateSettings hook.

Because your schema is defined with Zod, passing undefined triggers the `.default()` value defined in your config.

```ts
// Schema: theme: z.enum(...).default('light')

// Usage
updateSettings({ theme: undefined });

// Result: the store automatically reverts 'theme' to 'light'
```

Note: this assumes that your schema allows for `undefined` theme, e. g. via `.optional()`.

This works for deep nesting as well, e.g., updateSettings({ ui: { sidebar: undefined } }).

⠀

### 4.6 What about partial updates (PATCH)?

The adapter expects the API to return an entire settings object. This is because:

1. Validation Integrity: Zod schemas are designed to validate the entire data structure. Validating partial fragments often requires maintaining a second, "loose" schema, which doubles maintenance burden.

2. State Consistency: Supporting built-in diffing and deep-merging introduces complex edge cases (e.g., "stale keys" where deleted server fields persist locally).

In the `write` method, you can use `PATCH` and do partial updates, but **if your server responds with partial settings object**, then you must do one of the following:

- either do not return a value from `write`, ignoring server response (OK if the backend does not sanitize data);
- manually merge partial settings from server response with the full settings from the store and return the full settings object.
