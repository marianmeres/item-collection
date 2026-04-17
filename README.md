# @marianmeres/item-collection

[![NPM Version](https://img.shields.io/npm/v/@marianmeres/item-collection)](https://www.npmjs.com/package/@marianmeres/item-collection)
[![JSR Version](https://jsr.io/badges/@marianmeres/item-collection)](https://jsr.io/@marianmeres/item-collection)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A versatile, high-performance TypeScript utility class for managing collections of items
with advanced features.

## Features

- **Ordered collection** with customizable sort function
- **Uniqueness and cardinality constraints** to control collection behavior
- **Active item tracking** with navigation (next/prev/first/last)
- **Flexible tagging system** with per-tag cardinality limits
- **O(1) lookups** via automatic property indexing
- **Full-text search** integration via
  [@marianmeres/searchable](https://github.com/marianmeres/searchable)
- **Reactive subscriptions** for change notifications
- **Serialization** with dump/restore support

## Installation

```sh
# Deno
deno add jsr:@marianmeres/item-collection
```

```sh
# Node.js
npm install @marianmeres/item-collection
```

## Quick Start

```typescript
import { ItemCollection } from "@marianmeres/item-collection";

// Create a collection
const collection = new ItemCollection<{ id: string; name: string }>([
	{ id: "1", name: "Alice" },
	{ id: "2", name: "Bob" },
	{ id: "3", name: "Charlie" },
]);

// Navigate items
collection.setActiveFirst(); // { id: '1', name: 'Alice' }
collection.setActiveNext(); // { id: '2', name: 'Bob' }

// Find items (O(1) lookup)
collection.findById("3"); // { id: '3', name: 'Charlie' }
collection.findBy("name", "Bob"); // { id: '2', name: 'Bob' }

// Tag items for flexible categorization
collection.applyTag(collection.at(0), "featured");
collection.applyTag(collection.at(2), "featured");
collection.getByTag("featured"); // [Alice, Charlie]

// Subscribe to changes
const unsubscribe = collection.subscribe(({ items, active, size }) => {
	console.log(`Collection has ${size} items, active: ${active?.name}`);
});
```

## Configuration Options

```typescript
const collection = new ItemCollection<T>(initialItems, {
	// Maximum number of items (default: Infinity)
	cardinality: 100,

	// Prevent duplicate items by id (default: true)
	unique: true,

	// Property name used as unique identifier (default: "id")
	idPropName: "id",

	// Allow next/prev navigation to wrap around (default: false)
	allowNextPrevCycle: true,

	// Allow tags without explicit configuration (default: true)
	allowUnconfiguredTags: true,

	// Pre-configure tags with cardinality limits
	tags: {
		selected: { cardinality: 5 }, // max 5 items can have this tag
		favorite: { cardinality: 1 }, // only 1 item can be favorite
	},

	// Auto-sort function applied on add
	sortFn: (a, b) => a.name.localeCompare(b.name),

	// Transform items before adding
	normalizeFn: (item) => ({ ...item, createdAt: new Date() }),

	// Enable full-text search
	searchable: {
		getContent: (item) => `${item.name} ${item.description}`,
	},
});
```

## Common Use Cases

### Selection Management

```typescript
const items = new ItemCollection<Product>(products, {
	tags: { selected: { cardinality: Infinity } },
});

// Toggle selection
items.toggleTag(product, "selected");

// Get selected items
const selected = items.getByTag("selected");

// Clear selection
items.deleteTag("selected");
```

### Single Active Item (Radio-like)

```typescript
const tabs = new ItemCollection<Tab>(tabList);

// Set active by item reference
tabs.setActive(tabs.at(0));
console.log(tabs.active); // first tab

// Set active by index
tabs.setActiveIndex(2);
console.log(tabs.active); // third tab

// Navigate
tabs.setActiveNext(); // fourth tab (or stays if at end)
tabs.setActivePrevious(); // back to third tab

// Clear active state
tabs.unsetActive();
console.log(tabs.active); // undefined
```

> **Tip:** For multiple "active-like" states (e.g., selected + focused), use tags with
> `cardinality: 1` constraint instead.

### Keyboard Navigation

```typescript
const menu = new ItemCollection<MenuItem>(menuItems, {
	allowNextPrevCycle: true, // wrap around at ends
});

document.addEventListener("keydown", (e) => {
	if (e.key === "ArrowDown") menu.setActiveNext();
	if (e.key === "ArrowUp") menu.setActivePrevious();
	if (e.key === "Home") menu.setActiveFirst();
	if (e.key === "End") menu.setActiveLast();
});
```

### Searchable Collection

```typescript
const contacts = new ItemCollection<Contact>([], {
	searchable: {
		getContent: (c) => `${c.name} ${c.email} ${c.phone}`,
	},
});

contacts.addMany(fetchedContacts);

// Search with different strategies
contacts.search("john"); // prefix match (default)
contacts.search("john@example.com", "exact"); // exact match
contacts.search("jon", "fuzzy"); // fuzzy match
```

### Persistence

```typescript
// Save state
localStorage.setItem("myCollection", collection.dump());

// Restore state
collection.restore(localStorage.getItem("myCollection"));

// Or create new instance from JSON
const restored = ItemCollection.fromJSON<MyItem>(savedJson);
```

> **Note on `Infinity`:** `JSON.stringify(Infinity)` produces `null`. The dump format
> encodes `cardinality: Infinity` (both collection-level and per-tag) as `null` on the
> wire; `restore()` converts `null` back to `Infinity`. This is handled transparently for
> dumps produced by this library, and legacy dumps from earlier versions are restored
> correctly.

### Batching Notifications

Group multiple mutations so subscribers see only one change event:

```typescript
collection.batch(() => {
	collection.add(newItem);
	collection.applyTag(newItem, "featured");
	collection.setActive(newItem);
}); // subscribers notified exactly once
```

Nested `batch()` calls are supported; only the outermost flushes. If the callback throws,
any pending notification is still flushed so subscribers observe the partial state that
actually took effect.

## API Reference

For the complete API documentation, see [API.md](./API.md).

### Quick Reference

| Category          | Methods                                                                                                               |
| ----------------- | --------------------------------------------------------------------------------------------------------------------- |
| **Collection**    | `add`, `addMany`, `remove`, `removeAt`, `removeAllBy`, `move`, `clear`, `patch`, `patchMany`, `toggleAdd`             |
| **Navigation**    | `setActive`, `setActiveIndex`, `unsetActive`, `setActiveNext`, `setActivePrevious`, `setActiveFirst`, `setActiveLast` |
| **Lookups**       | `at`, `exists`, `findById`, `findBy`, `findAllBy`, `findIndexBy`, `findAllIndexesBy`, `search`                        |
| **Tagging**       | `applyTag`, `removeTag`, `hasTag`, `toggleTag`, `getByTag`, `getIndexesByTag`, `configureTag`, `deleteTag`            |
| **Serialization** | `toJSON`, `dump`, `restore`, `fromJSON`                                                                               |
| **Reactivity**    | `subscribe`, `batch`                                                                                                  |
| **Properties**    | `size`, `items`, `active`, `activeIndex`, `isFull`, `config`, `idPropName`, `searchable`                              |

## Changelog

### 1.4.0 — Reliability pass

Eighteen correctness, consistency, and performance fixes. Full details in
[CHANGES_1.4.md](./CHANGES_1.4.md). Highlights:

- **`batch(fn)`** — new API for coalescing multiple mutations into one subscriber
  notification.
- **Fewer notifications** — `toggleTag`, `removeAllBy`, `addMany`, `patchMany` previously
  published 2–N+1 times per call; they now publish exactly once.
- **Infinity cardinality round-trips correctly** — dumps with `cardinality: Infinity`
  previously silently broke cardinality checks after restore; now fully preserved.
- **`restore()`** now preserves `allowNextPrevCycle` / `allowUnconfiguredTags`, enforces
  tag cardinality on oversized dumps, and tolerates legacy dumps.
- **`patch()`** now refreshes stale property indexes (lookups by a mutated property now
  return the correct items).
- **`sort()` / `remove()` / `move()`** now preserve every indexed property, not only the
  id property.
- **`sort()` preserves tag bindings and the active item** — both were silently detached by
  a reorder in 1.3 and earlier.
- **`config`** returns a deeply-frozen snapshot (no accidental mutation).
- **`findAllIndexesBy()`** returns a defensive copy instead of the live internal array.

See [CHANGES_1.4.md](./CHANGES_1.4.md) for the full list and backwards-compatibility
notes.
