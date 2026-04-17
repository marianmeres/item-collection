# Changes in 1.4.0

A reliability and consistency pass. This release fixes a set of correctness bugs, tightens
the reactivity contract, and adds a small new API. Most consuming code will not need
changes. The behavior-level changes that could affect existing code are documented at the
bottom of this file.

## Summary

- **Bug fixes:** 14 correctness issues across reactivity, serialization, indexing, and
  navigation.
- **New API:** `batch(fn)` for coalescing multiple mutations into a single subscriber
  notification.
- **API consistency:** publish semantics aligned; `config` returns a frozen snapshot;
  `findAllIndexesBy` returns a defensive copy.
- **Serialization:** dumps now preserve every configuration field; `Infinity`
  cardinalities round-trip correctly; legacy dumps still restore.

## Bug fixes

### Reactivity

| ID  | What          | Before                                | After                                   |
| --- | ------------- | ------------------------------------- | --------------------------------------- |
| B1  | `toggleTag`   | Published twice per call              | Publishes once                          |
| B2  | `removeAllBy` | Published `N+1` times for `N` matches | Publishes once                          |
| B3  | `addMany`     | Published twice                       | Publishes once                          |
| B4  | `patchMany`   | Published `N+1` times                 | Publishes once                          |
| B14 | `search`      | Published on every call               | Publishes only when `lastQuery` changes |

### Serialization (`dump()` / `restore()`)

| ID | What                                           | Before                                                            | After                                           |
| -- | ---------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------- |
| B6 | Oversized tag sets in dumps                    | Silently violated cardinality                                     | Pruned to respect cardinality                   |
| B7 | `allowNextPrevCycle` / `allowUnconfiguredTags` | Not preserved                                                     | Preserved                                       |
| B8 | `cardinality: Infinity`                        | Serialized as `null`, then broke cardinality checks after restore | `null` normalized back to `Infinity` on restore |

### Correctness

| ID      | What                                   | Before                                                                                          | After                                                        |
| ------- | -------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| B5      | `patch()`                              | Left property indexes stale; `findBy` returned wrong results after patching an indexed property | Rebuilds affected indexes                                    |
| B9      | `removeAt()` when active is last       | Wrapped active to head (`index % size`)                                                         | Clamps to new tail (or `undefined` if empty)                 |
| B10     | `findAllIndexesBy()`                   | Returned the internal array; callers could corrupt the index by mutating it                     | Returns a shallow copy                                       |
| B11     | `sort()` with no configured `sortFn`   | Always ran a no-op sort and rebuilt indexes; `return false` was unreachable                     | Returns `false` when no `sortFn` is available                |
| D4 / D5 | `remove` / `sort` / `move` / `patch`   | Dropped all custom-property indexes, keeping only the id index                                  | Rebuilds every tracked property index                        |
| —       | `sort()`                               | Silently detached tag sets and the active item (both are index-based)                           | Remaps tag sets and the active item by id across the reorder |
| —       | `clear()` with a searchable collection | Left stale doc ids in the search index                                                          | Purges the search index                                      |

### Navigation

| ID | What                 | Before                                 | After                                               |
| -- | -------------------- | -------------------------------------- | --------------------------------------------------- |
| —  | `setActiveIndex(-1)` | Produced `NaN` in JS (negative modulo) | Counts from the end (like `Array.prototype.at(-1)`) |

## New API

### `batch(fn: () => void): void`

Coalesce multiple mutations into a single subscriber notification:

```ts
collection.batch(() => {
	collection.add(newItem);
	collection.applyTag(newItem, "featured");
	collection.setActive(newItem);
}); // subscribers notified exactly once
```

- Nested `batch()` calls are supported; only the outermost flushes.
- Empty batches (no internal publish attempted) do not fire a notification.
- Throws propagate. Any pending publish is still flushed so subscribers see the partial
  state that actually took effect.

## API consistency

### `configure({ sortFn: null })` / `configure({ normalizeFn: null })`

You can now remove a previously configured sort/normalize function by passing `null`.
Previously these options were silently ignored when not a function, with no way to clear
them.

- `undefined` → field is left untouched (unchanged behavior).
- `null` → resets the field (new).
- function → assigns (unchanged behavior).

### `get config` returns a frozen snapshot (I7)

`collection.config` now returns a deeply frozen object. Previously it exposed the live
internal tag-config objects via `config.tags.<name>`, and mutating them would silently
change the collection's cardinality enforcement.

Use `configure()` / `configureTag()` to change configuration.

### `findAllIndexesBy()` returns a defensive copy (B10)

Previously returned the internal array. Callers that did `.pop()` / `.sort()` /
`.splice()` on the result corrupted the index.

### `configureTag()` publish consistency

Previously `configureTag()` only fired a change event when the cardinality was reduced
(and some items had to be dropped). Now fires on any actual config change, matching the
publish semantics of other mutating methods.

### `applyTagByIndexes()` processes the full list (D2)

Previously short-circuited on the first failing index, so later indexes were not processed
even when they were valid. This left state partly mutated but the caller could not tell.
Now iterates the full list and publishes a single change event; return value is `true`
only when every application succeeded.

