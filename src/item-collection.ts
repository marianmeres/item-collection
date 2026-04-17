// deno-lint-ignore-file no-explicit-any
import {
	type LastQuery,
	Searchable,
	type SearchableOptions,
} from "@marianmeres/searchable";
import { PubSub } from "@marianmeres/pubsub";

/**
 * Base interface for items in the collection.
 * Items must have an "id" property by default (configurable via `idPropName` option).
 * @example
 * ```ts
 * interface User extends Item {
 *   id: string;
 *   name: string;
 *   email: string;
 * }
 * ```
 */
export interface Item extends Record<string, any> {}

/** Supported searchable options */
export interface ItemCollectionSearchableOptions<T> extends Partial<SearchableOptions> {
	// method to extract searchable content from item
	getContent: (item: T) => string | undefined;
}

/**
 * Serializable dump output.
 *
 * Note on `Infinity`: `JSON.stringify(Infinity)` emits `null`. The dump always uses
 * `null` on the wire for `cardinality` or a tag's `cardinality` meaning "unlimited";
 * `restore()` normalizes `null` back to `Infinity`.
 */
export interface ItemCollectionDump<T> {
	items: T[];
	activeIndex: number | undefined;
	cardinality: number | null;
	unique: boolean;
	idPropName: string;
	allowNextPrevCycle: boolean;
	allowUnconfiguredTags: boolean;
	tags: Record<string, number[]>;
	tagConfigs: Record<string, { cardinality: number | null }>;
	/** Dump format version. Omitted means legacy pre-1.4 dumps. */
	version?: number;
}

/** Current dump format version. */
const DUMP_VERSION = 1;

/** Supported factory options */
export interface ItemCollectionConfig<T> {
	cardinality: number;
	tags: Record<string, { cardinality: number }>;
	allowNextPrevCycle: boolean;
	allowUnconfiguredTags: boolean;
	unique: boolean;
	idPropName: string;
	// if provided, collection will be auto re-sorted on each add
	sortFn: undefined | ((a: T, b: T) => number);
	// if provided, will be applied on each item before adding
	normalizeFn: undefined | ((item: any) => T);
	// searchable only enabled if truthy options exist
	searchable: ItemCollectionSearchableOptions<T> | undefined | null;
}

/**
 * Configuration object exposed via the `config` property.
 * A readonly view of the current collection settings.
 */
export interface ExposedConfig {
	cardinality: number;
	tags: Record<string, { cardinality: number }>;
	allowNextPrevCycle: boolean;
	allowUnconfiguredTags: boolean;
	unique: boolean;
	idPropName: string;
}

/**
 * ItemCollection - A utility class for managing collections of items with an id property
 */
export class ItemCollection<T extends Item> {
	#items: T[] = [];

	#activeIndex: undefined | number = undefined;

	#allowNextPrevCycle: boolean = false;

	#cardinality: number = Infinity;

	// { [property]: { [value]: [idx1, idx2] } }
	#indexesByProperty: Map<string, Map<any, number[]>> = new Map();

	// Set of properties that have been indexed (so we can rebuild all of them on
	// structural changes, not just the id property).
	#indexedProperties: Set<string> = new Set();

	// allow only unique items in collection? (uniqueness is determined solely by "id"
	// property, never by reference)
	#unique: boolean = true;
	#idPropName: string = "id";

	#tagConfigs: Map<string, { cardinality: number }> = new Map();

	// tag -> set of referenced indexes
	#tags: Map<string, Set<number>> = new Map();

	#allowUnconfiguredTags: boolean = true;

	// Batched publishes: when > 0, #publishCurrent marks pending instead of firing.
	#batchDepth: number = 0;
	#batchPending: boolean = false;

	// undefined means "not configured" (distinct from a no-op comparator). This lets
	// sort() correctly return false when no sort function is available.
	#sortFn: ((a: T, b: T) => number) | undefined = undefined;

