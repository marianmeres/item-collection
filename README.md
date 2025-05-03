# @marianmeres/item-collection

A versatile utility class for managing collections of items. 

It provides:
- an ordered (with customizable sort fn) collection with configurable uniqueness 
  and cardinality constraints, 
- active item tracking and navigation (previous/next), 
- generic indexed tagging system that allows for flexible item categorization 
  (with optional cardinality constraints per tag),
- high performance lookups even for large collections,
- built-in support for text search (via [searchable](https://github.com/marianmeres/searchable))

## Installation
```sh
deno add jsr:@marianmeres/item-collection
```
```sh
npm install @marianmeres/item-collection
```

## Basic usage
```js
import { ItemCollection } from '@marianmeres/item-collection';
```

```typescript
// create instance
const c = new ItemCollection<T>(
    [/* initial items */], 
    options: Partial<{
        cardinality: number;
        tags: Record<string, { cardinality: number }>;
        allowNextPrevCycle: boolean;
        allowUnconfiguredTags: boolean;
        unique: boolean;
        idPropName: string;
        sortFn: undefined | ((a: T, b: T) => number);
        searchable: ItemCollectionSearchableOptions<T> | undefined | null;
    }>
);

// some of the instance methods:

// basics
c.size;
c.at(index: number): T | undefined;
c.add(item: T): boolean;
c.addMany(items: T[]): number;
c.remove(item: T | undefined): boolean;
c.removeAt(index: number): boolean;
c.removeAllBy(property: string, value: any): number;
c.move(fromIndex: number, toIndex: number): boolean;

// navigation
c.active;
c.setActive(item: T | undefined): boolean;
c.setActiveIndex(index: number): T | undefined;
c.unsetActive(): ItemCollection<T>;
c.next(): T | undefined;
c.previous(): T | undefined;

// lookups
c.exists(id: string): boolean;
c.findBy(property: string, value: any): T | undefined;
c.findAllBy(property: string, value: any): T[];
c.findIndexBy(property: string, value: any): number;
c.findAllIndexesBy(property: string, value: any): number[];
c.search(query: string): T[];

// tagging
c.configureTag(tagName: string, config: { cardinality: number }): boolean;
c.applyTag(item: T | undefined, tagName: string): boolean;
c.applyTagByIndex(index: number, tagName: string): boolean;
c.removeTag(item: T | undefined, tagName: string): boolean;
c.removeTagByIndex(index: number, tagName: string): boolean;
c.hasTag(item: T | undefined, tagName: string): boolean;
c.hasTagByIndex(index: number, tagName: string): boolean;
c.getByTag(tagName: string): T[];
c.getIndexesByTag(tagName: string): number[];
c.toggleTag(item: T | undefined, tagName: string): boolean;
c.toggleTagByIndex(index: number, tagName: string): boolean;
c.deleteTag(tagName: string): boolean;

// dump + restore, serialize
c.toJSON(): ItemCollectionDump<T>;
c.dump(): string;
c.restore(dump: string | ItemCollectionDump<T>): boolean;
```