// deno-lint-ignore-file no-explicit-any

import { assert, assertEquals, assertThrows } from "@std/assert";
import { ItemCollection, type ItemCollectionConfig } from "../src/mod.ts";

const createAbc = (opts: Partial<ItemCollectionConfig<{ id: string }>> = {}) =>
	new ItemCollection([{ id: "a" }, { id: "b" }, { id: "c" }], opts);

Deno.test("sanity check", () => {
	const c = createAbc();

	c.restore(c.dump());

	assertEquals(c.isFull, false);
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
	assertEquals(c.setActiveNext(), { id: "a" });
	assertEquals(c.setActivePrevious(), { id: "a" });
	assertEquals(c.setActiveNext(), { id: "b" });
	assertEquals(c.setActiveNext(), { id: "c" });
	assertEquals(c.setActiveNext(), { id: "c" });

	c.configure({ allowNextPrevCycle: true });
	assertEquals(c.setActiveNext(), { id: "a" });
	assertEquals(c.setActivePrevious(), { id: "c" });
	assertEquals(c.setActivePrevious(), { id: "b" });
	assertEquals(c.setActivePrevious(), { id: "a" });

	c.setActive(c.findById("b")!);
	assertEquals(c.active, { id: "b" });

	c.setActiveIndex(0);
	assertEquals(c.active, { id: "a" });

	c.setActiveIndex(2);
	assertEquals(c.active, { id: "c" });

	// "deactivate"
	c.unsetActive();
	assertEquals(c.active, undefined);
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

Deno.test("tags by indexes", () => {
	const c = createAbc();

	assert(c.applyTagByIndexes([1, 2], "foo"));
	assert(!c.applyTagByIndexes([100], "foo"));
	assertEquals(c.getByTag("foo"), [{ id: "b" }, { id: "c" }]);

	// at least one success
	assert(c.removeTagByIndexes([0, 1], "foo"));

	assertEquals(c.getByTag("foo"), [{ id: "c" }]);
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
		{ idPropName: "foo" },
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
		},
	);

	assertEquals(
		c
			.search("h")
			.map((o) => o.foo)
			.toSorted(),
		["a", "b"],
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
		},
	);

	assertEquals(c.search("go"), [c.at(2)]);

	c.patchMany([{ foo: "b", _s: "go" }]);

	assertEquals(
		c
			.search("go")
			.map((o) => o.foo)
			.toSorted(),
		["b", "c"],
	);
});

