# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Jorvik is a configuration management library for TypeScript applications (Deno and Node.js) that:
- Validates configurations using TypeBox schemas
- Automatically generates CLIs from schema definitions
- Supports JSON5 configuration files with environment variable substitution
- Uses a Result type pattern for error handling instead of exceptions

## Development Commands

**Run tests:**
```bash
cd tests && deno test -A
```

**Run a single test file:**
```bash
cd tests && deno test -A cli.test.ts
```

**Format code:**
```bash
deno fmt
```

**Dev mode (watch):**
```bash
deno task dev
```

## Architecture

### Core Modules

The library consists of four main exported modules (defined in `deno.json` exports):

1. **configmgr** (`src/configmgr.ts`)
   - `ConfigManager` class for loading and merging JSON5 configuration files
   - Looks for config files in `./config` directory (default files: `default.json5`, `local.json5`)
   - Deep merges multiple config files (arrays are replaced, not concatenated)
   - Replaces environment variable placeholders (`$VARNAME`) with actual values
   - Validates merged config against TypeBox schema
   - Supports custom `Replacer` implementations for secret management (e.g., cloud secret managers)

2. **cli** (`src/cli.ts`)
   - `Cli` class that generates command-line interfaces from TypeBox schemas
   - Automatically creates help text from schema `title` and `description` metadata
   - Standard options: `--help/-h`, `--version/-v`, `--config/-c`
   - Additional options derived from schema properties
   - Supports positional parameters with optional schema validation
   - Uses `CliRuntime` abstraction for testability (process.argv, console.log, process.exit)

3. **result** (`src/result.ts`)
   - `Result<T, E>` type: discriminated union of `Success<T>` or `Failure<E>`
   - `success(value)` and `failure(error)` helper functions
   - Used throughout the codebase instead of throwing exceptions

4. **typeboxhelpers** (`src/typeboxhelpers.ts`)
   - `customParse()`: Custom TypeBox validation pipeline
   - Pipeline steps: Clone → Default → Convert → Parse (notably excludes Clean step)
   - Omitting Clean allows validation errors for additional properties not in schema
   - `formatParseError()`: Formats TypeBox ParseErrors into readable messages with dot notation paths

### CLI Submodules

The CLI system is organized into specialized modules under `src/cli/`:

- **parseargs.ts** - Command-line argument parsing with support for aliases and array collection
- **positional.ts** - Parsing and validation of positional (non-flag) parameters
- **help.ts** - Help text compilation and formatting with color palette support
- **metadata.ts** - Extracts app name and version from `deno.json` or `package.json`

### Configuration Flow

1. Create `ConfigManager` with TypeBox schema and optional config file names
2. Optionally add supplemental configs with `addConfig()` (e.g., from CLI args)
3. Call `load()` which:
   - Finds config files (current dir or `./config`)
   - Parses JSON5 content
   - Deep merges all configs
   - Replaces `$VARNAME` placeholders with environment values
   - Validates against schema
   - Returns `Result<ValidatedConfig, string>`

### CLI Generation Flow

1. Create `Cli` instance with TypeBox schema and optional `HelpOptions`
2. Call `processCommands()` which:
   - Parses command-line arguments
   - Handles `--help` and `--version` (exits process)
   - Extracts config file names from `--config/-c` flags
   - Returns additional config options from CLI flags
3. Use `getPositionalParams()` to retrieve and optionally validate positional arguments
4. Pass CLI results to `ConfigManager` for final configuration assembly

### Result Type Pattern

All fallible operations return `Result<T, E>` instead of throwing:
```typescript
const result = await configManager.load();
if (result.success) {
  const config = result.value; // Type: Static<Schema>
} else {
  console.error(result.error); // Type: string
}
```

## Code Style

Per `deno.json` formatting rules:
- 4 spaces indentation
- 120 character line width
- Single quotes
- No tabs

## Testing

- Tests are in `tests/` directory with parallel structure to `src/`
- Test files use `.test.ts` suffix
- Run from `tests/` directory with `-A` flag for full permissions
- `tests/helpers.ts` contains shared test utilities
- `tests/config/` contains fixture configuration files for testing
