# Claude Code Context

For comprehensive package documentation and context, read:
- [AGENTS.md](./AGENTS.md) - Machine-readable context for AI agents
- [API.md](./API.md) - Complete API documentation
- [README.md](./README.md) - Human-readable overview and examples

## Quick Reference

This is a TypeScript collection manager package with:
- Generic `ItemCollection<T>` class for managing ordered items
- Active item tracking with navigation (next/prev/first/last)
- Flexible tagging system with cardinality limits
- O(1) property lookups via automatic indexing
- Optional full-text search integration
- Reactive subscriptions for change notifications
- Serialization support (dump/restore)

## File Structure

```
src/
  mod.ts              # Public exports
  item-collection.ts  # Main implementation
tests/
  item-collection.test.ts  # Test suite
```

## Development

```bash
deno test              # Run tests
deno task test:watch   # Watch mode
deno task npm:build    # Build npm package
```