	// default opinionated behavior: convert strings to id-based objects
	#normalizeFn: (item: any) => T = (item: any) => {
		if (typeof item === "string") {
			return { [this.#idPropName]: item } as unknown as T;
		}
		return item;
	};

	//
	#searchable: undefined | Searchable;
	#searchableGetContent:
		| undefined
		| ItemCollectionSearchableOptions<T>["getContent"];

	#pubsub: PubSub = new PubSub();

	/**
	 * Create a new ItemCollection
	 * @param initial - Array of initial items to add to the collection
	 * @param options - Configuration options for the collection
	 * @example
	 * ```ts
	 * const collection = new ItemCollection<{id: string, name: string}>(
	 *   [{id: '1', name: 'Item 1'}],
	 *   {cardinality: 100, unique: true}
	 * );
	 * ```
	 */
	constructor(
		initial: T[] = [],
		options: Partial<ItemCollectionConfig<T>> = {},
	) {
		// searchable is configurable only at the constructor level
		if (options.searchable) {
			this.#searchable = new Searchable(options.searchable);
			this.#searchableGetContent = options.searchable.getContent;
			delete options.searchable;
		}

		// setup, but do not publish (makes no sense at constructor level)
		this.configure(options, false);
		this.addMany(initial, false);
	}

	/**
	 * Get the current number of items in the collection
	 * @returns The number of items in the collection
	 */
	get size(): number {
		return this.#items.length;
	}

	/**
	 * Get the currently active index (as a readonly value)
	 * @returns The index of the active item, or undefined if no item is active
	 */
	get activeIndex(): number | undefined {
		return this.#activeIndex;
	}

	/**
	 * Get the currently active item
	 * @returns The active item, or undefined if no item is active
	 */
	get active(): T | undefined {
		return this.#activeIndex !== undefined
			? this.#items[this.#activeIndex]
			: undefined;
	}

	/**
	 * Get all items in the collection as a shallow copy
	 * @returns Array of all items (alias for getAll())
	 */
	get items(): T[] {
		return this.getAll();
	}

	/**
	 * Get the current configuration options as a frozen snapshot.
	 * Mutating the returned object has no effect on the collection state.
	 * @returns The collection configuration object
	 */
	get config(): ExposedConfig {
		const tags: Record<string, { cardinality: number }> = {};
		for (const [name, cfg] of this.#tagConfigs.entries()) {
			tags[name] = Object.freeze({ cardinality: cfg.cardinality });
		}
		return Object.freeze({
			cardinality: this.#cardinality,
			tags: Object.freeze(tags),
			allowNextPrevCycle: this.#allowNextPrevCycle,
			allowUnconfiguredTags: this.#allowUnconfiguredTags,
			unique: this.#unique,
			idPropName: this.#idPropName,
		});
	}

	/**
	 * Get the configured "id" property name
	 * @returns The name of the property used as the unique identifier
	 */
	get idPropName(): string {
		return this.#idPropName;
	}

	/**
	 * Check if the collection has reached its cardinality limit
	 * @returns true if collection is full, false otherwise
	 */
	get isFull(): boolean {
		return this.#items.length >= this.#cardinality;
	}

	/**
	 * Get the searchable instance (if configured)
	 * @returns The Searchable instance, or undefined if not configured
	 */
	get searchable(): Searchable | undefined {
		return this.#searchable;
	}

	/**
	 * Update collection configuration options
	 * @param options - Partial configuration options to update
	 * @param publish - Whether to notify subscribers (default: true)
	 * @returns This collection instance for chaining
	 * @throws {TypeError} If attempting to configure searchable options (must be set in constructor)
	 */
	configure(
		options: Partial<ItemCollectionConfig<T>>,
		publish = true,
	): ItemCollection<T> {
		if (options.searchable) {
			throw new TypeError(
				"Searchable options can only be specified at the constructor level.",
			);
		}

		if (options.cardinality !== undefined) {
			this.#cardinality = options.cardinality;
		}

		if (options.allowNextPrevCycle !== undefined) {
			this.#allowNextPrevCycle = !!options.allowNextPrevCycle;
		}

		if (options.unique !== undefined) {
			this.#unique = !!options.unique;
		}

		if (options.idPropName !== undefined) {
			this.#idPropName = options.idPropName;
		}

		if (options.allowUnconfiguredTags !== undefined) {
			this.#allowUnconfiguredTags = !!options.allowUnconfiguredTags;
		}

		if (options.tags !== undefined) {
			Object.entries(options.tags ?? {}).forEach(([tagName, cfg]) => {
				this.#tagConfigs.set(tagName, cfg);
			});
		}

		// sortFn/normalizeFn: function assigns, null unsets, undefined is ignored.
		// Passing `null` restores the default behavior (no-op sort / pass-through
		// normalize).
		if (options.sortFn !== undefined) {
			this.#sortFn = typeof options.sortFn === "function"
				? options.sortFn
				: undefined;
		}
		if (options.normalizeFn !== undefined) {
			this.#normalizeFn = typeof options.normalizeFn === "function"
				? options.normalizeFn
				: this.#getDefaultNormalizeFn();
		}

		if (publish) this.#publishCurrent();

		return this;
	}

	// Returns a fresh default normalizer closed over the current idPropName.
	#getDefaultNormalizeFn(): (item: any) => T {
		return (item: any): T => {
			if (typeof item === "string") {
				return { [this.#idPropName]: item } as unknown as T;
			}
			return item;
		};
	}

	/**
	 * Set the active item by reference
	 * @param item - The item to set as active (matched by id property, not reference)
	 * @param publish - Whether to notify subscribers (default: true)
	 * @returns true if successful, false if item not found or undefined
	 */
	setActive(item: T | undefined, publish = true): boolean {
		if (!item) return false;

		// never by reference
		const index = this.findIndexBy(this.#idPropName, item[this.#idPropName]);

		if (index !== -1) {
			this.#activeIndex = index;
			if (publish) this.#publishCurrent();
			return true;
		}

		return false;
	}

	/**
	 * Set the active item by index number.
	 *
	 * Positive indexes use modulo wrapping (e.g. on size 3: 5 → 2).
	 * Negative indexes count from the end (e.g. on size 3: -1 → 2).
	 * If the collection is empty, activeIndex is set to undefined.
	 *
	 * @param index - The index of the item to set as active
	 * @param publish - Whether to notify subscribers (default: true)
	 * @returns The newly active item, or undefined if collection is empty
	 */
	setActiveIndex(index: number, publish = true): T | undefined {
		const prev = this.#activeIndex;
		if (this.size === 0) {
			this.#activeIndex = undefined;
		} else {
			// Normalize negatives from the tail, positives by modulo wrap.
			const n = this.size;
			let i = Number.isFinite(index) ? Math.trunc(index) % n : 0;
			if (i < 0) i += n;
			this.#activeIndex = i;
		}
		if (prev !== this.#activeIndex && publish) this.#publishCurrent();
		return this.active;
	}

	/**
	 * Unmark the currently active item
	 * @param publish - Whether to notify subscribers (default: true)
	 * @returns This collection instance for chaining
	 */
	unsetActive(publish = true): ItemCollection<T> {
		const prev = this.#activeIndex;
		this.#activeIndex = undefined;
		if (prev !== this.#activeIndex && publish) this.#publishCurrent();
		return this;
	}

	/**
	 * Get the item at the specified index
	 * Proxies to native Array's `.at()` so negative indexes are allowed
	 * @param index - The index of the item (supports negative indexing)
	 * @returns The item at the specified index, or undefined if out of bounds
	 * @example
	 * ```ts
	 * collection.at(0)   // first item
	 * collection.at(-1)  // last item
	 * ```
	 */
	at(index: number): T | undefined {
		return this.#items.at(index);
	}

	#recreateSearchableFor(item: T) {
		if (this.#searchable) {
			const docId = item[this.#idPropName];
			this.#searchable.__index.removeDocId(docId);
			this.#searchable.add(this.#searchableGetContent?.(item) ?? docId, docId);
		}
	}

	/**
	 * Add an item to the collection
	 * @param item - The item to add
	 * @param autoSort - Whether to automatically sort after adding (default: true)
	 * @param publish - Whether to notify subscribers (default: true)
	 * @returns true if added successfully, false if cardinality reached or duplicate (when unique=true)
	 */
	add(item: T, autoSort = true, publish = true): boolean {
		if (!item) return false;
		if (this.size >= this.#cardinality) return false;

		// normalize asap
		item = this.#normalizeFn(item);

		// Check uniqueness if enabled
		if (this.#unique && this.exists(item[this.#idPropName])) {
			return false;
		}

		this.#items.push(item);

		// Always incrementally update tracked-property indexes for the appended
		// item. If a sort function is configured and autoSort is true, sort() will
		// subsequently rebuild all tracked indexes from scratch. This guarantees
		// correctness whether or not a sortFn is present.
		this.#updateItemIndexes(item, this.#items.length - 1);

		if (autoSort && this.#sortFn) {
			// resort & rebuild indexes
			this.sort(undefined, false);
		}

		this.#recreateSearchableFor(item);

		if (publish) this.#publishCurrent();

		return true;
	}

	/**
	 * Add multiple items to the collection
	 * @param items - Array of items to add
	 * @param publish - Whether to notify subscribers (default: true)
	 * @returns The number of items successfully added
	 */
	addMany(items: T[], publish = true): number {
		if (!Array.isArray(items)) return 0;

		let added = 0;
		for (const item of items) {
			// optimize: do not sort here on each loop iteration..
			if (this.add(item, false, false)) {
				added++;
			}
		}

		// sort just once
		if (added) {
			this.sort(undefined, false);
			if (publish) this.#publishCurrent();
		}

		return added;
	}

	/**
	 * Toggle an item's presence in the collection (add if absent, remove if present)
	 * @param item - The item to toggle
	 * @param publish - Whether to notify subscribers (default: true)
	 * @returns true if item was added, false if item was removed
	 */
	toggleAdd(item: T, publish = true): boolean {
		if (!item) return false;
		if (this.exists(item[this.#idPropName])) {
			!!this.removeAllBy(this.#idPropName, item[this.#idPropName], publish);
			return false; // false - removed
		} else {
			this.add(item, undefined, publish);
			return true; // true - added
		}
	}

	/**
	 * Update an existing item in place (matched by id).
	 *
	 * Useful for optimistic UI strategies where you want to update without
	 * removing/re-adding. Rebuilds any indexes affected by the patched item's
	 * property values. The id property itself MUST match an existing item and
	 * must not change — patches that would mutate the id are rejected (use
	 * `remove` + `add` instead).
	 *
	 * @param item - The item to patch (must have matching id in collection)
	 * @param publish - Whether to notify subscribers (default: true)
	 * @returns true if item was patched, false if item not found
	 */
	patch(item: T | undefined, publish = true): boolean {
		if (!item) return false;

		const id = item[this.#idPropName];
		const indexes = this.findAllIndexesBy(this.#idPropName, id);
		if (!indexes.length) return false;

		// Guard against id change: the normalized item's id must be identical to
		// the lookup id. This catches accidental id mutation that would silently
		// corrupt indexes.
		if (item[this.#idPropName] !== id) return false;

		for (const index of indexes) {
			this.#items[index] = item;
		}

		// Indexes for any property that was previously accessed may now be stale
		// (the patched item could have different property values). Rebuild them.
		this.#rebuildAllIndexes();

		this.#recreateSearchableFor(item);

		if (publish) this.#publishCurrent();

		return true;
	}

	/**
	 * Update multiple existing items in place (matched by id)
	 * @param items - Array of items to patch
	 * @param publish - Whether to notify subscribers (default: true)
	 * @returns The number of items successfully patched
	 */
	patchMany(items: (T | undefined)[], publish = true): number {
		let patched = 0;
		for (const item of items) {
			if (this.patch(item, false)) patched++;
		}
		if (patched && publish) this.#publishCurrent();
		return patched;
	}

	/**
	 * Remove an item from the collection
	 * @param item - The item to remove (matched by id, not reference)
	 * @param publish - Whether to notify subscribers (default: true)
	 * @returns true if removed, false if item not found
	 */
	remove(item: T | undefined, publish = true): boolean {
		if (!item) return false;

		const index = this.findIndexBy(this.#idPropName, item[this.#idPropName]);
		if (index === -1) return false;

		return this.removeAt(index, publish);
	}

	/**
	 * Remove an item at the specified index
	 * Automatically adjusts active index and tag references
	 * @param index - The index of the item to remove
	 * @param publish - Whether to notify subscribers (default: true)
	 * @returns true if removed, false if index out of bounds
	 */
	removeAt(index: number, publish = true): boolean {
		if (index < 0 || index >= this.size) return false;

		const removedItem = this.#items[index];

		// Remove from items array
		this.#items.splice(index, 1);

		// Update indexes (wholesale rebuild of tracked properties is correct and
		// simple; a surgical update per property is possible but not worth the
		// code complexity until profiling demands it).
		this.#rebuildAllIndexes();

		// Adjust active index if needed
		if (this.#activeIndex !== undefined) {
			if (index === this.#activeIndex) {
				// The active item was removed. Prefer the item now at that index
				// (i.e. the one that was right after). If we removed the tail, fall
				// back to the new tail; empty collection → undefined. This avoids
				// the surprising "tail wraps to head" behavior of a plain modulo.
				if (this.size === 0) {
					this.#activeIndex = undefined;
				} else if (index >= this.size) {
					this.#activeIndex = this.size - 1;
				} else {
					this.#activeIndex = index;
				}
			} else if (index < this.#activeIndex) {
				// The removed item was before the active item, decrement active index
				this.#activeIndex--;
			}
		}

		// Update tags - remove the item from all tag sets and adjust indexes
		this.#updateTagsOnRemove(index);

		//
		this.#searchable?.__index.removeDocId(removedItem[this.#idPropName]);

		if (publish) this.#publishCurrent();

		return true;
	}

	/**
	 * Remove all items matching a property value
	 * @param property - The property name to match
	 * @param value - The value to match
	 * @param publish - Whether to notify subscribers (default: true)
	 * @returns The number of items removed
	 */
	removeAllBy(property: string, value: any, publish = true): number {
		let removed = 0;

		let index = this.findIndexBy(property, value);
		while (index >= 0) {
			this.removeAt(index, false);
			removed++;
			index = this.findIndexBy(property, value);
		}

		if (removed && publish) this.#publishCurrent();

		return removed;
	}

	/**
	 * Move to the next item and make it active
	 * Respects allowNextPrevCycle configuration for wrapping behavior
	 * @returns The newly active item, or undefined if collection is empty
	 */
	setActiveNext(): T | undefined {
		if (this.size === 0) return undefined;

		const prev = this.#activeIndex;
		if (this.#activeIndex === undefined) {
			this.#activeIndex = 0;
		} else {
			if (this.#activeIndex === this.size - 1) {
				if (this.#allowNextPrevCycle) this.#activeIndex = 0;
			} else {
				this.#activeIndex++;
			}
		}

		if (prev !== this.#activeIndex) this.#publishCurrent();

		return this.active;
	}

	/**
	 * Move to the previous item and make it active
	 * Respects allowNextPrevCycle configuration for wrapping behavior
	 * @returns The newly active item, or undefined if collection is empty
	 */
	setActivePrevious(): T | undefined {
		if (this.size === 0) return undefined;

		const prev = this.#activeIndex;
		if (this.#activeIndex === undefined) {
			this.#activeIndex = 0;
		} else {
			if (this.#activeIndex === 0) {
				if (this.#allowNextPrevCycle) this.#activeIndex = this.size - 1;
			} else {
				this.#activeIndex--;
			}
		}

		if (prev !== this.#activeIndex) this.#publishCurrent();

		return this.active;
	}

	/**
	 * Move to the first item and make it active
	 * @returns The first item, or undefined if collection is empty
	 */
	setActiveFirst(): undefined | T {
		if (this.#items.length === 0) return undefined;
		const prev = this.#activeIndex;
		this.#activeIndex = 0;
		if (prev !== this.#activeIndex) this.#publishCurrent();
		return this.active;
	}

	/**
	 * Move to the last item and make it active
	 * @returns The last item, or undefined if collection is empty
	 */
	setActiveLast(): undefined | T {
		if (this.#items.length === 0) return undefined;
		const prev = this.#activeIndex;
		this.#activeIndex = this.#items.length - 1;
		if (prev !== this.#activeIndex) this.#publishCurrent();
		return this.active;
	}

	/**
	 * Check if an item exists in the collection
	 * @param idOrItem - The item id (string) or item object to check
	 * @returns true if exists, false otherwise
	 */
	exists(idOrItem: string | T): boolean {
		const id = typeof idOrItem === "string" ? idOrItem : idOrItem[this.#idPropName];
		return this.findBy(this.#idPropName, id) !== undefined;
	}

	/**
	 * Find the first item by its id
	 * @param id - The id value to search for
	 * @returns The first matching item, or undefined if not found
	 */
	findById(id: string): T | undefined {
		return this.findBy(this.#idPropName, id);
	}

	/**
	 * Find the first item matching a property value
	 * Uses optimized indexing for O(1) lookups
	 * @param property - The property name to match
	 * @param value - The value to match
	 * @returns The first matching item, or undefined if not found
	 */
	findBy(property: string, value: any): T | undefined {
		return this.#items[this.findIndexBy(property, value)];
	}

	/**
	 * Find all items matching a property value
	 * @param property - The property name to match
	 * @param value - The value to match
	 * @returns Array of all matching items (empty array if none found)
	 */
	findAllBy(property: string, value: any): T[] {
		const indexes = this.findAllIndexesBy(property, value);
		return indexes.map((idx: number) => this.#items[idx]);
	}

	/**
	 * Find the index of the first item matching a property value
	 * @param property - The property name to match
	 * @param value - The value to match
	 * @returns The index of the first match, or -1 if not found
	 */
	findIndexBy(property: string, value: any): number {
		const indexes = this.findAllIndexesBy(property, value);
		return indexes[0] ?? -1;
	}

	/**
	 * Find all indexes of items matching a property value
	 * @param property - The property name to match
	 * @param value - The value to match
	 * @returns Array of all matching indexes (empty array if none found)
	 */
	findAllIndexesBy(property: string, value: any): number[] {
		if (!this.#indexesByProperty.has(property)) {
			this.#buildIndexForProperty(property);
		}

		const propIndex = this.#indexesByProperty.get(property)!;
		const found = propIndex.get(value);
		// Return a shallow copy: the index is an internal structure; callers must
		// not be able to mutate it via the returned reference.
		return found ? found.slice() : [];
	}

	/**
	 * Search items using full-text search
	 * Requires searchable to be configured in constructor
	 * @param query - The search query string
	 * @param strategy - Search strategy: "exact", "prefix", or "fuzzy" (default: "prefix")
	 * @param options - Additional search options (e.g., maxDistance for fuzzy search)
	 * @returns Array of matching items
	 * @throws {TypeError} If searchable was not configured
	 */
	search(
		query: string,
		strategy: "exact" | "prefix" | "fuzzy" = "prefix",
		options: Partial<{ maxDistance: number }> = {},
	): T[] {
		if (!this.#searchable) {
			throw new TypeError("This collection is not configured as searchable");
		}
		// Snapshot the query state; Searchable returns a live reference.
		const prevQuery: LastQuery | undefined = this.#searchable.lastQuery
			? { ...this.#searchable.lastQuery }
			: undefined;
		const ids = this.#searchable.search(query, strategy, options);
		const out = [];
		for (const id of ids) {
			out.push(this.findBy(this.#idPropName, id)!);
		}

		// make "lastQuery" reactive, but only when it actually changed — avoids
		// notifying subscribers about a read-only no-op query.
		if (!this.#lastQueryEquals(prevQuery, this.#searchable.lastQuery)) {
			this.#publishCurrent();
		}

		return out;
	}

	#lastQueryEquals(
		a: LastQuery | undefined,
		b: LastQuery | undefined,
	): boolean {
		if (a === b) return true;
		if (!a || !b) return false;
		return a.raw === b.raw && a.used === b.used;
	}

	/**
	 * Move an item from one position to another
	 * Automatically maintains tag references and active index
	 * @param fromIndex - Source index (0-based)
	 * @param toIndex - Destination index (0-based)
	 * @param publish - Whether to notify subscribers (default: true)
	 * @returns true if successful, false if indexes are invalid
	 */
	move(fromIndex: number, toIndex: number, publish = true): boolean {
		if (
			fromIndex < 0 ||
			fromIndex >= this.size ||
			toIndex < 0 ||
			toIndex >= this.size ||
			fromIndex === toIndex
		) {
			return false;
		}

		// Store the item to move
		const item = this.#items[fromIndex];

		// Remove the item
		this.#items.splice(fromIndex, 1);

		// Insert the item at the new position
		this.#items.splice(toIndex, 0, item);

		// Rebuild all indexes - a complete rebuild is safer when moving items
		this.#rebuildAllIndexes();

		// Update active index if needed...
		if (this.#activeIndex !== undefined) {
			if (this.#activeIndex === fromIndex) {
				// If the moved item was active, update to new position
				this.#activeIndex = toIndex;
			} else if (
				fromIndex < this.#activeIndex &&
				this.#activeIndex <= toIndex
			) {
				// Active index needs to shift down
				this.#activeIndex--;
			} else if (
				toIndex <= this.#activeIndex &&
				this.#activeIndex < fromIndex
			) {
				// Active index needs to shift up
				this.#activeIndex++;
			}
		}

		// Update tag indexes
		this.#updateTagsOnMove(fromIndex, toIndex);

		if (publish) this.#publishCurrent();

		return true;
	}

	/** Update tag indexes when an item is removed */
	#updateTagsOnRemove(removedIndex: number): void {
		// For each tag
		for (const [tagName, tagSet] of this.#tags.entries()) {
			// Remove the index if it exists in this tag
			tagSet.delete(removedIndex);

			// Create a new set with adjusted indexes
			const newTagSet = new Set<number>();
			for (const idx of tagSet) {
				if (idx > removedIndex) {
					// Decrease indexes that were after the removed item
					newTagSet.add(idx - 1);
				} else {
					// Keep indexes that were before the removed item
					newTagSet.add(idx);
				}
			}

			// Replace the old set with the adjusted one
			this.#tags.set(tagName, newTagSet);
		}
	}

	/** Update tag indexes when an item is moved */
	#updateTagsOnMove(fromIndex: number, toIndex: number) {
		for (const [tagName, tagSet] of this.#tags.entries()) {
			const newTagSet = new Set<number>();
			const wasTagged = tagSet.has(fromIndex);

			// Remove the original index
			tagSet.delete(fromIndex);

			// Adjust all other indexes and build a new set
			for (const idx of tagSet) {
				if (fromIndex < toIndex) {
					// Moving forward
					if (idx > fromIndex && idx <= toIndex) {
						// Indexes in between need to shift down
						newTagSet.add(idx - 1);
					} else {
						// Other indexes stay the same
						newTagSet.add(idx);
					}
				} else {
					// Moving backward
					if (idx >= toIndex && idx < fromIndex) {
						// Indexes in between need to shift up
						newTagSet.add(idx + 1);
					} else {
						// Other indexes stay the same
						newTagSet.add(idx);
					}
				}
			}

			// Add the new index if the item was tagged
			if (wasTagged) {
				newTagSet.add(toIndex);
			}

			// Replace the old set with the adjusted one
			this.#tags.set(tagName, newTagSet);
		}
	}

	/**
	 * Clear all items from the collection.
	 *
	 * Also clears the active index, all tag associations (tag → indexes) and the
	 * searchable index (if configured). Tag *configurations* (cardinality) are
	 * preserved so a collection continues to behave consistently with its
	 * construction options.
	 *
	 * @param publish - Whether to notify subscribers (default: true)
	 * @returns This collection instance for chaining
	 */
	clear(publish = true): ItemCollection<T> {
		// Capture ids first so we can purge the searchable index (no bulk reset).
		if (this.#searchable) {
			for (const item of this.#items) {
				this.#searchable.__index.removeDocId(item[this.#idPropName]);
			}
		}

		this.#items = [];
		this.#activeIndex = undefined;
		this.#indexesByProperty = new Map();
		// Keep #indexedProperties so the first post-clear lookup is still O(1).

		// Clear all tag associations (keep configs so the collection behaves
		// consistently with its construction options).
		for (const tagSet of this.#tags.values()) {
			tagSet.clear();
		}

		if (publish) this.#publishCurrent();

		return this;
	}

	/**
	 * Get all items in the collection as a shallow copy
	 * @returns Array containing all items
	 */
	getAll(): T[] {
		return [...this.#items];
	}

	/** Build an index for a specific property. Tracks the property as indexed. */
	#buildIndexForProperty(property: string): void {
		const index = new Map();

		this.#items.forEach((item, idx) => {
			if (typeof item[property] !== "undefined") {
				const value = item[property];
				if (!index.has(value)) {
					index.set(value, []);
				}
				index.get(value).push(idx);
			}
		});

		this.#indexesByProperty.set(property, index);
		this.#indexedProperties.add(property);
	}

	/** Update indexes for the currently-tracked properties when adding a new item. */
	#updateItemIndexes(item: T, index: number) {
		// Only track properties the caller has already shown interest in — building
		// every property index for every added item would be O(items × props).
		for (const prop of this.#indexedProperties) {
			if (!this.#indexesByProperty.has(prop)) {
				this.#indexesByProperty.set(prop, new Map<any, number[]>());
			}
			const propIndex = this.#indexesByProperty.get(prop)!;
			const value = item[prop];
			if (typeof value === "undefined") continue;
			if (!propIndex.has(value)) {
				propIndex.set(value, []);
			}
			propIndex.get(value)!.push(index);
		}
		// Always make sure the id property is indexed — core lookups depend on it.
		if (!this.#indexedProperties.has(this.#idPropName)) {
			this.#buildIndexForProperty(this.#idPropName);
		}
	}

	/**
	 * Rebuild all property indexes that were previously accessed.
	 *
	 * Previously this only rebuilt the id index "for simplicity", which silently
	 * dropped every custom-property index on remove/sort/move/patch. Subsequent
	 * lookups would then scan the entire collection instead of hitting O(1).
	 */
	#rebuildAllIndexes() {
		this.#indexesByProperty = new Map();
		// Always include the id property.
		this.#indexedProperties.add(this.#idPropName);
		for (const prop of this.#indexedProperties) {
			this.#buildIndexForProperty(prop);
		}
	}

	/** Will create new implicit tag config (if allowed) */
	#assertAndInitializeTag(tagName: string) {
		// Ensure the tag exists
		if (!this.#tags.has(tagName)) {
			if (!this.#allowUnconfiguredTags) {
				throw new TypeError(`Unconfigured tag "${tagName}" is not allowed.`);
			}
			this.#tags.set(tagName, new Set());

			if (!this.#tagConfigs.has(tagName)) {
				this.#tagConfigs.set(tagName, { cardinality: Infinity });
			}
		}
	}

	/**
	 * Apply a tag to an item
	 * @param item - The item to tag (matched by id)
	 * @param tagName - The name of the tag to apply
	 * @param publish - Whether to notify subscribers (default: true)
	 * @returns true if successful, false if item not found or cardinality reached
	 */
	applyTag(item: T | undefined, tagName: string, publish = true): boolean {
		if (!item) return false;

		const index = this.findIndexBy(this.#idPropName, item[this.#idPropName]);
		if (index === -1) return false;

		return this.applyTagByIndex(index, tagName, publish);
	}

	/**
	 * Apply a tag to an item at the specified index
	 * @param index - The index of the item to tag
	 * @param tagName - The name of the tag to apply
	 * @param publish - Whether to notify subscribers (default: true)
	 * @returns true if successful, false if index out of bounds or cardinality reached
	 */
	applyTagByIndex(index: number, tagName: string, publish = true): boolean {
		if (index < 0 || index >= this.size) return false;

		// Ensure the tag exists
		this.#assertAndInitializeTag(tagName);

		const tagSet = this.#tags.get(tagName)!;
		const config = this.#tagConfigs.get(tagName)!;

		// Check cardinality
		if (tagSet.size >= config.cardinality && !tagSet.has(index)) {
			return false;
		}

		tagSet.add(index);

		if (publish) this.#publishCurrent();

		return true;
	}

	/**
	 * Apply a tag to items at multiple indexes
	 * @param indexes - Array of indexes to tag
	 * @param tagName - The name of the tag to apply
	 * @param publish - Whether to notify subscribers (default: true)
	 * @returns true if all successful, false if any failed
	 */
	applyTagByIndexes(
		indexes: number[],
		tagName: string,
		publish = true,
	): boolean {
		// Historical semantics: returns true only if ALL applications succeeded.
		// Fixed in 1.4: we now iterate the full list (previously short-circuited
		// on first failure, leaving partial state without reporting it). Only a
		// single publish notification is emitted at the end.
		let allOk = indexes.length > 0;
		for (const index of indexes) {
			if (!this.applyTagByIndex(index, tagName, false)) allOk = false;
		}

		if (publish) this.#publishCurrent();

		return allOk;
	}

	/**
	 * Remove a tag from an item
	 * @param item - The item to untag (matched by id)
	 * @param tagName - The name of the tag to remove
	 * @param publish - Whether to notify subscribers (default: true)
	 * @returns true if successful, false if item not found or tag not present
	 */
	removeTag(item: T | undefined, tagName: string, publish = true): boolean {
		if (!item) return false;

		const index = this.findIndexBy(this.#idPropName, item[this.#idPropName]);
		if (index === -1) return false;

		return this.removeTagByIndex(index, tagName, publish);
	}

	/**
	 * Remove a tag from an item at the specified index
	 * @param index - The index of the item to untag
	 * @param tagName - The name of the tag to remove
	 * @param publish - Whether to notify subscribers (default: true)
	 * @returns true if successful, false if index out of bounds or tag not present
	 */
	removeTagByIndex(index: number, tagName: string, publish = true): boolean {
		if (index < 0 || index >= this.size) return false;

		if (!this.#tags.has(tagName)) return false;

		const tagSet = this.#tags.get(tagName)!;
		if (!tagSet.has(index)) return false;

		tagSet.delete(index);

		if (publish) this.#publishCurrent();

		return true;
	}

	/**
	 * Remove a tag from items at multiple indexes
	 * @param indexes - Array of indexes to untag
	 * @param tagName - The name of the tag to remove
	 * @param publish - Whether to notify subscribers (default: true)
	 * @returns true if at least one was successful, false otherwise
	 */
	removeTagByIndexes(
		indexes: number[],
		tagName: string,
		publish = true,
	): boolean {
		let successCounter = 0;
		for (const index of indexes) {
			this.removeTagByIndex(index, tagName, false) && successCounter++;
		}

		if (publish) this.#publishCurrent();

		return successCounter > 0;
	}

	/**
	 * Check if an item has a specific tag
	 * @param item - The item to check (matched by id)
	 * @param tagName - The name of the tag to check
	 * @returns true if item has the tag, false otherwise
	 */
	hasTag(item: T | undefined, tagName: string): boolean {
		if (!item) return false;

		const index = this.findIndexBy(this.#idPropName, item[this.#idPropName]);
		if (index === -1) return false;

		return this.hasTagByIndex(index, tagName);
	}

	/**
	 * Check if an item at the specified index has a specific tag
	 * @param index - The index of the item to check
	 * @param tagName - The name of the tag to check
	 * @returns true if item has the tag, false otherwise
	 */
	hasTagByIndex(index: number, tagName: string): boolean {
		if (index < 0 || index >= this.size) return false;

		if (!this.#tags.has(tagName)) return false;

		return this.#tags.get(tagName)!.has(index);
	}

	/**
	 * Get all items with a specific tag
	 * @param tagName - The name of the tag
	 * @returns Array of all items with the tag (empty array if tag not found)
	 */
	getByTag(tagName: string): T[] {
		if (!this.#tags.has(tagName)) return [];

		const tagSet = this.#tags.get(tagName)!;
		return Array.from(tagSet).map((index) => this.#items[index]);
	}

	/**
	 * Get indexes of all items with a specific tag
	 * @param tagName - The name of the tag
	 * @returns Array of all indexes with the tag (empty array if tag not found)
	 */
	getIndexesByTag(tagName: string): number[] {
		if (!this.#tags.has(tagName)) return [];

		return Array.from(this.#tags.get(tagName)!);
	}

	/**
	 * Toggle a tag on an item (apply if absent, remove if present)
	 * @param item - The item to toggle tag on (matched by id)
	 * @param tagName - The name of the tag to toggle
	 * @param publish - Whether to notify subscribers (default: true)
	 * @returns true if tag was applied, false if tag was removed
	 */
	toggleTag(item: T | undefined, tagName: string, publish = true): boolean {
		if (!item) return false;

		const hasTag = this.hasTag(item, tagName);
		if (hasTag) {
			this.removeTag(item, tagName, false);
		} else {
			this.applyTag(item, tagName, false);
		}

		if (publish) this.#publishCurrent();

		// false - removed, true - applied
		return !hasTag;
	}

	/**
	 * Toggle a tag on an item by index (apply if absent, remove if present)
	 * @param index - The index of the item to toggle tag on
	 * @param tagName - The name of the tag to toggle
	 * @param publish - Whether to notify subscribers (default: true)
	 * @returns true if tag was applied, false if tag was removed, undefined if item not found
	 */
	toggleTagByIndex(
		index: number,
		tagName: string,
		publish = true,
	): boolean | undefined {
		if (!this.at(index)) return undefined;

		const hasTag = this.hasTagByIndex(index, tagName);
		if (hasTag) {
			this.removeTagByIndex(index, tagName, publish);
			return false; // false - removed
		} else {
			this.applyTagByIndex(index, tagName, publish);
			return true; // true - added
		}
	}

	/**
	 * Delete a tag completely from the collection
	 * Removes the tag from all items and deletes its configuration
	 * @param tagName - The name of the tag to delete
	 * @param publish - Whether to notify subscribers (default: true)
	 * @returns true if deleted, false if tag didn't exist
	 */
	deleteTag(tagName: string, publish = true): boolean {
		if (!this.#tags.has(tagName)) return false;

		this.#tags.delete(tagName);
		this.#tagConfigs.delete(tagName);

		if (publish) this.#publishCurrent();

		return true;
	}

	/**
	 * Configure or update a tag's options
	 * @param tagName - The name of the tag to configure
	 * @param config - Configuration options (currently only cardinality is supported)
	 * @param publish - Whether to notify subscribers (default: true)
	 * @returns true always (creates tag if it doesn't exist)
	 */
	configureTag(
		tagName: string,
		config: { cardinality: number } = { cardinality: Infinity },
		publish = true,
	): boolean {
		const preexisting = this.#tagConfigs.has(tagName);
		if (!preexisting) {
			this.#tagConfigs.set(tagName, { cardinality: Infinity });
			this.#tags.set(tagName, new Set());
		}

		const currentConfig = this.#tagConfigs.get(tagName)!;
		const prevCardinality = currentConfig.cardinality;
		Object.assign(currentConfig, config);

		// If cardinality is reduced, we may need to prune currently-tagged items
		// to respect the new limit.
		if (
			config.cardinality !== undefined &&
			config.cardinality < this.#tags.get(tagName)!.size
		) {
			this.#enforceTagCardinality(tagName);
		}

		// Publish on any actual change (new config or cardinality changed) so
		// subscribers observing `config` see a consistent, non-surprising update
		// contract aligned with the rest of the API.
		const changed = !preexisting || prevCardinality !== currentConfig.cardinality;
		if (changed && publish) this.#publishCurrent();

		return true;
	}

	/** Enforce tag cardinality by removing excess tags */
	#enforceTagCardinality(tagName: string): void {
		const tagSet = this.#tags.get(tagName);
		const config = this.#tagConfigs.get(tagName);

		if (!tagSet || !config || tagSet.size <= config.cardinality) return;

		// Remove excess tags (remove from the end)
		const indexes = Array.from(tagSet).sort((a, b) => a - b);
		while (indexes.length > config.cardinality) {
			tagSet.delete(indexes.pop()!);
		}
	}

	/**
	 * Sort the collection with a custom or default sort function
	 * Note: Normally not needed as collection auto-sorts on add if sortFn configured
	 * @param sortFn - Optional sort function (uses configured sortFn if not provided)
	 * @param publish - Whether to notify subscribers (default: true)
	 * @returns true if sorted, false if no sort function available
	 */
	sort(sortFn?: (a: T, b: T) => number, publish = true): boolean {
		const fn = sortFn ?? this.#sortFn;
		if (!fn) return false;

		// Capture id@index BEFORE sorting so tag sets (which are index-based) can
		// be remapped after the reorder. Without this, sorting silently detaches
		// tags from their items.
		const idAtOldIndex: any[] = this.#items.map(
			(it) => it[this.#idPropName],
		);
		// Also capture the id of the currently active item (if any) so we can
		// track it across the reorder.
		const activeId = this.#activeIndex !== undefined
			? this.#items[this.#activeIndex][this.#idPropName]
			: undefined;

		this.#items = this.#items.toSorted(fn);
		this.#rebuildAllIndexes();

		// Build new id → new index (first occurrence). With unique=true this is
		// sufficient; with unique=false, remap uses the sequence of occurrences.
		const remap = this.#buildSortRemap(idAtOldIndex);

		// Remap tag indexes.
		if (this.#tags.size > 0) {
			for (const [tagName, tagSet] of this.#tags.entries()) {
				const next = new Set<number>();
				for (const oldIdx of tagSet) {
					const newIdx = remap.next(oldIdx);
					if (newIdx !== undefined) next.add(newIdx);
				}
				this.#tags.set(tagName, next);
			}
		}

		// Remap activeIndex by id to preserve "the same active item" across sort.
		if (activeId !== undefined) {
			const newIdx = this.findIndexBy(this.#idPropName, activeId);
			this.#activeIndex = newIdx === -1 ? undefined : newIdx;
		}

		if (publish) this.#publishCurrent();
		return true;
	}

	/**
	 * Given an array mapping old-index → id, and the current (post-sort) #items,
	 * return a function `next(oldIdx) -> newIdx | undefined` that translates
	 * positions across the sort. Supports non-unique collections by consuming
	 * new-index occurrences in iteration order.
	 */
	#buildSortRemap(idAtOldIndex: any[]): { next(oldIdx: number): number | undefined } {
		// For each id, a queue of new indexes (insertion-order) that haven't yet
		// been handed out. This keeps the remap stable for non-unique collections.
		const queues = new Map<any, number[]>();
		this.#items.forEach((it, idx) => {
			const id = it[this.#idPropName];
			const q = queues.get(id);
			if (q) q.push(idx);
			else queues.set(id, [idx]);
		});
		// Translate old-index positions in order, so duplicate ids map stably:
		// the k-th old occurrence of id X lands on the k-th new occurrence of id X.
		// We do this by walking idAtOldIndex in order and consuming the queue.
		const memo = new Map<number, number | undefined>();
		idAtOldIndex.forEach((id, oldIdx) => {
			const q = queues.get(id);
			const newIdx = q && q.length ? q.shift() : undefined;
			memo.set(oldIdx, newIdx);
		});
		return {
			next: (oldIdx: number) => memo.get(oldIdx),
		};
	}

	/**
	 * Export collection state to a JSON-serializable object.
	 *
	 * `Infinity` values (collection `cardinality` and any tag's `cardinality`)
	 * are serialized as `null` so they round-trip cleanly through `JSON.stringify`
	 * — `restore()` normalizes `null` back to `Infinity`.
	 *
	 * @returns A dump object containing all collection state
	 */
	toJSON(): ItemCollectionDump<T> {
		const serializedTags: Record<string, number[]> = {};
		for (const [tagName, tagSet] of this.#tags.entries()) {
			serializedTags[tagName] = Array.from(tagSet);
		}

		const serializedTagConfigs: Record<
			string,
			{ cardinality: number | null }
		> = {};
		for (const [tagName, config] of this.#tagConfigs.entries()) {
			serializedTagConfigs[tagName] = {
				cardinality: this.#serializeCardinality(config.cardinality),
			};
		}

		return {
			version: DUMP_VERSION,
			items: this.#items,
			activeIndex: this.#activeIndex,
			cardinality: this.#serializeCardinality(this.#cardinality),
			unique: this.#unique,
			idPropName: this.#idPropName,
			allowNextPrevCycle: this.#allowNextPrevCycle,
			allowUnconfiguredTags: this.#allowUnconfiguredTags,
			tags: serializedTags,
			tagConfigs: serializedTagConfigs,
		};
	}

	#serializeCardinality(n: number): number | null {
		return Number.isFinite(n) ? n : null;
	}

	#deserializeCardinality(v: unknown): number {
		// `null` and missing → Infinity (unlimited). Any finite number passes
		// through. Other values (undefined, strings, etc.) fall back to Infinity
		// rather than NaN to avoid producing comparisons that silently fail.
		if (v === null || v === undefined) return Infinity;
		if (typeof v === "number" && Number.isFinite(v)) return v;
		return Infinity;
	}

	/**
	 * Serialize the collection to a JSON string
	 * @returns JSON string representation of the collection
	 */
	dump(): string {
		return JSON.stringify(this);
	}

	/**
	 * Restore collection state from a serialized dump.
	 *
	 * Accepts both the current dump format (with `version`, `allowNextPrevCycle`,
	 * `allowUnconfiguredTags`) and legacy dumps that predate those fields —
	 * missing fields keep their current values rather than being reset to
	 * hardcoded defaults, so a collection configured at construction time is
	 * not silently "downgraded" by restoring an older dump.
	 *
	 * `null` cardinalities (produced by serializing `Infinity`) are restored
	 * back to `Infinity`. Tag sets that exceed their configured cardinality
	 * are pruned to respect the limit.
	 *
	 * @param dump - JSON string or dump object to restore from
	 * @returns true if successful, false if the input is missing/invalid
	 */
	restore(dump: string | ItemCollectionDump<T>): boolean {
		if (!dump) return false;

		let parsed: any = dump;
		if (typeof dump === "string") {
			try {
				parsed = JSON.parse(dump);
			} catch {
				return false;
			}
		}

		if (!parsed || typeof parsed !== "object") return false;

		try {
			// Clear current state (silent — we'll publish once at the end).
			this.clear(false);

			// Core config — only overwrite when the dump actually has the field,
			// so legacy dumps don't erase current configuration.
			if ("cardinality" in parsed) {
				this.#cardinality = this.#deserializeCardinality(parsed.cardinality);
			}
			if ("unique" in parsed) this.#unique = !!parsed.unique;
			if (typeof parsed.idPropName === "string") {
				this.#idPropName = parsed.idPropName;
			}
			if ("allowNextPrevCycle" in parsed) {
				this.#allowNextPrevCycle = !!parsed.allowNextPrevCycle;
			}
			if ("allowUnconfiguredTags" in parsed) {
				this.#allowUnconfiguredTags = !!parsed.allowUnconfiguredTags;
			}

			// Items
			if (Array.isArray(parsed.items)) {
				this.addMany(parsed.items, false);
			}

			// Active index (validate against the restored collection size).
			if (
				typeof parsed.activeIndex === "number" &&
				parsed.activeIndex >= 0 &&
				parsed.activeIndex < this.size
			) {
				this.#activeIndex = parsed.activeIndex;
			}

			// Tag configurations — normalize Infinity and pre-create empty tag
			// sets so configured tags remain visible even without any members.
			if (parsed.tagConfigs && typeof parsed.tagConfigs === "object") {
				for (const [tagName, cfg] of Object.entries(parsed.tagConfigs)) {
					const cardinality = this.#deserializeCardinality(
						(cfg as any)?.cardinality,
					);
					this.#tagConfigs.set(tagName, { cardinality });
					if (!this.#tags.has(tagName)) {
						this.#tags.set(tagName, new Set());
					}
				}
			}

			// Tag sets — filter to valid indexes only.
			if (parsed.tags && typeof parsed.tags === "object") {
				for (const [tagName, indexes] of Object.entries(parsed.tags)) {
					if (!Array.isArray(indexes)) continue;
					const tagSet = new Set<number>();
					for (const index of indexes) {
						if (
							typeof index === "number" &&
							index >= 0 &&
							index < this.size
						) {
							tagSet.add(index);
						}
					}
					this.#tags.set(tagName, tagSet);
				}
			}

			// Enforce cardinality on restored tags. Configurations loaded from
			// disk may exceed the limit (e.g. if someone edited the dump, or if
			// a later cardinality change was applied to a separately-held dump).
			for (const tagName of this.#tagConfigs.keys()) {
				this.#enforceTagCardinality(tagName);
			}

			this.#publishCurrent();

			return true;
		} catch (error) {
			console.error("Unable to restore", error);
			// If any error occurs during restoration, ensure the collection is
			// in a clean state (but do not publish twice — clear publishes).
			this.clear();
			return false;
		}
	}

	/**
	 * Subscribe to collection changes
	 * The callback is immediately invoked with current state
	 * @param cb - Callback function to invoke on changes
	 * @returns Unsubscribe function
	 * @example
	 * ```ts
	 * const unsubscribe = collection.subscribe((data) => {
	 *   console.log('Items:', data.items);
	 *   console.log('Active:', data.active);
	 * });
	 * // Later, when done:
	 * unsubscribe();
	 * ```
	 */
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
		}) => void,
	): () => void {
		const unsub = this.#pubsub.subscribe("change", cb);
		cb(this.#current()); // notify newly subscribed asap
		return unsub;
	}

	#publishCurrent() {
		if (this.#batchDepth > 0) {
			this.#batchPending = true;
			return;
		}
		this.#pubsub.publish("change", this.#current());
	}

	/**
	 * Execute a callback with publish notifications suppressed until the callback
	 * returns. A single "change" event is emitted at the end if any internal
	 * operation attempted to publish during the batch.
	 *
	 * Useful when composing multiple mutations (add + tag + activate) that
	 * would otherwise produce several notifications.
	 *
	 * Throws propagate through the batch; the buffered publish is still
	 * flushed so subscribers see the partial state that actually occurred.
	 *
	 * Nested calls are supported; only the outermost batch flushes.
	 *
	 * @example
	 * ```ts
	 * collection.batch(() => {
	 *   collection.add(newItem);
	 *   collection.applyTag(newItem, 'featured');
	 *   collection.setActive(newItem);
	 * }); // subscribers notified exactly once
	 * ```
	 */
	batch(fn: () => void): void {
		this.#batchDepth++;
		try {
			fn();
		} finally {
			this.#batchDepth--;
			if (this.#batchDepth === 0 && this.#batchPending) {
				this.#batchPending = false;
				this.#pubsub.publish("change", this.#current());
			}
		}
	}

	/** Collect current state for publishing. */
	#current() {
		return {
			items: this.getAll(),
			active: this.active,
			activeIndex: this.activeIndex,
			size: this.size,
			isFull: this.isFull,
			config: this.config,
			timestamp: new Date(),
			lastQuery: this.searchable?.lastQuery,
		};
	}

	/**
	 * Create a new ItemCollection from a JSON dump string
	 * @param json - JSON string to restore from
	 * @returns New ItemCollection instance (empty if restore fails)
	 */
	static fromJSON<T extends Item>(json: string): ItemCollection<T> {
		try {
			const state = JSON.parse(json);
			const collection = new ItemCollection<T>();
			collection.restore(state);
			return collection;
		} catch (_error) {
			return new ItemCollection();
		}
	}
}
