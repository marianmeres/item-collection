// deno-lint-ignore-file no-explicit-any

import { assert, assertEquals, assertThrows } from "@std/assert";
import { ItemCollection, type ItemCollectionConfig } from "../src/mod.ts";

const clog = console.log;

const createAbc = (opts: Partial<ItemCollectionConfig<{ id: string }>> = {}) =>
	new ItemCollection([{ id: "a" }, { id: "b" }, { id: "c" }], opts);

Deno.test("sanity check", () => {
	const c = createAbc();

	c.restore(c.dump());

	assertEquals(c.active, undefined);
	assertEquals(c.size, 3);
	assertEquals(c.config, {
		cardinality: Infinity,
		tags: {},
		allowNextPrevCycle: false,
		allowUnconfiguredTags: true,
		unique: true,
		idPropName: "id",
	});

	assertEquals(c.at(0), { id: "a" });
	assertEquals(c.at(2), { id: "c" });

	assert(!c.exists("x"));

	c.clear();
	assertEquals(c.size, 0);
});

Deno.test("toggle add", () => {
	const c = createAbc();
	assertEquals(c.findAllIndexesBy("id", "a"), [0]);
	c.toggleAdd({ id: "a" });
	assertEquals(c.findAllIndexesBy("id", "a"), []);
	c.toggleAdd({ id: "a" });
	assertEquals(c.findAllIndexesBy("id", "a"), [2]);
});

Deno.test("unique", () => {
	const c = createAbc({ unique: false });

	assert(c.exists("a"));

	// add dupe, must work by default
	assert(c.add({ id: "a" }));
	assertEquals(c.size, 4);

	//
	assertEquals(c.findIndexBy("id", "a"), 0); // first
	assertEquals(c.findAllIndexesBy("id", "a"), [0, 3]);
	assertEquals(c.findAllIndexesBy("id", "b"), [1]);
	assertEquals(c.findIndexBy("id", "xxx"), -1);

	// marking later as unique, does not remove potential dupes
	c.configure({ unique: true });
	assertEquals(c.size, 4);

	// but dump/restore should
	c.restore(c.dump());
	assertEquals(c.size, 3);

	// now adding dupe must not work
	assert(!c.add({ id: "a" }));
	assertEquals(c.size, 3);
});

Deno.test("add/remove", () => {
	const c = createAbc({ unique: false });
	c.add({ id: "a" });
	assertEquals(c.size, 4);

	assertEquals(c.removeAllBy("id", "a"), 2);
	assertEquals(c.size, 2);

	assertEquals(c.at(1), { id: "c" });
});

Deno.test("active", () => {
	const c = createAbc();

	assertEquals(c.active, undefined);
	assertEquals(c.next(), { id: "a" });
	assertEquals(c.previous(), { id: "a" });
	assertEquals(c.next(), { id: "b" });
	assertEquals(c.next(), { id: "c" });
	assertEquals(c.next(), { id: "c" });

	c.configure({ allowNextPrevCycle: true });
	assertEquals(c.next(), { id: "a" });
	assertEquals(c.previous(), { id: "c" });
	assertEquals(c.previous(), { id: "b" });
	assertEquals(c.previous(), { id: "a" });

	c.setActive(c.findById("b")!);
	assertEquals(c.active, { id: "b" });

	c.setActiveIndex(0);
	assertEquals(c.active, { id: "a" });

	c.setActiveIndex(2);
	assertEquals(c.active, { id: "c" });
	// clog(c.dump());
});

Deno.test("cardinality", () => {
	const c = createAbc({ cardinality: 2 });
	assertEquals(c.size, 2);
	assert(!c.add({ id: "d" }));
	assertEquals(c.size, 2);

	assert(c.isFull);
	c.removeAt(0);
	assert(!c.isFull);
});

Deno.test("tags", () => {
	const c = createAbc();

	c.applyTag(c.at(0), "foo");
	c.applyTag(c.at(2), "foo");

	assert(c.hasTag(c.at(0), "foo"));
	assert(!c.hasTag(c.at(1), "foo"));
	assert(c.hasTag(c.at(2), "foo"));

	assertEquals(c.getByTag("foo"), [{ id: "a" }, { id: "c" }]);

	assertEquals(c.getIndexesByTag("foo"), [0, 2]);
	assertEquals(c.getIndexesByTag("xxx"), []);

	assert(!c.toggleTag(c.at(2), "foo")); // false - tag was removed
	assert(!c.hasTag(c.at(2), "foo"));

	assertEquals(c.toggleTagByIndex(999, "asdf"), undefined); // undef - item does not exist
});

Deno.test("unconfigured tags", () => {
	const c = createAbc({ allowUnconfiguredTags: false });
	assertThrows(() => c.applyTag(c.at(0), "foo"));

	c.configure({ allowUnconfiguredTags: true });
	c.applyTag(c.at(0), "foo");

	assert(c.hasTag(c.at(0), "foo"));
	c.removeTagByIndex(0, "foo");
	assert(!c.hasTag(c.at(0), "foo"));
});

Deno.test("tags cardinality", () => {
	const c = createAbc({
		tags: { foo: { cardinality: 2 } },
	});

	[0, 1, 2].forEach((idx) => c.applyTagByIndex(idx, "foo"));

	// not 3
	assertEquals(c.getByTag("foo"), [{ id: "a" }, { id: "b" }]);

	assert(!c.hasTagByIndex(2, "foo"));
	assert(c.deleteTag("foo"));
	assert(!c.deleteTag("foo")); // not exists anymore
	// clog(c.getByTag("foo"));
	// clog(c.dump());
});

