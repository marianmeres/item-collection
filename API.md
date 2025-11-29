# API Reference

Complete API documentation for `@marianmeres/item-collection`.

## Table of Contents

- [Constructor](#constructor)
- [Properties](#properties)
- [Collection Management](#collection-management)
- [Active Item Navigation](#active-item-navigation)
- [Lookups & Search](#lookups--search)
- [Tagging System](#tagging-system)
- [Serialization](#serialization)
- [Reactivity](#reactivity)
- [Static Methods](#static-methods)
- [Types](#types)

---

## Constructor

### `new ItemCollection<T>(initial?, options?)`

Creates a new ItemCollection instance.

```typescript
const collection = new ItemCollection<{ id: string; name: string }>(
  [{ id: '1', name: 'Item 1' }],
  { cardinality: 100, unique: true }
);
```

**Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `initial` | `T[]` | `[]` | Array of initial items to add |
| `options` | `Partial<ItemCollectionConfig<T>>` | `{}` | Configuration options |

**Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `cardinality` | `number` | `Infinity` | Maximum number of items allowed |
| `unique` | `boolean` | `true` | Prevent duplicate items (by id) |
| `idPropName` | `string` | `"id"` | Property name used as unique identifier |
| `allowNextPrevCycle` | `boolean` | `false` | Allow navigation to wrap around |
| `allowUnconfiguredTags` | `boolean` | `true` | Allow tags without explicit configuration |
| `tags` | `Record<string, { cardinality: number }>` | `{}` | Pre-configured tags with cardinality limits |
| `sortFn` | `(a: T, b: T) => number` | `undefined` | Auto-sort function applied on add |
| `normalizeFn` | `(item: any) => T` | `undefined` | Transform function applied to items before adding |
| `searchable` | `ItemCollectionSearchableOptions<T>` | `undefined` | Enable full-text search (constructor only) |

---

## Properties

### `size`

Get the current number of items in the collection.

```typescript
get size(): number
```

**Returns:** The number of items in the collection.

---

### `items`

Get all items in the collection as a shallow copy.

```typescript
get items(): T[]
```

**Returns:** Array of all items (alias for `getAll()`).

---

### `active`

Get the currently active item.

```typescript
get active(): T | undefined
```

**Returns:** The active item, or `undefined` if no item is active.

---

### `activeIndex`

Get the currently active index (readonly).

```typescript
get activeIndex(): number | undefined
```

**Returns:** The index of the active item, or `undefined` if no item is active.

---

### `isFull`

Check if the collection has reached its cardinality limit.

```typescript
get isFull(): boolean
```

**Returns:** `true` if collection is full, `false` otherwise.

---

### `config`

Get the current configuration options.

```typescript
get config(): ExposedConfig
```

**Returns:** The collection configuration object containing `cardinality`, `tags`, `allowNextPrevCycle`, `allowUnconfiguredTags`, `unique`, and `idPropName`.

---

### `idPropName`

Get the configured "id" property name.

```typescript
get idPropName(): string
```

**Returns:** The name of the property used as the unique identifier.

---

### `searchable`

Get the searchable instance (if configured).

```typescript
get searchable(): Searchable | undefined
```

**Returns:** The Searchable instance, or `undefined` if not configured.

---

## Collection Management

### `configure(options, publish?)`

Update collection configuration options.

```typescript
configure(
  options: Partial<ItemCollectionConfig<T>>,
  publish?: boolean
): ItemCollection<T>
```

**Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `options` | `Partial<ItemCollectionConfig<T>>` | - | Configuration options to update |
| `publish` | `boolean` | `true` | Whether to notify subscribers |

**Returns:** This collection instance for chaining.

**Throws:** `TypeError` if attempting to configure searchable options (must be set in constructor).

---

### `add(item, autoSort?, publish?)`

Add an item to the collection.

```typescript
add(item: T, autoSort?: boolean, publish?: boolean): boolean
```

**Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `item` | `T` | - | The item to add |
| `autoSort` | `boolean` | `true` | Whether to auto-sort after adding |
| `publish` | `boolean` | `true` | Whether to notify subscribers |

**Returns:** `true` if added successfully, `false` if cardinality reached or duplicate (when `unique=true`).

---

### `addMany(items, publish?)`

Add multiple items to the collection.

```typescript
addMany(items: T[], publish?: boolean): number
```

**Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `items` | `T[]` | - | Array of items to add |
| `publish` | `boolean` | `true` | Whether to notify subscribers |

**Returns:** The number of items successfully added.

---

### `toggleAdd(item, publish?)`

Toggle an item's presence in the collection (add if absent, remove if present).

```typescript
toggleAdd(item: T, publish?: boolean): boolean
```

**Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `item` | `T` | - | The item to toggle |
| `publish` | `boolean` | `true` | Whether to notify subscribers |

**Returns:** `true` if item was added, `false` if item was removed.

---

### `patch(item, publish?)`

Update an existing item in place (matched by id).

```typescript
patch(item: T | undefined, publish?: boolean): boolean
```

Useful for optimistic UI strategies where you want to update without removing/re-adding.

**Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `item` | `T \| undefined` | - | The item to patch (must have matching id) |
| `publish` | `boolean` | `true` | Whether to notify subscribers |

**Returns:** `true` if item was patched, `false` if item not found.

---

### `patchMany(items, publish?)`

Update multiple existing items in place (matched by id).

```typescript
patchMany(items: (T | undefined)[], publish?: boolean): number
```

**Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `items` | `(T \| undefined)[]` | - | Array of items to patch |
| `publish` | `boolean` | `true` | Whether to notify subscribers |

**Returns:** The number of items successfully patched.

---

### `remove(item, publish?)`

Remove an item from the collection.

```typescript
remove(item: T | undefined, publish?: boolean): boolean
```

**Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `item` | `T \| undefined` | - | The item to remove (matched by id) |
| `publish` | `boolean` | `true` | Whether to notify subscribers |

**Returns:** `true` if removed, `false` if item not found.

---

### `removeAt(index, publish?)`

Remove an item at the specified index.

```typescript
removeAt(index: number, publish?: boolean): boolean
```

Automatically adjusts active index and tag references.

**Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `index` | `number` | - | The index of the item to remove |
| `publish` | `boolean` | `true` | Whether to notify subscribers |

**Returns:** `true` if removed, `false` if index out of bounds.

---

### `removeAllBy(property, value, publish?)`

Remove all items matching a property value.

```typescript
removeAllBy(property: string, value: any, publish?: boolean): number
```

**Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `property` | `string` | - | The property name to match |
| `value` | `any` | - | The value to match |
| `publish` | `boolean` | `true` | Whether to notify subscribers |

**Returns:** The number of items removed.

---

### `move(fromIndex, toIndex, publish?)`

Move an item from one position to another.

```typescript
move(fromIndex: number, toIndex: number, publish?: boolean): boolean
```

Automatically maintains tag references and active index.

**Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `fromIndex` | `number` | - | Source index (0-based) |
| `toIndex` | `number` | - | Destination index (0-based) |
| `publish` | `boolean` | `true` | Whether to notify subscribers |

**Returns:** `true` if successful, `false` if indexes are invalid.

---

### `at(index)`

Get the item at the specified index.

```typescript
at(index: number): T | undefined
```

Proxies to native Array's `.at()` so negative indexes are allowed.

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `index` | `number` | The index (supports negative indexing) |

**Returns:** The item at the specified index, or `undefined` if out of bounds.

**Example:**

```typescript
collection.at(0)   // first item
collection.at(-1)  // last item
```

---

### `getAll()`

Get all items in the collection as a shallow copy.

```typescript
getAll(): T[]
```

**Returns:** Array containing all items.

---

### `clear(publish?)`

Clear all items from the collection.

```typescript
clear(publish?: boolean): ItemCollection<T>
```

Also clears active index and resets all tag associations.

**Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `publish` | `boolean` | `true` | Whether to notify subscribers |

**Returns:** This collection instance for chaining.

---

### `sort(sortFn?, publish?)`

Sort the collection with a custom or default sort function.

```typescript
sort(sortFn?: (a: T, b: T) => number, publish?: boolean): boolean
```

Note: Normally not needed as collection auto-sorts on add if `sortFn` configured.

**Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `sortFn` | `(a: T, b: T) => number` | configured `sortFn` | Sort function to use |
| `publish` | `boolean` | `true` | Whether to notify subscribers |

**Returns:** `true` if sorted, `false` if no sort function available.

---

## Active Item Navigation

### `setActive(item, publish?)`

Set the active item by reference.

```typescript
setActive(item: T | undefined, publish?: boolean): boolean
```

**Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `item` | `T \| undefined` | - | The item to set as active (matched by id) |
| `publish` | `boolean` | `true` | Whether to notify subscribers |

**Returns:** `true` if successful, `false` if item not found or undefined.

---

### `setActiveIndex(index, publish?)`

Set the active item by index number.

```typescript
setActiveIndex(index: number, publish?: boolean): T | undefined
```

**Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `index` | `number` | - | The index (uses modulo for wrapping) |
| `publish` | `boolean` | `true` | Whether to notify subscribers |

**Returns:** The newly active item, or `undefined` if collection is empty.

---

### `unsetActive(publish?)`

Unmark the currently active item.

```typescript
unsetActive(publish?: boolean): ItemCollection<T>
```

**Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `publish` | `boolean` | `true` | Whether to notify subscribers |

**Returns:** This collection instance for chaining.

---

### `setActiveNext()`

Move to the next item and make it active.

```typescript
setActiveNext(): T | undefined
```

Respects `allowNextPrevCycle` configuration for wrapping behavior.

**Returns:** The newly active item, or `undefined` if collection is empty.

---

### `setActivePrevious()`

Move to the previous item and make it active.

```typescript
setActivePrevious(): T | undefined
```

Respects `allowNextPrevCycle` configuration for wrapping behavior.

**Returns:** The newly active item, or `undefined` if collection is empty.

---

### `setActiveFirst()`

Move to the first item and make it active.

```typescript
setActiveFirst(): T | undefined
```

**Returns:** The first item, or `undefined` if collection is empty.

---

### `setActiveLast()`

Move to the last item and make it active.

```typescript
setActiveLast(): T | undefined
```

**Returns:** The last item, or `undefined` if collection is empty.

---

## Lookups & Search

### `exists(idOrItem)`

Check if an item exists in the collection.

```typescript
exists(idOrItem: string | T): boolean
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `idOrItem` | `string \| T` | The item id (string) or item object to check |

**Returns:** `true` if exists, `false` otherwise.

---

### `findById(id)`

Find the first item by its id.

```typescript
findById(id: string): T | undefined
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | `string` | The id value to search for |

**Returns:** The first matching item, or `undefined` if not found.

---

### `findBy(property, value)`

Find the first item matching a property value.

```typescript
findBy(property: string, value: any): T | undefined
```

Uses optimized indexing for O(1) lookups.

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `property` | `string` | The property name to match |
| `value` | `any` | The value to match |

**Returns:** The first matching item, or `undefined` if not found.

---

### `findAllBy(property, value)`

Find all items matching a property value.

```typescript
findAllBy(property: string, value: any): T[]
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `property` | `string` | The property name to match |
| `value` | `any` | The value to match |

**Returns:** Array of all matching items (empty array if none found).

---

### `findIndexBy(property, value)`

Find the index of the first item matching a property value.

```typescript
findIndexBy(property: string, value: any): number
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `property` | `string` | The property name to match |
| `value` | `any` | The value to match |

**Returns:** The index of the first match, or `-1` if not found.

---

### `findAllIndexesBy(property, value)`

Find all indexes of items matching a property value.

```typescript
findAllIndexesBy(property: string, value: any): number[]
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `property` | `string` | The property name to match |
| `value` | `any` | The value to match |

**Returns:** Array of all matching indexes (empty array if none found).

---

### `search(query, strategy?, options?)`

Search items using full-text search.

```typescript
search(
  query: string,
  strategy?: "exact" | "prefix" | "fuzzy",
  options?: Partial<{ maxDistance: number }>
): T[]
```

Requires `searchable` to be configured in constructor.

**Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `query` | `string` | - | The search query string |
| `strategy` | `"exact" \| "prefix" \| "fuzzy"` | `"prefix"` | Search strategy |
| `options` | `{ maxDistance?: number }` | `{}` | Additional options (e.g., for fuzzy search) |

**Returns:** Array of matching items.

**Throws:** `TypeError` if searchable was not configured.

---

## Tagging System

### `configureTag(tagName, config?, publish?)`

Configure or update a tag's options.

```typescript
configureTag(
  tagName: string,
  config?: { cardinality: number },
  publish?: boolean
): boolean
```

**Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `tagName` | `string` | - | The name of the tag to configure |
| `config` | `{ cardinality: number }` | `{ cardinality: Infinity }` | Tag configuration |
| `publish` | `boolean` | `true` | Whether to notify subscribers |

**Returns:** `true` always (creates tag if it doesn't exist).

---

### `applyTag(item, tagName, publish?)`

Apply a tag to an item.

```typescript
applyTag(item: T | undefined, tagName: string, publish?: boolean): boolean
```

**Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `item` | `T \| undefined` | - | The item to tag (matched by id) |
| `tagName` | `string` | - | The name of the tag to apply |
| `publish` | `boolean` | `true` | Whether to notify subscribers |

**Returns:** `true` if successful, `false` if item not found or cardinality reached.

---

### `applyTagByIndex(index, tagName, publish?)`

Apply a tag to an item at the specified index.

```typescript
applyTagByIndex(index: number, tagName: string, publish?: boolean): boolean
```

**Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `index` | `number` | - | The index of the item to tag |
| `tagName` | `string` | - | The name of the tag to apply |
| `publish` | `boolean` | `true` | Whether to notify subscribers |

**Returns:** `true` if successful, `false` if index out of bounds or cardinality reached.

---

### `applyTagByIndexes(indexes, tagName, publish?)`

Apply a tag to items at multiple indexes.

```typescript
applyTagByIndexes(indexes: number[], tagName: string, publish?: boolean): boolean
```

**Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `indexes` | `number[]` | - | Array of indexes to tag |
| `tagName` | `string` | - | The name of the tag to apply |
| `publish` | `boolean` | `true` | Whether to notify subscribers |

**Returns:** `true` if all successful, `false` if any failed.

---

### `removeTag(item, tagName, publish?)`

Remove a tag from an item.

```typescript
removeTag(item: T | undefined, tagName: string, publish?: boolean): boolean
```

**Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `item` | `T \| undefined` | - | The item to untag (matched by id) |
| `tagName` | `string` | - | The name of the tag to remove |
| `publish` | `boolean` | `true` | Whether to notify subscribers |

**Returns:** `true` if successful, `false` if item not found or tag not present.

---

### `removeTagByIndex(index, tagName, publish?)`

Remove a tag from an item at the specified index.

```typescript
removeTagByIndex(index: number, tagName: string, publish?: boolean): boolean
```

**Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `index` | `number` | - | The index of the item to untag |
| `tagName` | `string` | - | The name of the tag to remove |
| `publish` | `boolean` | `true` | Whether to notify subscribers |

**Returns:** `true` if successful, `false` if index out of bounds or tag not present.

---

### `removeTagByIndexes(indexes, tagName, publish?)`

Remove a tag from items at multiple indexes.

```typescript
removeTagByIndexes(indexes: number[], tagName: string, publish?: boolean): boolean
```

**Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `indexes` | `number[]` | - | Array of indexes to untag |
| `tagName` | `string` | - | The name of the tag to remove |
| `publish` | `boolean` | `true` | Whether to notify subscribers |

**Returns:** `true` if at least one was successful, `false` otherwise.

---

### `hasTag(item, tagName)`

Check if an item has a specific tag.

```typescript
hasTag(item: T | undefined, tagName: string): boolean
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `item` | `T \| undefined` | The item to check (matched by id) |
| `tagName` | `string` | The name of the tag to check |

**Returns:** `true` if item has the tag, `false` otherwise.

---

### `hasTagByIndex(index, tagName)`

Check if an item at the specified index has a specific tag.

```typescript
hasTagByIndex(index: number, tagName: string): boolean
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `index` | `number` | The index of the item to check |
| `tagName` | `string` | The name of the tag to check |

**Returns:** `true` if item has the tag, `false` otherwise.

---

### `getByTag(tagName)`

Get all items with a specific tag.

```typescript
getByTag(tagName: string): T[]
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `tagName` | `string` | The name of the tag |

**Returns:** Array of all items with the tag (empty array if tag not found).

---

### `getIndexesByTag(tagName)`

Get indexes of all items with a specific tag.

```typescript
getIndexesByTag(tagName: string): number[]
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `tagName` | `string` | The name of the tag |

**Returns:** Array of all indexes with the tag (empty array if tag not found).

---

### `toggleTag(item, tagName, publish?)`

Toggle a tag on an item (apply if absent, remove if present).

```typescript
toggleTag(item: T | undefined, tagName: string, publish?: boolean): boolean
```

**Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `item` | `T \| undefined` | - | The item to toggle tag on (matched by id) |
| `tagName` | `string` | - | The name of the tag to toggle |
| `publish` | `boolean` | `true` | Whether to notify subscribers |

**Returns:** `true` if tag was applied, `false` if tag was removed.

---

### `toggleTagByIndex(index, tagName, publish?)`

Toggle a tag on an item by index.

```typescript
toggleTagByIndex(index: number, tagName: string, publish?: boolean): boolean | undefined
```

**Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `index` | `number` | - | The index of the item |
| `tagName` | `string` | - | The name of the tag to toggle |
| `publish` | `boolean` | `true` | Whether to notify subscribers |

**Returns:** `true` if tag was applied, `false` if tag was removed, `undefined` if item not found.

---

### `deleteTag(tagName, publish?)`

Delete a tag completely from the collection.

```typescript
deleteTag(tagName: string, publish?: boolean): boolean
```

Removes the tag from all items and deletes its configuration.

**Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `tagName` | `string` | - | The name of the tag to delete |
| `publish` | `boolean` | `true` | Whether to notify subscribers |

**Returns:** `true` if deleted, `false` if tag didn't exist.

---

## Serialization

### `toJSON()`

Export collection state to a JSON-serializable object.

```typescript
toJSON(): ItemCollectionDump<T>
```

**Returns:** A dump object containing all collection state.

---

### `dump()`

Serialize the collection to a JSON string.

```typescript
dump(): string
```

**Returns:** JSON string representation of the collection.

---

### `restore(dump)`

Restore collection state from a serialized dump.

```typescript
restore(dump: string | ItemCollectionDump<T>): boolean
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `dump` | `string \| ItemCollectionDump<T>` | JSON string or dump object to restore from |

**Returns:** `true` if successful, `false` if failed.

---

## Reactivity

### `subscribe(cb)`

Subscribe to collection changes.

```typescript
subscribe(
  cb: (data: {
    items: T[];
    active: T | undefined;
    activeIndex: number | undefined;
    size: number;
    isFull: boolean;
    config: ExposedConfig;
    timestamp: Date;
    lastQuery: LastQuery | undefined;
  }) => void
): () => void
```

The callback is immediately invoked with current state.

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `cb` | `function` | Callback function to invoke on changes |

**Returns:** Unsubscribe function.

**Example:**

```typescript
const unsubscribe = collection.subscribe((data) => {
  console.log('Items:', data.items);
  console.log('Active:', data.active);
});

// Later, when done:
unsubscribe();
```

---

## Static Methods

### `ItemCollection.fromJSON<T>(json)`

Create a new ItemCollection from a JSON dump string.

```typescript
static fromJSON<T extends Item>(json: string): ItemCollection<T>
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `json` | `string` | JSON string to restore from |

**Returns:** New ItemCollection instance (empty if restore fails).

---

## Types

### `Item`

Base interface for collection items.

```typescript
interface Item extends Record<string, any> {}
```

---

### `ItemCollectionConfig<T>`

Configuration options for ItemCollection.

```typescript
interface ItemCollectionConfig<T> {
  cardinality: number;
  tags: Record<string, { cardinality: number }>;
  allowNextPrevCycle: boolean;
  allowUnconfiguredTags: boolean;
  unique: boolean;
  idPropName: string;
  sortFn: undefined | ((a: T, b: T) => number);
  normalizeFn: undefined | ((item: any) => T);
  searchable: ItemCollectionSearchableOptions<T> | undefined | null;
}
```

---

### `ItemCollectionDump<T>`

Serializable dump output.

```typescript
interface ItemCollectionDump<T> {
  items: T[];
  activeIndex: number | undefined;
  cardinality: number;
  unique: boolean;
  idPropName: string;
  tags: Record<string, number[]>;
  tagConfigs: Record<string, { cardinality: number }>;
}
```

---

### `ItemCollectionSearchableOptions<T>`

Options for enabling full-text search.

```typescript
interface ItemCollectionSearchableOptions<T> extends Partial<SearchableOptions> {
  getContent: (item: T) => string | undefined;
}
```

---

### `ExposedConfig`

Configuration object returned by the `config` property.

```typescript
interface ExposedConfig {
  cardinality: number;
  tags: Record<string, { cardinality: number }>;
  allowNextPrevCycle: boolean;
  allowUnconfiguredTags: boolean;
  unique: boolean;
  idPropName: string;
}
```
