/**
 * @module parseargs
 * Provides a simple command line parser that complements the config file system.  It behaves similarly to the
 * Deno command line parser, but with a more limited set of features, given that TypeBox schemas are used to 
 * define the expected types of flags and arguments.
 * 
 * The parser interprets command-line arguments as follows:
 * - Flag names are proceeded by a double dash,  e.g. `--help`.
 * - Short-form aliases for flags, e.g. `-h` for `--help`, can be defined in the `alias` option.
 * - Flag names prefaced by a single dash that are not defined as aliases will be treated as a group of 
 *   single-character flags, e.g. `-abc` will be treated as `-a -b -c`.
 * - If a flag has a value, it can be specified as `--flag=value` or `--flag value`.  
 * - If the flag is defined as a boolean, it can be specified without a value, e.g. `--flag` is equivalent to 
 *   `--flag=true`.
 * - Values that can be parsed as numbers (including hexadecimal numbers, prefixed with `0x`) will be treated 
 *   as numbers; the TypeBox parser will handle type validation and conversion based on the schema definitions.
 * - Otherwise, values will be treated as strings.
 * - Flags containing periods (e.g. `--foo.bar`) will be parsed as nested objects, e.g. `{ foo: { bar: value } }`.
 * - If a flag is defined in the `collect` option, it can be specified multiple times, and its values will be 
 *   collected into an array, e.g. `--flag value1 --flag value2` will result in `{ flag: ['value1', 'value2'] }`.
 * - If an array flag is specified without a value, it will be treated as an empty array, e.g. `--flag` will 
 *   result in `{ flag: [] }`.
 * - If an array value contains a comma, it will be split into multiple values, e.g. `--flag value1,value2` will 
 *   result in `{ flag: ['value1', 'value2'] }`.
 * - Positional arguments (those that do not start with a dash) will be collected in the `_` property of the 
 *   results object.
 */

import type { TConfig, TConfigElement } from './configmgr.ts';

/** Options for parsing command-line arguments */
export type ParseOptions = {
    /** Short-form aliases of flags */
    alias?: { [key: string]: string };
    /** Flags that can accept multiple values */
    collect?: string[];
};

/** Results of parsing command-line arguments */
export type ParseResults = {
    /** Positional arguments */
    _: TConfigElement[];
    /** Parsed flags */
    [key: string]: TConfigElement;
};

function isObjectLike(value: TConfigElement | undefined): value is TConfig {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function coerceValue(value: string): TConfigElement {
    if (value.length > 0) {
        const parsedNumber = Number(value);
        if (!Number.isNaN(parsedNumber)) {
            return parsedNumber;
        }
    }
    return value;
}

function setNestedValue(target: ParseResults, key: string, value: TConfigElement): void {
    const parts = key.split('.');
    let cursor: TConfig = target;

    for (let i = 0; i < parts.length - 1; i += 1) {
        const part = parts[i];
        const existing = cursor[part];
        if (!isObjectLike(existing)) {
            cursor[part] = {};
        }
        cursor = cursor[part] as TConfig;
    }

    cursor[parts[parts.length - 1]] = value;
}

function getNestedValue(target: ParseResults, key: string): TConfigElement | undefined {
    const parts = key.split('.');
    let cursor: TConfigElement = target;

    for (const part of parts) {
        if (!isObjectLike(cursor)) {
            return undefined;
        }
        cursor = cursor[part];
        if (cursor === undefined) {
            return undefined;
        }
    }

    return cursor;
}

/**
 * Parses command-line arguments into a structured object.
 * @param args The command-line arguments to parse.
 * @param options Optional parsing options.
 * @returns The parsed arguments as a `ParseResults` object.
 */
export function parseArgs(args: string[], options: ParseOptions = {}): ParseResults {
    const results: ParseResults = { _: [] };
    const collectFlags = new Set(options.collect ?? []);
    const aliasByShort = new Map<string, string>();

    for (const [name, shortName] of Object.entries(options.alias ?? {})) {
        aliasByShort.set(shortName, name);
    }

    const applyFlag = (rawName: string, rawValue?: string): void => {
        const name = rawName;
        const isCollect = collectFlags.has(name);

        if (isCollect) {
            const existing = getNestedValue(results, name);
            const values = rawValue === undefined
                ? []
                : rawValue.split(',').map((part) => coerceValue(part));

            if (Array.isArray(existing)) {
                existing.push(...values);
                return;
            }

            setNestedValue(results, name, values);
            return;
        }

        if (rawValue === undefined) {
            setNestedValue(results, name, true);
            return;
        }

        setNestedValue(results, name, coerceValue(rawValue));
    };

    const isFlagToken = (token: string): boolean => token.startsWith('-') && token !== '-';

    for (let i = 0; i < args.length; i += 1) {
        const token = args[i];

        if (token.startsWith('--') && token.length > 2) {
            const longToken = token.slice(2);
            const equalsIndex = longToken.indexOf('=');

            if (equalsIndex >= 0) {
                const name = longToken.slice(0, equalsIndex);
                const value = longToken.slice(equalsIndex + 1);
                applyFlag(name, value);
                continue;
            }

            const name = longToken;
            const nextToken = args[i + 1];
            if (nextToken !== undefined && !isFlagToken(nextToken)) {
                applyFlag(name, nextToken);
                i += 1;
            } else {
                applyFlag(name);
            }
            continue;
        }

        if (token.startsWith('-') && !token.startsWith('--') && token.length > 1) {
            const shortGroup = token.slice(1);

            if (shortGroup.length === 1 && aliasByShort.has(shortGroup)) {
                const canonical = aliasByShort.get(shortGroup)!;
                const nextToken = args[i + 1];
                if (nextToken !== undefined && !isFlagToken(nextToken)) {
                    applyFlag(canonical, nextToken);
                    i += 1;
                } else {
                    applyFlag(canonical);
                }
                continue;
            }

            for (const shortName of shortGroup) {
                const canonical = aliasByShort.get(shortName) ?? shortName;
                applyFlag(canonical);
            }
            continue;
        }

        results._.push(coerceValue(token));
    }

    return results;
}