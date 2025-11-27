// deno-lint-ignore-file no-explicit-any
import {
	type LastQuery,
	Searchable,
	type SearchableOptions,
} from "@marianmeres/searchable";
import { PubSub } from "@marianmeres/pubsub";

/** The Item in collection */
export interface Item extends Record<string, any> {}

/** Supported searchable options */
export interface ItemCollectionSearchableOptions<T>
	extends Partial<SearchableOptions> {
	// method to extract searchable content from item
	getContent: (item: T) => string | undefined;
}

/** Serializable dump output */
export interface ItemCollectionDump<T> {
	items: T[];
	activeIndex: number | undefined;
	cardinality: number;
	unique: boolean;
	idPropName: string;
	tags: Record<string, number[]>;
	tagConfigs: Record<string, { cardinality: number }>;
}

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

interface ExposedConfig {
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

	// allow only unique items in collection? (uniqueness is determined solely by "id"
	// property, never by reference)
	#unique: boolean = true;
	#idPropName: string = "id";

	#tagConfigs: Map<string, { cardinality: number }> = new Map();

	// tag -> set of referenced indexes
	#tags: Map<string, Set<number>> = new Map();

	#allowUnconfiguredTags: boolean = true;

	//
	#sortFn: (a: T, b: T) => number = (_a: T, _b: T) => 0;

