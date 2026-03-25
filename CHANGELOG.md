# Changelog

## 0.3.2 - 2026-03-25
### Changed
- Changed CLI parsing to use the [minimist](https://github.com/minimistjs/minimist) package, to ensure 
common behavior between Node and Deno environments, and to revert to previous behavior under Deno.

## 0.3.1 - 2026-03-24
### Changed
- Fix Deno compatibiity issues.

## 0.3.0 - 2026-03-24
### Changed
- Refactored codebase to run under Node.js.
- Changed `ConfigManager` constructor to accept a `ConfigOptions` object; environment variable Replacer
becomes an option within the ConfigOptions object.
- `load()` now returns a single string for failure `Result`s, with all the errors concatenated
by newline characters.

## 0.2.0 - 2026-03-23
### Changed
- Refactored `ConfigManager` so that the constructor accepts a TypeBox schema, an optional list 
of config files, and an optional environment variable replacer.
- Modified `load()` method to return a `Result` containing the validated config if success, 
or an array of strings describing errors if failure.

### Removed
- Removed `getConfig()` and `getValidatedConfig()` -- use `load()` instead.
- Removed `hasErrors()` and `getErrors()` -- returned in `Result` from `load()` instead.

## 0.1.0 - 2026-03-18
- Initial release.