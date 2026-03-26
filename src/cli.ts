/**
 * @module cli
 * Functions for creating a CLI from a TypeBox schema.  Standard options for help, version and
 * config file names are included, and additional options are created from the 'title' and 'description' 
 * metadata in the schema.  The CLI is displayed with aligned columns and color formatting.
 * CLI parsing uses the [minimist](https://www.npmjs.com/package/minimist) package.
 */
import * as path from 'node:path';
import { createRequire } from 'node:module';
import process from 'node:process';
// @deno-types="npm:@types/minimist@^1.2.5"
import minimist from 'minimist';
import type * as typebox from 'typebox';
import { type Result, failure, success } from './result.ts';
import type { TConfig } from './configmgr.ts';

const meta = (() => {
    const emptyMeta: {
        name?: string;
        version?: string;
        description?: string;
    } = {};

    // createRequire only supports file:// URLs. Deno can load modules from http(s),
    // so skip package metadata loading in that case and use runtime fallbacks.
    if (!import.meta.url.startsWith('file:')) {
        return emptyMeta;
    }

    try {
        const require = createRequire(import.meta.url);
        return require('../deno.json') as {
            name?: string;
            version?: string;
            description?: string;
        };
    } catch {
        return emptyMeta;
    }
})();

/** Simplified version of TypeBox's TSchema, containing only fields relevant for CLI generation. */
type TSchema = {
    type: 'object' | 'array' | 'string' | 'number' | 'boolean';
    properties?: { [key: string]: TSchema };
    items?: TSchema;
    title?: string;
    description?: string;
    default?: boolean | number | string | object | null;
    enum?: string[];
};

const MAX_COLUMN1_WIDTH = 35; // Max width for the first column in CLI help display

/**
 * Color palette for displaying the CLI help text. Colors are defined as CSS strings that can be applied to
 * console.log statements.  The palette includes colors for different types of text, such as section headers,
 * option names, option values and usage instructions.
 */
export type Palette = {
    /** Default color for regular text (black or light-gray, depending on terminal background) */
    default: string; 
    /** Color for section headers */
    section: string;
    /** Color for option names */
    option: string;
    /** Color for option values */
    value: string;
    /** Color for usage instructions */
    usage: string;
};

const palette: Palette = {
    default: 'display: revert',
    section: 'color: yellow',
    option: 'color: green',
    value: 'color: cyan; font-weight: bold',
    usage: 'color: gray',
};

/** 
 * Gets a copy of the current CLI color palette.
 * @returns The palette.
 */
export function getPalette(): Palette {
    return structuredClone(palette);
}

/**
 * Sets elements of the CLI color palette.
 * @param replacements The palette elements to replace.
 */
export function setPalette(replacements: Partial<Palette>): void {
    Object.assign(palette, replacements);
}

/**
 * Line content and format for CLI help display. Either one or two columns are supported.
 * The format consists of one or more CSS style strings to apply to the line when displayed.
 * There should be one format string for each CSS placeholder (%c) in the line content.
 * @see https://docs.deno.com/examples/color_logging/
 */
export type Line = {
    /** First column */
    column1: string;
    /** Second column (optional) */
    column2?: string;
    /** CSS format strings for the line */
    format?: string | string[];
};

/** Data structure returned by compileCli, containing lines to display and options for parsing CLI arguments. */
export type CliData = {
    /** Array of lines to display. */
    lines: Line[];
    /** Options for parsing CLI arguments. */
    parseOptions?: ParseOptions;
};

/** minimist-compatible subset of CLI ParseOptions. */
export type ParseOptions = {
    /** Array of boolean options */
    boolean?: string[];
    /** Array of string options */
    string?: string[];
    /** Options with default values */
    default?: { [key: string]: string | number | boolean };
    /** Option aliases */
    alias?: { [key: string]: string };
};

/**
 * Utility function to get the short form of the program entry point.
 * @returns The module name.
 */
function getProgramName() {
    return path.basename(process.argv[1] ?? 'app.js');
}

/**
 * @ignore
 * Detects whether code is running under Deno or Node.js.
 * @returns 'deno' when Deno globals are present, otherwise 'node'.
 */
export function getRuntimeEnvironment(): 'deno' | 'node' {
    return typeof globalThis.Deno !== 'undefined' ? 'deno' : 'node';
}

/**
 * Use minimist to parse CLI arguments.
 * @param argv Command line arguments.
 * @param parseOptions Options for parsing CLI arguments.
 * @returns 
 */
function parseCliArgs(argv: string[], parseOptions?: ParseOptions): Record<string, unknown> {
    const parsed = minimist(argv, parseOptions);

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { _: _positional, '--': _doubleDash, ...result } = parsed as Record<string, unknown> & { _: unknown[]; '--'?: unknown[] };

    // minimist adds both canonical and alias keys; remove the alias short-names so that
    // only canonical names are returned (mirrors the behaviour of node:util parseArgs).
    for (const shortName of Object.values(parseOptions?.alias ?? {})) {
        delete result[shortName];
    }

    return result;
}