### `patch()` rejects id mutation

`patch(item)` now returns `false` if the item's id does not match the id being looked up,
guarding against silent index corruption. If you need to change an item's id, use
`remove()` + `add()`.

## Dump format (1.4)

The dump object gained a `version: 1` field and two new fields (`allowNextPrevCycle`,
`allowUnconfiguredTags`) that are now serialized and restored. `cardinality` (both
collection-level and per-tag) is typed `number | null` — `null` on the wire means
`Infinity` (because `JSON.stringify(Infinity) === "null"`).

Old dumps (without `version`, without the two new fields) still restore correctly: missing
fields keep the collection's current settings instead of being reset to hardcoded
defaults.

## Backwards-compatibility notes

Everything below is a real or potential behavior change. Each item lists the scenario most
likely to surface it.

1. **`toggleTag` / `removeAllBy` / `addMany` / `patchMany` publish fewer events.**
   - If your subscriber counted calls (rather than reading state), counts will decrease.
     Subscribers that read state from the callback are unaffected.
   - Mitigation: read state from the callback payload, not from call counts.

2. **`search()` publishes less often.**
   - Repeating the identical query no longer re-notifies subscribers. If you relied on
     `search()` as a "ping" subscribers, switch to an explicit notification (e.g.,
     `batch(() => {})` does not help here — it is specifically a no-op-no-publish).

3. **`removeAt()` active-index no longer wraps to head.**
   - If you removed the active (last) item and relied on active wrapping to index 0, you
     will now see the active clamp to the new last item. Explicit `setActiveFirst()` is
     unchanged.

4. **`setActiveIndex(-1)` now counts from the end.**
   - Previously this produced an invalid state. If you had code guarding against negative
     input, you can remove the guard (or keep it — both are fine).

5. **`sort()` returns `false` when no `sortFn` is configured and none is passed.**
   - Previously always returned `true` (but the sort was a no-op). Check the return value
     only if you depended on it.

6. **`sort()` preserves tags and active item by id.**
   - Previously a sort silently detached tag sets and the active index. Any code that
     worked around this (e.g. re-applying tags after sort) can be simplified.

7. **`patch()` refuses id mutation.**
   - Previously a patch whose id did not match the looked-up id would silently corrupt
     indexes. Now returns `false`. If any of your code deliberately changed the id via
     patch, switch to `remove()` + `add()`.

8. **`patch()` rebuilds indexes.**
   - This is a pure improvement: `findBy()` now returns correct results after patching a
     property's value. No known code depends on the old broken behavior, but if your tests
     asserted on stale index results, they will need to be updated to expect correctness.

9. **`config` is deeply frozen.**
   - Code that mutated `collection.config.tags.foo.cardinality` (the only known path that
     ever leaked) will throw in strict mode (and was a bug). Use `configureTag()`.

10. **`findAllIndexesBy()` returns a copy.**
    - Mutations of the returned array have no effect on the collection. No code should
      ever have relied on the old behavior, but if something did, it was silently
      corrupting indexes.

11. **`applyTagByIndexes()` does not short-circuit.**
    - Given `[0, 999, 1]`, index `1` is now tagged even though `999` failed. Previously
      `1` would have been skipped. The return value is still `false` because not every
      application succeeded — but the state is now what the caller intuitively expected.

12. **`clear()` purges the searchable index.**
    - If you depended on stale doc ids surviving a clear (no known reason), they are now
      gone.

13. **Dump format changed (additive).**
    - New fields: `version`, `allowNextPrevCycle`, `allowUnconfiguredTags`.
    - Changed types: `cardinality` and `tagConfigs.*.cardinality` are now `number | null`
      (was `number`), because `JSON.stringify(Infinity)` produces `null`. Consumers that
      typed the dump strictly may need to widen the type.
    - Legacy dumps still restore — missing fields no longer overwrite the collection's
      current settings.

14. **Internal representation of `sortFn` / `normalizeFn`.**
    - `#sortFn` is now `undefined` by default (was a no-op comparator). No observable
      change unless you relied on `sort()` always returning `true`.
    - `configure({ sortFn: null })` now unsets (was silently ignored).

## What was NOT changed

- Method signatures (all public methods accept the same parameters with the same types —
  except where `cardinality` is now `number | null` on the dump).
- Constructor options (all existing options behave the same; no new required options).
- Tag storage model (still index-based internally — flagged for a future rewrite to
  id-based, which would eliminate `#updateTagsOnMove` / `#updateTagsOnRemove`).

## Migration

For the vast majority of users, no changes are required. Drop-in upgrade.

Specific scenarios:

- **Persisted dumps from 1.3.x:** restore as before. New fields inherit from the
  currently-configured collection.
- **Subscribers using call counts as signal:** read state from the callback payload
  instead.
- **Code mutating `collection.config.*`:** switch to `configure()` / `configureTag()`.

## Files changed

- `src/item-collection.ts` — all fixes.
- `tests/item-collection.test.ts` — 20 new regression tests (all 18 original tests still
  pass).
- `README.md`, `API.md`, `AGENTS.md` — documentation updated.
