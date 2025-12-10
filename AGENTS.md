# AGENTS.md

Machine-readable context for AI agents working with this codebase.

## Package Overview

- **Name:** `@marianmeres/item-collection`
- **Type:** Generic collection manager with active item tracking, tagging, and full-text search
- **Runtime:** Deno-first, cross-published to npm
- **Language:** TypeScript
- **Dependencies:** `@marianmeres/pubsub` (reactivity), `@marianmeres/searchable` (full-text search)
- **License:** MIT

## Architecture

### File Structure

```
src/
  mod.ts              # Re-exports from item-collection.ts
  item-collection.ts  # All implementation code (~1400 lines)
tests/
  item-collection.test.ts  # All tests (18 tests)
scripts/
  build-npm.ts        # npm build script
```

### Core Design

Single-class implementation with:
- `ItemCollection<T>` - Generic collection class
- Private `#items: T[]` array storage
- Private `#indexesByProperty: Map<string, Map<any, number[]>>` for O(1) lookups
- Private `#tags: Map<string, Set<number>>` for tag management
- Integrates `PubSub` for reactivity
- Optional `Searchable` integration for full-text search

## Public API

### Exports

| Export | Type | Description |
|--------|------|-------------|
| `ItemCollection` | class | Main collection implementation |
| `Item` | interface | Base interface `Record<string, any>` |
| `ItemCollectionConfig<T>` | interface | Constructor options |
| `ItemCollectionDump<T>` | interface | Serialization format |
| `ItemCollectionSearchableOptions<T>` | interface | Search configuration |
| `ExposedConfig` | interface | Readonly config returned by `.config` |

### Properties (Getters)

| Property | Type | Description |
|----------|------|-------------|
| `size` | `number` | Current item count |
| `items` | `T[]` | Shallow copy of all items |
| `active` | `T \| undefined` | Currently active item |
| `activeIndex` | `number \| undefined` | Index of active item |
| `isFull` | `boolean` | True if at cardinality limit |
| `config` | `ExposedConfig` | Current configuration |
| `idPropName` | `string` | Configured ID property name |
| `searchable` | `Searchable \| undefined` | Search instance if configured |

### Collection Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `configure(options, publish?)` | `ItemCollection<T>` | Update configuration |
| `add(item, autoSort?, publish?)` | `boolean` | Add single item |
| `addMany(items, publish?)` | `number` | Add multiple items |
| `remove(item, publish?)` | `boolean` | Remove item by id |
| `removeAt(index, publish?)` | `boolean` | Remove item at index |
| `removeAllBy(property, value, publish?)` | `number` | Remove all matching items |
| `patch(item, publish?)` | `boolean` | Update item in place |
| `patchMany(items, publish?)` | `number` | Update multiple items |
| `toggleAdd(item, publish?)` | `boolean` | Add if absent, remove if present |
| `move(fromIndex, toIndex, publish?)` | `boolean` | Reorder item |
| `clear(publish?)` | `ItemCollection<T>` | Remove all items |
| `sort(sortFn?, publish?)` | `boolean` | Sort collection |
| `at(index)` | `T \| undefined` | Get item (supports negative index) |
| `getAll()` | `T[]` | Get all items (shallow copy) |

### Navigation Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `setActive(item, publish?)` | `boolean` | Set active by item |
| `setActiveIndex(index, publish?)` | `T \| undefined` | Set active by index |
| `unsetActive(publish?)` | `ItemCollection<T>` | Clear active state |
| `setActiveNext()` | `T \| undefined` | Navigate forward |
| `setActivePrevious()` | `T \| undefined` | Navigate backward |
| `setActiveFirst()` | `T \| undefined` | Navigate to first |
| `setActiveLast()` | `T \| undefined` | Navigate to last |

### Lookup Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `exists(idOrItem)` | `boolean` | Check item existence |
| `findById(id)` | `T \| undefined` | Find by id property |
| `findBy(property, value)` | `T \| undefined` | Find by any property |
| `findAllBy(property, value)` | `T[]` | Find all matching |
| `findIndexBy(property, value)` | `number` | Find first index (-1 if not found) |
| `findAllIndexesBy(property, value)` | `number[]` | Find all matching indexes |
| `search(query, strategy?, options?)` | `T[]` | Full-text search (requires searchable config) |

### Tag Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `configureTag(tagName, config?, publish?)` | `boolean` | Configure tag cardinality |
| `applyTag(item, tagName, publish?)` | `boolean` | Tag item by reference |
| `applyTagByIndex(index, tagName, publish?)` | `boolean` | Tag item by index |
| `applyTagByIndexes(indexes, tagName, publish?)` | `boolean` | Tag multiple items |
| `removeTag(item, tagName, publish?)` | `boolean` | Remove tag by reference |
| `removeTagByIndex(index, tagName, publish?)` | `boolean` | Remove tag by index |
| `removeTagByIndexes(indexes, tagName, publish?)` | `boolean` | Remove tag from multiple |
| `hasTag(item, tagName)` | `boolean` | Check if item has tag |
| `hasTagByIndex(index, tagName)` | `boolean` | Check by index |
| `getByTag(tagName)` | `T[]` | Get all items with tag |
| `getIndexesByTag(tagName)` | `number[]` | Get indexes with tag |
| `toggleTag(item, tagName, publish?)` | `boolean` | Toggle tag (true=applied, false=removed) |
| `toggleTagByIndex(index, tagName, publish?)` | `boolean \| undefined` | Toggle by index |
| `deleteTag(tagName, publish?)` | `boolean` | Remove tag completely |