Deno.test("tags index move item", () => {
	const c = createAbc();
	c.applyTag(c.at(0), "foo");
	c.applyTag(c.at(1), "foo");
	assertEquals(c.getIndexesByTag("foo"), [0, 1]);

	// tag is moved with the item (former 1 becomes 0 now)
	c.move(0, 2);
	assertEquals(c.getIndexesByTag("foo"), [0, 2]);

	// tag is removed with the item (former 2 becomes 1 now)
	c.removeAt(0);
	assertEquals(c.getIndexesByTag("foo"), [1]);
});

Deno.test("move", () => {
	const c = createAbc();
	c.setActiveIndex(1);
	assertEquals(c.findById("b"), c.active);
	assertEquals(c.findAllIndexesBy("id", "b"), [1]);

	c.move(0, 2);

	assertEquals(c.items, [{ id: "b" }, { id: "c" }, { id: "a" }]);

	// b is still active, although now living on different index
	assertEquals(c.findById("b"), c.active);
	assertEquals(c.findAllIndexesBy("id", "b"), [0]);
	// clog(c.dump());
});

Deno.test("custom id prop name", () => {
	const c = new ItemCollection<{ foo: string }>(
		[{ foo: "a" }, { foo: "b" }, { foo: "c" }],
		{ idPropName: "foo" }
	);

	assert(!c.add({ foo: "a" }));
	assertEquals(c.findById("a"), { foo: "a" });
});

Deno.test("searchable", () => {
	const c = new ItemCollection<{ foo: string; _s: string }>(
		[
			{ foo: "a", _s: "Hey" },
			{ foo: "b", _s: "Ho" },
			{ foo: "c", _s: "Let's Go" },
		],
		{
			unique: false,
			idPropName: "foo",
			searchable: {
				getContent: (item) => item._s,
			},
		}
	);

	assertEquals(
		c
			.search("h")
			.map((o) => o.foo)
			.toSorted(),
		["a", "b"]
	);
	assertEquals(c.search("go"), [c.at(2)]);

	c.add({ foo: "a", _s: "completely new content" });
	assertEquals(c.search("hey"), []); // must not be "a" anymore
	assertEquals(c.search("new"), [c.at(0)]);
});

Deno.test("custom sortFn", () => {
	const c = createAbc({
		sortFn: (a, b) => b.id.localeCompare(a.id),
	});

	c.add({ id: "x" });
	assertEquals(c.items, [{ id: "x" }, { id: "c" }, { id: "b" }, { id: "a" }]);
});

Deno.test("custom normalizeFn", () => {
	const c = new ItemCollection<any>(["a", "b", "c"], {
		normalizeFn: (item: any) => {
			if (typeof item === "string") {
				item = { id: item };
			}
			return { id: item.id.toUpperCase() };
		},
	});

	c.add({ id: "x" });
	assertEquals(c.items, [{ id: "A" }, { id: "B" }, { id: "C" }, { id: "X" }]);
});

Deno.test("patch works", () => {
	const c = new ItemCollection<{ foo: string; _s: string }>(
		[
			{ foo: "a", _s: "Hey" },
			{ foo: "b", _s: "Ho" },
			{ foo: "c", _s: "Let's Go" },
		],
		{
			unique: false,
			idPropName: "foo",
			searchable: {
				getContent: (item) => item._s,
			},
		}
	);

	assertEquals(c.search("go"), [c.at(2)]);

	c.patchMany([{ foo: "b", _s: "go" }]);

	assertEquals(
		c
			.search("go")
			.map((o) => o.foo)
			.toSorted(),
		["b", "c"]
	);
});

Deno.test("subscription", () => {
	const c = createAbc();

	let log: any[] = [];
	let foos: any[] = [];

	// subscribing gets the current state immediately
	const unsubscribe = c.subscribe((data) => {
		log.push(data);
		foos = c.getIndexesByTag("foo");
	});

	//
	assertEquals(log.length, 1);
	assertEquals(log[0].items.length, 3);
	assertEquals(log[0].size, 3);
	assertEquals(log[0].active, undefined);
	assertEquals(foos, []);

	//
	c.applyTagByIndex(1, "foo");
	assertEquals(log.length, 2);
	assertEquals(log[1].items.length, 3);
	assertEquals(log[1].size, 3);
	assertEquals(log[1].active, undefined);
	assertEquals(foos, [1]);

	//
	c.add({ id: "x" });
	assertEquals(log.length, 3);
	assertEquals(log[2].items.length, 4);
	assertEquals(log[2].size, 4);
	assertEquals(log[2].active, undefined);
	assertEquals(foos, [1]);

	//
	c.last();
	assertEquals(log.length, 4);
	assertEquals(log[3].items.length, 4);
	assertEquals(log[3].size, 4);
	assertEquals(log[3].active, { id: "x" });
	assertEquals(foos, [1]);

	// noop must not be triggered
	c.last();
	assertEquals(log.length, 4); // still 4

	//
	c.deleteTag("foo");
	assertEquals(log.length, 5);
	assertEquals(foos, []);

	//
	unsubscribe();

	// from now on, no more detected changes
	c.clear();
	assertEquals(log.length, 5); // still 5
});
