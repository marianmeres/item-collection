// deno-lint-ignore-file no-explicit-any
import { Searchable, type SearchableOptions } from "@marianmeres/searchable";

/** The Item in collection */
export interface Item extends Record<string, any> {
	// supporting any
	// id: string;
}

/** Supported searchable options */
export interface ItemCollectionSearchableOptions<T>
	extends Partial<SearchableOptions> {
	// method to extract searchable content from item
	getContent: (item: T) => string;
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

	#normalizeFn: (item: any) => T = (item: any) => item;

	//
	#searchable: undefined | Searchable;
	#searchableGetContent:
		| undefined
		| ItemCollectionSearchableOptions<T>["getContent"];

	/** Create a new ItemCollection */
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
		this.configure(options);
		this.addMany(initial);
	}

	/** Get the current number of items in the collection */
	get size(): number {
		return this.#items.length;
	}

	/** Get the currently active item */
	get active(): T | undefined {
		return this.#activeIndex !== undefined
			? this.#items[this.#activeIndex]
			: undefined;
	}

	/** Alias for getAll */
	get items(): T[] {
		return this.getAll();
	}

	/** Get the instance options */
	get config(): {
		cardinality: number;
		tags: Record<string, { cardinality: number }>;
		allowNextPrevCycle: boolean;
		allowUnconfiguredTags: boolean;
		unique: boolean;
		idPropName: string;
	} {
		return {
			cardinality: this.#cardinality,
			tags: Object.fromEntries(this.#tagConfigs.entries()),
			allowNextPrevCycle: this.#allowNextPrevCycle,
			allowUnconfiguredTags: this.#allowUnconfiguredTags,
			unique: this.#unique,
			idPropName: this.#idPropName,
		};
	}

	/** Get the configured "id" property name */
	get idPropName(): string {
		return this.#idPropName;
	}

	/** Get the searchable instance (if configured) */
	get searchable(): Searchable | undefined {
		return this.#searchable;
	}

	/** Configure options */
	configure(options: Partial<ItemCollectionConfig<T>>): ItemCollection<T> {
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

		return this;
	}

	/** Set the active item by reference */
	setActive(item: T | undefined): boolean {
		if (!item) return false;

		const index = this.#items.indexOf(item);
		if (index === -1) return false;

		this.#activeIndex = index;
		return true;
	}

	/** Set the active item by index number  */
	setActiveIndex(index: number): T | undefined {
		this.#activeIndex = this.size > 0 ? index % this.size : undefined;
		return this.active;
	}

	/** Will unmark as active */
	unsetActive(): ItemCollection<T> {
		this.#activeIndex === undefined;
		return this;
	}

	/** Will get the item at index. */
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

	/** Add an item to the collection */
	add(item: T, autoSort = true): boolean {
		if (!item) {
			return false;
		}

		if (this.size >= this.#cardinality) {
			return false;
		}

		// normalize asap
		item = this.#normalizeFn(item);

		// Check uniqueness if enabled
		if (this.#unique && this.exists(item[this.#idPropName])) {
			return false;
		}

		this.#items.push(item);

		if (autoSort) {
			// resort & rebuild indexes
			this.sort();
		} else {
			// Update indexes for all properties
			this.#updateItemIndexes(item, this.#items.length - 1);
		}

		this.#recreateSearchableFor(item);

		return true;
	}

	/** Add multiple items to the collection */
	addMany(items: T[]): number {
		if (!Array.isArray(items)) return 0;

		let added = 0;
		for (const item of items) {
			// optimize: do not sort here on each loop iteration..
			if (this.add(item, false)) {
				added++;
			}
		}

		// sort just once
		if (added) {
			this.sort();
		}

		return added;
	}

	/** Will re-add if exists (id check). Useful for optimistic UI strategies. */
	patch(item: T | undefined): number {
		if (!item) return 0;

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

		return patched;
	}

	/** Will re-add many if exist (id check). Useful for optimistic UI strategies. */
	patchMany(items: (T | undefined)[]): number {
		let patched = 0;
		for (const item of items) {
			patched += this.patch(item);
		}
		return patched;
	}

	/** Remove an item from the collection */
	remove(item: T | undefined): boolean {
		if (!item) return false;

		const index = this.#items.indexOf(item);
		if (index === -1) return false;

		return this.removeAt(index);
	}

	/** Remove an item at the specified index */
	removeAt(index: number): boolean {
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

		return true;
	}

	/** Remove all items found by property value */
	removeAllBy(property: string, value: any): number {
		let removed = 0;

		let index = this.findIndexBy(property, value);
		while (index >= 0) {
			this.removeAt(index);
			removed++;
			index = this.findIndexBy(property, value);
		}

		return removed;
	}

	/** Move to the next item and make it active */
	next(): T | undefined {
		if (this.size === 0) return undefined;

		if (this.#activeIndex === undefined) {
			this.#activeIndex = 0;
		} else {
			if (this.#activeIndex === this.size - 1) {
				if (this.#allowNextPrevCycle) this.#activeIndex = 0;
			} else {
				this.#activeIndex++;
			}
		}

		return this.active;
	}

	/** Move to the previous item and make it active */
	previous(): T | undefined {
		if (this.size === 0) return undefined;

		if (this.#activeIndex === undefined) {
			this.#activeIndex = 0;
		} else {
			if (this.#activeIndex === 0) {
				if (this.#allowNextPrevCycle) this.#activeIndex = this.size - 1;
			} else {
				this.#activeIndex--;
			}
		}

		return this.active;
	}

	/** Check if an item with the specified id exists in the collection */
	exists(id: string): boolean {
		return this.findBy(this.#idPropName, id) !== undefined;
	}

	/** Find the first item by its id (defined as this.#idPropName) */
	findById(id: string): T | undefined {
		return this.findBy(this.#idPropName, id);
	}

	/** Find the first item by a property value */
	findBy(property: string, value: any): T | undefined {
		return this.#items[this.findIndexBy(property, value)];
	}

	/** Find all items by a property value */
	findAllBy(property: string, value: any): T[] {
		const indexes = this.findAllIndexesBy(property, value);
		return indexes.map((idx: number) => this.#items[idx]);
	}

	/** Find the first item's index by a property value */
	findIndexBy(property: string, value: any): number {
		const indexes = this.findAllIndexesBy(property, value);
		return indexes[0] ?? -1;
	}

	/** Find all item's indexes by a property value */
	findAllIndexesBy(property: string, value: any): number[] {
		if (!this.#indexesByProperty.has(property)) {
			this.#buildIndexForProperty(property);
		}

		const propIndex = this.#indexesByProperty.get(property)!;
		return propIndex.get(value) ?? [];
	}

	search(query: string): T[] {
		if (!this.#searchable) {
			throw new TypeError("This collection is not cofigured as searchable");
		}
		const ids = this.#searchable?.search(query);
		const out = [];
		for (const id of ids) {
			out.push(this.findBy(this.#idPropName, id)!);
		}
		return out;
	}

	/** Move an item from one position to another */
	move(fromIndex: number, toIndex: number): boolean {
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

	/** Clear all items from the collection */
	clear(): void {
		this.#items = [];
		this.#activeIndex = undefined;
		this.#indexesByProperty = new Map();

		// Clear all tags
		for (const tagSet of this.#tags.values()) {
			tagSet.clear();
		}
	}

	/** Get all items in the collection */
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

	/** Add a tag to an item */
	applyTag(item: T | undefined, tagName: string): boolean {
		if (!item) return false;

		const index = this.#items.indexOf(item);
		if (index === -1) return false;

		return this.applyTagByIndex(index, tagName);
	}

	/** Add a tag to an item at the specified index */
	applyTagByIndex(index: number, tagName: string): boolean {
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
		return true;
	}

	/** Remove a tag from an item */
	removeTag(item: T | undefined, tagName: string): boolean {
		if (!item) return false;

		const index = this.#items.indexOf(item);
		if (index === -1) return false;

		return this.removeTagByIndex(index, tagName);
	}

	/** Remove a tag from an item at the specified index */
	removeTagByIndex(index: number, tagName: string): boolean {
		if (index < 0 || index >= this.size) return false;

		if (!this.#tags.has(tagName)) return false;

		const tagSet = this.#tags.get(tagName)!;
		if (!tagSet.has(index)) return false;

		tagSet.delete(index);
		return true;
	}

	/** Check if an item has a specific tag */
	hasTag(item: T | undefined, tagName: string): boolean {
		if (!item) return false;

		const index = this.#items.indexOf(item);
		if (index === -1) return false;

		return this.hasTagByIndex(index, tagName);
	}

	/** Check if an item at the specified index has a specific tag */
	hasTagByIndex(index: number, tagName: string): boolean {
		if (index < 0 || index >= this.size) return false;

		if (!this.#tags.has(tagName)) return false;

		return this.#tags.get(tagName)!.has(index);
	}

	/** Get all items with a specific tag */
	getByTag(tagName: string): T[] {
		if (!this.#tags.has(tagName)) return [];

		const tagSet = this.#tags.get(tagName)!;
		return Array.from(tagSet).map((index) => this.#items[index]);
	}

	/** Get indexes of all items with a specific tag */
	getIndexesByTag(tagName: string): number[] {
		if (!this.#tags.has(tagName)) return [];

		return Array.from(this.#tags.get(tagName)!);
	}

	/** Toggle an item's tag */
	toggleTag(item: T | undefined, tagName: string): boolean {
		if (!item) return false;

		const hasTag = this.hasTag(item, tagName);
		if (hasTag) {
			this.removeTag(item, tagName);
		} else {
			this.applyTag(item, tagName);
		}
		return !hasTag;
	}

	/** Toggle tag state for an item by index */
	toggleTagByIndex(index: number, tagName: string): boolean {
		const hasTag = this.hasTagByIndex(index, tagName);
		if (hasTag) {
			return this.removeTagByIndex(index, tagName);
		} else {
			return this.applyTagByIndex(index, tagName);
		}
	}

	/** Remove the tag altogether */
	deleteTag(tagName: string): boolean {
		if (!this.#tags.has(tagName)) return false;

		this.#tags.delete(tagName);
		this.#tagConfigs.delete(tagName);
		return true;
	}

	/** Configure a tag's options (cardinality only at this moment) */
	configureTag(
		tagName: string,
		config: { cardinality: number } = { cardinality: Infinity }
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

	/** Will (re)sort the collection with provided sortFn or with default.
	 * Normally, there is no need to sort manually. The collection will be resorted at
	 * all times automatically. */
	sort(sortFn?: (a: T, b: T) => number): boolean {
		sortFn ??= this.#sortFn;
		if (sortFn) {
			this.#items = this.#items.toSorted(sortFn);
			this.#rebuildAllIndexes();
			return true;
		}
		return false;
	}

	/** Dump the collection state to a JSON-serializable object */
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

	/** Serialize the collection to a JSON string */
	dump(): string {
		return JSON.stringify(this);
	}

	/** Restore the collection state from a serialized object */
	restore(dump: string | ItemCollectionDump<T>): boolean {
		if (!dump) return false;

		if (typeof dump === "string") {
			dump = JSON.parse(dump);
		}

		if (typeof dump !== "object") return false;

		try {
			// Clear current state
			this.clear();

			// Restore configuration
			this.#cardinality = dump.cardinality ?? Infinity;
			this.#unique = !!dump.unique;
			this.#idPropName = dump.idPropName;

			//
			if (Array.isArray(dump.items)) {
				this.addMany(dump.items);
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

			return true;
		} catch (error) {
			console.error("Unable to restore", error);
			// If any error occurs during restoration, ensure the collection is in a clean state
			this.clear();
			return false;
		}
	}

	/** Create a new ItemCollection from a JSON string */
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