### Serialization Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `toJSON()` | `ItemCollectionDump<T>` | Export as object |
| `dump()` | `string` | Export as JSON string |
| `restore(dump)` | `boolean` | Import from string/object |

### Static Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `ItemCollection.fromJSON<T>(json)` | `ItemCollection<T>` | Create from JSON string |

### Reactivity

| Method | Returns | Description |
|--------|---------|-------------|
| `subscribe(cb)` | `() => void` | Subscribe to changes (immediate initial call) |

Callback receives:
```ts
{
  items: T[];
  active: T | undefined;
  activeIndex: number | undefined;
  size: number;
  isFull: boolean;
  config: ExposedConfig;
  timestamp: Date;
  lastQuery: LastQuery | undefined;
}
```

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `cardinality` | `number` | `Infinity` | Maximum items allowed |
| `unique` | `boolean` | `true` | Prevent duplicates by id |
| `idPropName` | `string` | `"id"` | Property used as unique identifier |
| `allowNextPrevCycle` | `boolean` | `false` | Wrap navigation at ends |
| `allowUnconfiguredTags` | `boolean` | `true` | Allow ad-hoc tags |
| `tags` | `Record<string, {cardinality}>` | `{}` | Pre-configured tags |
| `sortFn` | `(a, b) => number` | `undefined` | Auto-sort on add |
| `normalizeFn` | `(item) => T` | string-to-object | Transform before add |
| `searchable` | `{getContent: (item) => string}` | `undefined` | Enable full-text search (constructor only) |

## Key Behaviors

### Uniqueness

- Default: items with same id property are rejected
- Set `unique: false` to allow duplicates
- Uniqueness checked on `add()`, not enforced retroactively

### Property Indexing

- O(1) lookups via automatic property indexing
- Indexes built on-demand when first queried
- Rebuilt automatically on add/remove/sort

### Tag System

- Tags are string labels applied to items by index
- Each tag can have cardinality limit (max items)
- Tags auto-adjust when items move/remove
- Use `cardinality: 1` for single-selection patterns

### Navigation

- `setActiveNext()`/`setActivePrevious()` respect `allowNextPrevCycle`
- Without cycle: stops at ends
- With cycle: wraps around

### Searchable Integration

- Requires `searchable.getContent` function in constructor
- Cannot be configured after construction
- Three strategies: `"exact"`, `"prefix"` (default), `"fuzzy"`
- Search triggers reactivity for `lastQuery` updates

### Serialization

- `dump()`/`restore()` preserves: items, activeIndex, cardinality, unique, idPropName, tags, tagConfigs
- Does NOT preserve: sortFn, normalizeFn, searchable config
- `restore()` on unique collection removes duplicates

## Development Commands

```bash
deno test              # Run tests once
deno task test:watch   # Run tests in watch mode
deno task npm:build    # Build npm package
deno task npm:publish  # Build and publish to npm
deno task rp           # Release and publish (JSR + npm)
```

## Testing

- Framework: Deno test
- Location: `tests/item-collection.test.ts`
- Test count: 18 tests
- Coverage: All public methods and edge cases

## Code Style

- Tabs for indentation
- Line width: 90
- No explicit `any` lint warnings (disabled)
- Uses Deno fmt
- Private members use `#` prefix

## Publishing

- JSR: Publish via `deno publish`
- npm: Build with `deno task npm:build`, outputs to `.npm-dist/`
- Uses `@marianmeres/npmbuild` for npm package generation

## Common Patterns

### Basic Collection

```ts
const users = new ItemCollection<User>([
  { id: '1', name: 'Alice' },
  { id: '2', name: 'Bob' },
]);
users.add({ id: '3', name: 'Charlie' });
```

### Selection Management

```ts
const items = new ItemCollection<Product>(products, {
  tags: { selected: { cardinality: Infinity } }
});
items.toggleTag(product, 'selected');
const selected = items.getByTag('selected');
```

### Single Active (Radio Pattern)

```ts
const tabs = new ItemCollection<Tab>(tabList);
tabs.setActiveFirst();
tabs.setActiveNext();
console.log(tabs.active);
```

### Keyboard Navigation

```ts
const menu = new ItemCollection<MenuItem>(items, {
  allowNextPrevCycle: true
});
// Arrow keys: menu.setActiveNext() / menu.setActivePrevious()
```

### Searchable Collection

```ts
const contacts = new ItemCollection<Contact>([], {
  searchable: { getContent: (c) => `${c.name} ${c.email}` }
});
contacts.addMany(data);
const results = contacts.search('john', 'prefix');
```

### Persistence

```ts
localStorage.setItem('col', collection.dump());
collection.restore(localStorage.getItem('col'));
// Or: const restored = ItemCollection.fromJSON<T>(json);
```

### Reactive UI Integration

```ts
const collection = new ItemCollection<T>(items);
const unsubscribe = collection.subscribe(({ items, active, size }) => {
  // Update UI
});
```