	// default opinionated behavior: convert strings to id based objects
	#normalizeFn: (item: any) => T = (item: any) => {
		if (typeof item === "string") {
			item = { [this.#idPropName]: item };
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
		options: Partial<ItemCollectionConfig<T>> = {}
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
	 * Get the current configuration options
	 * @returns The collection configuration object
	 */
	get config(): ExposedConfig {
		return {
			cardinality: this.#cardinality,
			tags: Object.fromEntries(this.#tagConfigs.entries()),
			allowNextPrevCycle: this.#allowNextPrevCycle,
			allowUnconfiguredTags: this.#allowUnconfiguredTags,
			unique: this.#unique,
			idPropName: this.#idPropName,
		};
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
		publish = true
	): ItemCollection<T> {
		if (options.searchable) {
			throw new TypeError(
				"Searchable options can only be specified at the constructor level."
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

		if (typeof options.sortFn === "function") {
			this.#sortFn = options.sortFn;
		}

		if (typeof options.normalizeFn === "function") {
			this.#normalizeFn = options.normalizeFn;
		}

		if (publish) this.#publishCurrent();

		return this;
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
	 * Set the active item by index number
	 * @param index - The index of the item to set as active (uses modulo for wrapping)
	 * @param publish - Whether to notify subscribers (default: true)
	 * @returns The newly active item, or undefined if collection is empty
	 */
	setActiveIndex(index: number, publish = true): T | undefined {
		const prev = this.#activeIndex;
		this.#activeIndex = this.size > 0 ? index % this.size : undefined;
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

		if (autoSort) {
			// resort & rebuild indexes
			this.sort(undefined, false);
		} else {
			// Update indexes for all properties
			this.#updateItemIndexes(item, this.#items.length - 1);
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
			this.sort();
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
	 * Update an existing item in place (matched by id)
	 * Useful for optimistic UI strategies where you want to update without removing/re-adding
	 * @param item - The item to patch (must have matching id in collection)
	 * @param publish - Whether to notify subscribers (default: true)
	 * @returns true if item was patched, false if item not found
	 */
	patch(item: T | undefined, publish = true): boolean {
		if (!item) return false;

		let patched = 0;

		const indexes = this.findAllIndexesBy(
			this.#idPropName,
			item[this.#idPropName]
		);
		for (const index of indexes) {
			this.#items[index] = item;
			patched++;
		}

		this.#recreateSearchableFor(item);

		if (patched && publish) this.#publishCurrent();

		return !!patched;
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
			patched += Number(this.patch(item));
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

		// Update indexes
		this.#removeItemFromIndexes(removedItem, index);

		// Adjust active index if needed
		if (this.#activeIndex !== undefined) {
			if (index === this.#activeIndex) {
				// The active item was removed, adjust to next item or undefined if empty
				this.#activeIndex = this.size > 0 ? index % this.size : undefined;
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
			this.removeAt(index);
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
		const id =
			typeof idOrItem === "string" ? idOrItem : idOrItem[this.#idPropName];
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
		return propIndex.get(value) ?? [];
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
		options: Partial<{ maxDistance: number }> = {}
	): T[] {
		if (!this.#searchable) {
			throw new TypeError("This collection is not cofigured as searchable");
		}
		const ids = this.#searchable?.search(query, strategy, options);
		const out = [];
		for (const id of ids) {
			out.push(this.findBy(this.#idPropName, id)!);
		}

		// make "lastQuery" reactive
		this.#publishCurrent();

		return out;
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
	 * Clear all items from the collection
	 * Also clears active index and resets all tag associations
	 * @param publish - Whether to notify subscribers (default: true)
	 * @returns This collection instance for chaining
	 */
	clear(publish = true): ItemCollection<T> {
		this.#items = [];
		this.#activeIndex = undefined;
		this.#indexesByProperty = new Map();

		// Clear all tags
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

	/** Build an index for a specific property */
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
	}

	/** Update indexes when adding a new item */
	#updateItemIndexes(item: T, index: number) {
		for (const prop in item) {
			if (Object.prototype.hasOwnProperty.call(item, prop)) {
				if (!this.#indexesByProperty.has(prop)) {
					this.#indexesByProperty.set(prop, new Map<any, number[]>());
				}

				const propIndex = this.#indexesByProperty.get(prop)!;
				const value = item[prop];

				if (!propIndex.has(value)) {
					propIndex.set(value, []);
				}

				propIndex.get(value)!.push(index);
			}
		}
	}

	/** Remove an item from indexes when removing from collection */
	#removeItemFromIndexes(_item: T, _removedIndex: number) {
		// For simplicity, rebuild all indexes
		// This is more reliable than trying to update just the affected entries
		this.#rebuildAllIndexes();
	}

	/** Rebuild all property indexes */
	#rebuildAllIndexes() {
		this.#indexesByProperty = new Map();

		// Rebuild common indexes
		this.#buildIndexForProperty(this.#idPropName);
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
		publish = true
	): boolean {
		let res = false;

		for (const index of indexes) {
			res = this.applyTagByIndex(index, tagName, false);
			if (!res) break;
		}

		if (publish) this.#publishCurrent();

		return res;
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
		publish = true
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
			this.removeTag(item, tagName);
		} else {
			this.applyTag(item, tagName);
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
		publish = true
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
		publish = true
	): boolean {
		if (!this.#tagConfigs.has(tagName)) {
			this.#tagConfigs.set(tagName, { cardinality: Infinity });
			this.#tags.set(tagName, new Set());
		}

		const currentConfig = this.#tagConfigs.get(tagName)!;
		Object.assign(currentConfig, config);

		// If cardinality is reduced, we may need to remove tags
		if (
			config.cardinality !== undefined &&
			config.cardinality < this.#tags.get(tagName)!.size
		) {
			this.#enforceTagCardinality(tagName);
			if (publish) this.#publishCurrent();
		}

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
		sortFn ??= this.#sortFn;
		if (sortFn) {
			this.#items = this.#items.toSorted(sortFn);
			this.#rebuildAllIndexes();
			if (publish) this.#publishCurrent();
			return true;
		}
		return false;
	}

	/**
	 * Export collection state to a JSON-serializable object
	 * @returns A dump object containing all collection state
	 */
	toJSON(): ItemCollectionDump<T> {
		// Create a serializable tags object
		const serializedTags: Record<string, number[]> = {};
		for (const [tagName, tagSet] of this.#tags.entries()) {
			serializedTags[tagName] = Array.from(tagSet);
		}

		// Create a serializable tag configs object
		const serializedTagConfigs: Record<string, { cardinality: number }> = {};
		for (const [tagName, config] of this.#tagConfigs.entries()) {
			serializedTagConfigs[tagName] = { ...config };
		}

		return {
			// Collection items
			items: this.#items,

			// Collection state
			activeIndex: this.#activeIndex,
			cardinality: this.#cardinality,
			unique: this.#unique,
			idPropName: this.#idPropName,

			// Tag information
			tags: serializedTags,
			tagConfigs: serializedTagConfigs,
		};
	}

	/**
	 * Serialize the collection to a JSON string
	 * @returns JSON string representation of the collection
	 */
	dump(): string {
		return JSON.stringify(this);
	}

	/**
	 * Restore collection state from a serialized dump
	 * @param dump - JSON string or dump object to restore from
	 * @returns true if successful, false if failed
	 */
	restore(dump: string | ItemCollectionDump<T>): boolean {
		if (!dump) return false;

		if (typeof dump === "string") {
			dump = JSON.parse(dump);
		}

		if (typeof dump !== "object") return false;

		try {
			// Clear current state
			this.clear(false);

			// Restore configuration
			this.#cardinality = dump.cardinality ?? Infinity;
			this.#unique = !!dump.unique;
			this.#idPropName = dump.idPropName;

			//
			if (Array.isArray(dump.items)) {
				this.addMany(dump.items, false);
				this.#rebuildAllIndexes();
			}

			// Restore active index
			if (
				typeof dump.activeIndex === "number" &&
				dump.activeIndex >= 0 &&
				dump.activeIndex < this.size
			) {
				this.#activeIndex = dump.activeIndex;
			}

			// Restore tag configurations
			if (dump.tagConfigs && typeof dump.tagConfigs === "object") {
				for (const [tagName, config] of Object.entries(dump.tagConfigs)) {
					this.#tagConfigs.set(tagName, { ...config });

					// Initialize tag sets that might not have entries
					if (!this.#tags.has(tagName)) {
						this.#tags.set(tagName, new Set());
					}
				}
			}

			// Restore tag sets
			if (dump.tags && typeof dump.tags === "object") {
				for (const [tagName, indexes] of Object.entries(dump.tags)) {
					if (Array.isArray(indexes)) {
						const tagSet = new Set<number>();

						// Only add valid indexes
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
			}

			this.#publishCurrent();

			return true;
		} catch (error) {
			console.error("Unable to restore", error);
			// If any error occurs during restoration, ensure the collection is in a clean state
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
		}) => void
	): () => void {
		const unsub = this.#pubsub.subscribe("change", cb);
		cb(this.#current()); // notify newly subscribed asap
		return unsub;
	}

	#publishCurrent() {
		this.#pubsub.publish("change", this.#current());
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
