# Changelog

## 0.3.0 - 2026-03-24
### Changed
- Refactored codebase to run under Node.js.
- Changed ConfigManager constructor to accept a ConfigOptions object; environment variable Replacer
becomes an option within the ConfigOptions object.

## 0.2.0 - 2026-03-23
### Changed
- Refactored ConfigManager so that the constructor accepts a TypeBox schema, an optional list 
of config files, and an optional environment variable replacer.
- Modified `load()` method to return a `Result` containing the validated config if success, 
or an array of strings describing errors if failure.

### Removed
- Removed `getConfig()` and `getValidatedConfig()` -- use `load()` instead.
- Removed `hasErrors()` and `getErrors()` -- returned in `Result` from `load()` instead.

## 0.1.0 - 2026-03-18
- Initial release.