/**
 * Traverses the provided TypeBox schema and compiles CLI help text and parsing options
 * based on the schema's properties and their descriptions.
 * @param section The section name to prefix CLI options with (e.g. 'status' for --status.enabled).
 * If the section is empty or undefined, options will be top-level (e.g. --enabled).
 * @param schema The schema.
 * @returns The compiled CLI data.
 */
export function compileSection(section: string | undefined, schema: typebox.TSchema): CliData {
    const lines: Line[] = [];

    // Helper function to add a CLI option line for a schema property that has a description.
    function annotateOption(option: string, prop: TSchema) {
        // If this is a section description, add it and return.
        if (prop.type === 'object' && prop.description) {
            lines.push({ column1: prop.description });
            return;
        }

        const column1 = `  %c--${option}`;
        const format = [palette.option, palette.default];
        let suffix = '';

        // Must check for false value of prop.default, to distinguish from absence of a value
        if (prop.default || prop.default === false || prop.enum) {
            suffix = '(';

            if (prop.enum) {
                suffix += 'options: %c';
                suffix += prop.enum.join(' ');
                suffix += '%c';
                format.push(palette.value, palette.default);
            }

            if (prop.default || prop.default === false) {
                suffix += prop.enum ? '; default: %c' : 'default: %c';
                suffix += `${prop.default}%c`;
                format.push(palette.value, palette.default);
            }

            suffix += ')';
        }

        const column2 = `%c${prop.description} ${suffix}`;
        lines.push({ column1, column2, format });
    }

    // Helper function that recursively traverses the schema,
    // looking for properties with descriptions.
    function traverseSchema(section: string | undefined, schema: TSchema) {
        if (schema.properties) {
            for (const [key, prop] of Object.entries(schema.properties)) {
                if (prop.title) {
                    lines.push({
                        column1: '\n%c' + prop.title,
                        format: [palette.section],
                    });
                }

                const nextSection = section ? `${section}.${key}` : key;
                if (prop.items) { // 'items' indicates an array
                    if (prop.items.description) {
                        annotateOption(nextSection, prop.items);
                    }
                    traverseSchema(nextSection, prop.items);
                } else {
                    if (prop.description) {
                        annotateOption(nextSection, prop);
                    }
                    traverseSchema(nextSection, prop);
                }
            }
        }
    }

    traverseSchema(section, schema as unknown as TSchema); // Coerce to our simplified TSchema type
    return { lines };
}

/**
 * Gets standard options for the CLI, including help, version and config file names.
 * @returns The compiled CLI data.
 */
export function getStandardOptions(): CliData {
    const parseOptions: ParseOptions = {
        boolean: ['help', 'version'],
        string: ['config', 'c'],
        default: {},
        alias: { help: 'h', version: 'v', config: 'c' },
    };

    const lines = [
        {
            column1: '\n%cStandard options',
            format: [palette.section],
        },
        {
            column1: '  %c--version, -v',
            column2: '%cDisplay version and exit',
            format: [palette.option, palette.default],
        },
        {
            column1: '  %c--help, -h',
            column2: '%cDisplay this help message and exit',
            format: [palette.option, palette.default],
        },
        {
            column1: '  %c--config, -c',
            column2: '%cConfig file(s) (default: %c./config/default.json5%c, %c./config/local.json5%c)',
            format: [
                palette.option, palette.default,
                palette.value, palette.default,
                palette.value, palette.default,
            ],
        },
    ];

    return { lines, parseOptions };
}

/**
 * Creates the CLI introductory section.
 * @param intro Brief description of what the app does.  If omitted, will be taken from the
 * "description" field in deno.json, or else the "name" field, else the program name.
 * @param usage E.g. 'deno foo.ts [OPTIONS]'. If omitted, will be constructed from the program name.
 * @returns Compiled CLI data.
 */
export function createIntro(intro?: string, usage?: string): CliData {
    const runtimeCommand = getRuntimeEnvironment() === 'deno' ? 'deno' : 'node';
    const lines = [
        {
            column1: intro 
                ? intro 
                : meta.description 
                    ? meta.description 
                    : meta.name 
                        ? meta.name 
                        : getProgramName(),
        },
        {
            column1: usage 
                ? `\n%cUsage: %c${usage}` 
                : `\n%cUsage: %c${runtimeCommand} ${getProgramName()} [OPTIONS]`,
            format: [palette.usage, palette.default],
        },
    ];
    return { lines };
}