Deno.test("subscription", () => {
	const c = createAbc();

	const log: any[] = [];
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
	c.setActiveLast();
	assertEquals(log.length, 4);
	assertEquals(log[3].items.length, 4);
	assertEquals(log[3].size, 4);
	assertEquals(log[3].active, { id: "x" });
	assertEquals(foos, [1]);

	// noop must not be triggered
	c.setActiveLast();
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

// ---------------------------------------------------------------------------
// Regression tests for 1.4 fixes.
// ---------------------------------------------------------------------------

// Helper that counts publish notifications (ignoring the initial snapshot).
function countPublishes<T extends { id: string }>(
	c: ItemCollection<T>,
): { count: () => number; unsubscribe: () => void } {
	let n = -1; // first call is the initial snapshot
	const unsubscribe = c.subscribe(() => n++);
	return { count: () => n, unsubscribe };
}

Deno.test("toggleTag publishes exactly once per call (B1)", () => {
	const c = createAbc();
	const p = countPublishes(c);

	c.toggleTag(c.at(0), "foo");
	assertEquals(p.count(), 1);

	c.toggleTag(c.at(0), "foo");
	assertEquals(p.count(), 2);

	p.unsubscribe();
});

Deno.test("removeAllBy publishes exactly once regardless of match count (B2)", () => {
	const c = new ItemCollection(
		[{ id: "a" }, { id: "b" }, { id: "a" }, { id: "c" }, { id: "a" }],
		{ unique: false },
	);
	const p = countPublishes(c);

	const removed = c.removeAllBy("id", "a");
	assertEquals(removed, 3);
	assertEquals(c.size, 2);
	assertEquals(p.count(), 1);

	p.unsubscribe();
});

Deno.test("addMany publishes exactly once (B3)", () => {
	const c = new ItemCollection<{ id: string }>([]);
	const p = countPublishes(c);

	c.addMany([{ id: "a" }, { id: "b" }, { id: "c" }]);
	assertEquals(c.size, 3);
	assertEquals(p.count(), 1);

	p.unsubscribe();
});

Deno.test("patchMany publishes exactly once (B4)", () => {
	const c = createAbc();
	const p = countPublishes(c);

	c.patchMany([
		{ id: "a" },
		{ id: "b" },
	]);
	assertEquals(p.count(), 1);

	p.unsubscribe();
});

Deno.test("patch refreshes indexes for mutated properties (B5)", () => {
	const c = new ItemCollection<{ id: string; status: string }>([
		{ id: "a", status: "draft" },
		{ id: "b", status: "draft" },
		{ id: "c", status: "published" },
	]);

	// warm the "status" index so its lifecycle is tested
	assertEquals(c.findAllBy("status", "draft").map((x) => x.id), ["a", "b"]);

	// patch b → published
	assert(c.patch({ id: "b", status: "published" }));

	assertEquals(c.findAllBy("status", "draft").map((x) => x.id), ["a"]);
	assertEquals(
		c.findAllBy("status", "published").map((x) => x.id).toSorted(),
		["b", "c"],
	);

	// patch with mismatched id is rejected (defensive)
	assert(!c.patch({ id: "zz", status: "draft" }));
});

Deno.test("restore round-trips Infinity cardinality safely (B8)", () => {
	const c = new ItemCollection(
		[{ id: "a" }, { id: "b" }],
		{ tags: { featured: { cardinality: Infinity } } },
	);
	c.applyTag(c.at(0), "featured");
	c.applyTag(c.at(1), "featured");

	const json = c.dump();
	assert(json.includes('"cardinality":null'), "Infinity serializes as null");

	const c2 = ItemCollection.fromJSON<{ id: string }>(json);
	assertEquals(c2.config.cardinality, Infinity);
	assertEquals(c2.config.tags.featured.cardinality, Infinity);
	// Tag application still works after round-trip (was silently failing before).
	c2.add({ id: "c" });
	assert(c2.applyTag(c2.findById("c"), "featured"));
	assertEquals(c2.getByTag("featured").map((x) => x.id).toSorted(), [
		"a",
		"b",
		"c",
	]);
});

Deno.test("restore enforces tag cardinality on oversized dumps (B6)", () => {
	const dump = {
		version: 1,
		items: [{ id: "a" }, { id: "b" }, { id: "c" }],
		activeIndex: undefined,
		cardinality: null,
		unique: true,
		idPropName: "id",
		allowNextPrevCycle: false,
		allowUnconfiguredTags: true,
		tags: { featured: [0, 1, 2] },
		tagConfigs: { featured: { cardinality: 1 } },
	};

	const c = new ItemCollection<{ id: string }>();
	assert(c.restore(dump as any));
	assertEquals(c.getByTag("featured").length, 1);
});

Deno.test("restore preserves allowNextPrevCycle and allowUnconfiguredTags (B7)", () => {
	const c = new ItemCollection([{ id: "a" }], {
		allowNextPrevCycle: true,
		allowUnconfiguredTags: false,
	});
	const json = c.dump();
	const c2 = ItemCollection.fromJSON<{ id: string }>(json);
	assertEquals(c2.config.allowNextPrevCycle, true);
	assertEquals(c2.config.allowUnconfiguredTags, false);
});

Deno.test("restore accepts legacy dumps missing new fields (B7)", () => {
	const legacy = {
		items: [{ id: "a" }],
		activeIndex: 0,
		cardinality: 100,
		unique: true,
		idPropName: "id",
		tags: {},
		tagConfigs: {},
	};
	// construct with distinctive settings so we can verify they are preserved
	const c = new ItemCollection([{ id: "x" }], {
		allowNextPrevCycle: true,
		allowUnconfiguredTags: false,
	});
	assert(c.restore(legacy as any));
	assertEquals(c.size, 1);
	assertEquals(c.findById("a"), { id: "a" });
	// New fields retained from the prior construction:
	assertEquals(c.config.allowNextPrevCycle, true);
	assertEquals(c.config.allowUnconfiguredTags, false);
});

Deno.test("removeAt clamps active to new tail instead of wrapping (B9)", () => {
	const c = createAbc();
	c.setActiveLast();
	assertEquals(c.active, { id: "c" });

	// Remove the active (last) item — should clamp to new last, not wrap to 0.
	c.removeAt(c.activeIndex!);
	assertEquals(c.active, { id: "b" });
	assertEquals(c.activeIndex, 1);
});

Deno.test("findAllIndexesBy returns a defensive copy (B10)", () => {
	const c = createAbc({ unique: false });
	c.add({ id: "a" });
	const idx = c.findAllIndexesBy("id", "a");
	assertEquals(idx, [0, 3]);
	idx.pop(); // mutate the returned array
	// internal index must be unaffected
	assertEquals(c.findAllIndexesBy("id", "a"), [0, 3]);
});

Deno.test("sort() returns false when no sortFn configured (B11)", () => {
	const c = createAbc();
	assertEquals(c.sort(), false);
	// passing an explicit sortFn works
	assert(c.sort((a, b) => b.id.localeCompare(a.id)));
	assertEquals(c.items.map((x) => x.id), ["c", "b", "a"]);
});

Deno.test("sort preserves tags and active item by id", () => {
	const c = createAbc();
	c.applyTag(c.at(0), "foo"); // tag 'a' at index 0
	c.setActive(c.at(0)); // 'a' is active

	c.sort((a, b) => b.id.localeCompare(a.id));
	assertEquals(c.items.map((x) => x.id), ["c", "b", "a"]);
	// 'a' is now at index 2
	assertEquals(c.getIndexesByTag("foo"), [2]);
	assertEquals(c.active, { id: "a" });
	assertEquals(c.activeIndex, 2);
});

Deno.test("configure can unset sortFn via null (B12)", () => {
	const c = createAbc({ sortFn: (a, b) => b.id.localeCompare(a.id) });
	c.add({ id: "x" });
	assertEquals(c.items[0], { id: "x" });

	c.configure({ sortFn: null as any });
	c.add({ id: "y" });
	// no more sortFn → plain append
	assertEquals(c.items.at(-1), { id: "y" });
});

Deno.test("search publishes only when lastQuery changes (B14)", () => {
	const c = new ItemCollection(
		[{ id: "a", _s: "hello" }, { id: "b", _s: "world" }],
		{ searchable: { getContent: (i: any) => i._s } },
	);
	const p = countPublishes(c);

	c.search("he");
	const afterFirst = p.count();
	assert(afterFirst >= 1);

	// Repeating the same query should NOT re-publish.
	c.search("he");
	assertEquals(p.count(), afterFirst);

	p.unsubscribe();
});

Deno.test("property indexes survive remove/sort (D4, D5, I2)", () => {
	const c = new ItemCollection<{ id: string; tag: string }>([
		{ id: "a", tag: "x" },
		{ id: "b", tag: "y" },
		{ id: "c", tag: "x" },
		{ id: "d", tag: "y" },
	]);
	// warm the custom-property index
	assertEquals(c.findAllBy("tag", "x").map((i) => i.id), ["a", "c"]);

	c.remove(c.findById("a"));
	// After remove, "tag" index should still work (previously was dropped).
	assertEquals(c.findAllBy("tag", "x").map((i) => i.id), ["c"]);

	c.sort((a, b) => b.id.localeCompare(a.id));
	assertEquals(c.findAllBy("tag", "y").map((i) => i.id), ["d", "b"]);

	c.move(0, 2);
	// Index should still be coherent after a move.
	const ys = c.findAllBy("tag", "y").map((i) => i.id).toSorted();
	assertEquals(ys, ["b", "d"]);
});

Deno.test("config is a frozen snapshot (I7)", () => {
	const c = createAbc({ tags: { foo: { cardinality: 2 } } });
	const cfg = c.config;
	assertThrows(() => {
		(cfg as any).cardinality = 1;
	});
	assertThrows(() => {
		(cfg.tags.foo as any).cardinality = 999;
	});
	// internal state untouched
	assertEquals(c.config.cardinality, Infinity);
	assertEquals(c.config.tags.foo.cardinality, 2);
});

Deno.test("batch coalesces multiple mutations into one publish (I3)", () => {
	const c = createAbc();
	const p = countPublishes(c);

	c.batch(() => {
		c.add({ id: "x" });
		c.applyTag(c.findById("x"), "foo");
		c.setActive(c.findById("x"));
	});
	assertEquals(p.count(), 1);
	assertEquals(c.size, 4);
	assertEquals(c.active, { id: "x" });
	assertEquals(c.getByTag("foo"), [{ id: "x" }]);

	// Empty batch → no publish.
	const before = p.count();
	c.batch(() => {});
	assertEquals(p.count(), before);

	// Throwing batch still flushes pending publishes that happened before throw.
	try {
		c.batch(() => {
			c.add({ id: "y" });
			throw new Error("boom");
		});
	} catch { /* swallow */ }
	assertEquals(p.count(), before + 1);
	assertEquals(c.size, 5);

	p.unsubscribe();
});

Deno.test("applyTagByIndexes iterates all; does not short-circuit (D2)", () => {
	const c = createAbc();
	// Valid indexes 0,1; 999 is invalid. Previously: stopped at 999 before
	// applying to 1. Now: 1 still gets tagged, and the return is false because
	// not ALL succeeded.
	const ok = c.applyTagByIndexes([0, 999, 1], "foo");
	assertEquals(ok, false);
	assertEquals(c.getIndexesByTag("foo").toSorted(), [0, 1]);
});

Deno.test("clear purges searchable index", () => {
	const c = new ItemCollection<{ id: string; _s: string }>(
		[
			{ id: "a", _s: "alpha" },
			{ id: "b", _s: "beta" },
		],
		{ searchable: { getContent: (i) => i._s } },
	);
	assertEquals(c.search("al").length, 1);
	c.clear();
	// After clear, a stale doc id must not be returned.
	assertEquals(c.search("al"), []);
	c.add({ id: "c", _s: "charlie" });
	assertEquals(c.search("char").length, 1);
	assertEquals(c.search("al"), []); // old 'alpha' doc id is gone
});