/**
 * Combines sections of the CLI into one piece, suitable for parsing and display.
 * @param cliSections An array of CLI sections.
 * @returns The compiled CLI data.
 */
export function combineSections(cliSections: CliData[]): CliData {
    const lines: Line[] = [];
    const parseOptions: ParseOptions = {
        boolean: [],
        string: [],
        default: {},
        alias: {},
    };

    for (const cliSection of cliSections) {
        lines.push(...cliSection.lines);
        if (cliSection.parseOptions) {
            if (cliSection.parseOptions.boolean) {
                parseOptions.boolean?.push(...cliSection.parseOptions.boolean);
            }
            if (cliSection.parseOptions.string) {
                parseOptions.string?.push(...cliSection.parseOptions.string);
            }
            if (cliSection.parseOptions.default && parseOptions.default) {
                Object.assign(parseOptions.default, cliSection.parseOptions.default);
            }
            if (cliSection.parseOptions.alias && parseOptions.alias) {
                Object.assign(parseOptions.alias, cliSection.parseOptions.alias);
            }
        }
    }

    return { lines, parseOptions };
}

/**
 * Display help text for CLI usage, aligning columns and applying formatting.
 * @param lines Columns to display, with optional formatting instructions.
 */
export function displayHelp(lines: Line[]): void {
    // For multi-column lines, calculate max width of column 1 and pad it for alignment
    const multiColumn = lines.filter((line) => line.column2 !== undefined);
    let maxColumn1Width = Math.max(...multiColumn.map((line) => line.column1.length));
    if (maxColumn1Width > MAX_COLUMN1_WIDTH) {
        maxColumn1Width = MAX_COLUMN1_WIDTH;
    }

    for (const line of lines) {
        const theLine = line.column2 
            ? line.column1.padEnd(maxColumn1Width + 2) + line.column2 
            : line.column1;
        if (line.format) {
            if (Array.isArray(line.format)) {
                console.log(theLine, ...line.format);
            } else {
                console.log(theLine, line.format);
            }
        } else {
            console.log(theLine);
        }
    }
}

/**
 * Display the program version, which is taken from the deno.json file.
 */
export function displayVersion(): void {
    console.log(
        meta.name ? meta.name : getProgramName(),
        meta.version ?? 'version unknown',
    );
}

/**
 * Utility function to remove properties with undefined values or zero-length arrays from a config object,
 * including nested objects. This is used to clean up the additional config options obtained from the CLI,
 * so that they can be merged with the main configuration without introducing empty values.
 * @param obj The input config object.
 * @returns A new config object with empty properties removed, or undefined if all properties are empty.
 */
function removeEmptyProperties(obj: TConfig): TConfig | undefined {
    const newObj: TConfig = {};
    for (const [key, value] of Object.entries(obj)) {
        if (value === undefined) {
            continue;
        }
        if (Array.isArray(value)) {
            if (value.length > 0) {
                newObj[key] = value;
            }
            continue;
        }
        if (typeof value === 'object' && value !== null) {
            const nested = removeEmptyProperties(value);
            if (nested !== undefined) {
                newObj[key] = nested;
            }
        } else {
            newObj[key] = value;
        }
    }
    return Object.keys(newObj).length === 0 ? undefined : newObj;
}

/**
 * Processes CLI commands, looking for standard options (help, version, config file names) and
 * additional config options from the command line, If help or version is requested, displays the
 * appropriate information and exits. Otherwise, returns any config files specified and additional
 * config options obtained from the CLI.
 * @param cliData CLI data containing help text and parsing options.
 * @returns A Result object containing the config files and additional config options, or a string
 * indicating an error.
 */
export function processCommands(cliData: CliData): Result<{
    configFiles: string[];
    additionalConfig: TConfig | undefined;
}, string> {
    const args = parseCliArgs(process.argv.slice(2), cliData.parseOptions);

    // Remove standard options from the args object, leaving only those from the config schema. 
    const { help, version, config, ...configArgs } = args;

    if (version) {
        displayVersion();
        process.exit(0);
    }

    if (help) {
        displayHelp(cliData.lines);
        process.exit(0);
    }

    const rawConfig = config;
    let configFiles: string[] = [];

    if (Array.isArray(rawConfig)) {
        if (rawConfig.some((item) => typeof item !== 'string')) {
            return failure('Config filenames must be strings');
        }
        configFiles = rawConfig;
    } else if (typeof rawConfig === 'string') {
        configFiles = [rawConfig];
    } else if (rawConfig !== undefined) {
        return failure('Config filenames must be strings');
    }

    // Look for any supplemental configuration options from the CLI. Remove any options with
    // undefined values or zero-length arrays. Pass back any config files along with the
    // supplemental config.
    const additionalConfig = removeEmptyProperties(configArgs as TConfig);
    return success({ configFiles, additionalConfig });
}