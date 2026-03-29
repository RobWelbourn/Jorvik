/**
 * @module cli
 * Functions for creating a CLI from a TypeBox schema.  Standard options for help, version and
 * config file names are included, and additional options are created from the 'title' and 'description' 
 * metadata in the schema.  The CLI is displayed with aligned columns and color formatting.
 */
import * as path from 'node:path';
import { readFileSync } from 'node:fs';
import process from 'node:process';
import type * as typebox from 'typebox';
import { type Result, failure, success } from './result.ts';
import type { TConfig, TConfigElement } from './configmgr.ts';
import { type ParseOptions, parseArgs } from './parseargs.ts';

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

/** Optional settings for composing the introductory help section. */
export type HelpOptions = {
    /** Brief description of what the app does. */
    intro?: string;
    /** Usage line, e.g. `deno foo.ts [OPTIONS]`. */
    usage?: string;
    /** Additional help lines to render after usage. */
    more?: Line[];
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

/** App metadata taken from either package.json or Deno's import.meta */
type AppMetadata = {
    name: string;
    version: string;
    description: string;
};

function getAppMetadata(): AppMetadata {
    const runtime = getRuntimeEnvironment();

    if (runtime === 'deno') {
        // In Deno, read from deno.json
        try {
            const denoPath = new URL('deno.json', import.meta.url);
            const denoText = Deno.readTextFileSync(denoPath);
            const denoConfig = JSON.parse(denoText) as {
                name?: string;
                version?: string;
                description?: string;
            };
            return {
                name: denoConfig.name ?? '[app]',
                version: denoConfig.version ?? '0.0.0',
                description: denoConfig.description ?? ''
            };
        } catch {
            return {
                name: '[app]',
                version: '0.0.0',
                description: ''
            };
        }
    } else {
        // In Node.js, read from package.json
        try {
            const moduleDir = path.dirname(new URL(import.meta.url).pathname);
            const pkgPath = path.join(moduleDir, '../package.json');
            const pkgContent = readFileSync(pkgPath, 'utf-8');
            const pkgConfig = JSON.parse(pkgContent) as {
                name?: string;
                version?: string;
                description?: string;
            };
            return {
                name: pkgConfig.name ?? '[app]',
                version: pkgConfig.version ?? '0.0.0',
                description: pkgConfig.description ?? ''
            };
        } catch {
            return {
                name: '[app]',
                version: '0.0.0',
                description: ''
            };
        }
    }
}

/**
 * Compiles parse options from a schema by identifying array properties (which can accept 
 * multiple values) and adding the standard options for help, version, and config files.
 * @param schema The schema to compile parse options from.
 * @returns The compiled parse options.
 */
function compileParseOptions(schema: typebox.TSchema): ParseOptions {
    const collect: string[] = [];

    // Helper function that recursively traverses the schema to find array properties.
    function traverseSchema(section: string | undefined, schema: TSchema): void {
        if (schema.properties) {
            for (const [key, prop] of Object.entries(schema.properties)) {
                const subsection = section ? `${section}.${key}` : key;
                if (prop.items) { // 'items' indicates an array
                    collect.push(subsection);
                    traverseSchema(subsection, prop.items);
                } else {
                    traverseSchema(subsection, prop);
                }
            }
        }
    }

    traverseSchema(undefined, schema as unknown as TSchema);

    // Merge with standard options
    return {
        collect: [...collect, 'config'],
        alias: { help: 'h', version: 'v', config: 'c' },
    };
}

/**
 * Traverses the provided TypeBox schema and compiles CLI help text based on the 
 * schema's properties and their descriptions.  The schema is expected to be
 * a top-level object schema whose property names become the CLI flag prefixes
 * (e.g. a property `service` produces options such as `--service.enabled`).
 * @param schema The top-level schema.
 * @returns The compiled CLI data.
 */
function compileOptionsHelp(schema: typebox.TSchema): Line[] {
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

                const subsection = section ? `${section}.${key}` : key;
                if (prop.items) { // 'items' indicates an array
                    if (prop.items.description) {
                        annotateOption(subsection, prop.items);
                    }
                    traverseSchema(subsection, prop.items);
                } else {
                    if (prop.description) {
                        annotateOption(subsection, prop);
                    }
                    traverseSchema(subsection, prop);
                }
            }
        }
    }

    traverseSchema(undefined, schema as unknown as TSchema); // Coerce to our simplified TSchema type
    return lines;
}

/**
 * Gets standard option help lines for the CLI, including help, version and config file names.
 * @returns Array of help lines for standard options.
 */
function getStandardOptions(): Line[] {
    return [
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
}

/**
 * Creates the CLI introductory section.
 * @param options Optional intro settings.
 * @param options.intro Brief description of what the app does. If omitted, this is taken from
 * the "description" field in deno.json/package.json, or else the "name" field, else the program name.
 * @param options.usage E.g. 'deno foo.ts [OPTIONS]'. If omitted, this is constructed from the program name.
 * @param options.more Additional help lines rendered after usage, separated by a blank line.
 * @returns Compiled CLI data.
 */
function createIntro(options: HelpOptions = {}): Line[] {
    const { intro, usage, more } = options;
    const runtimeCommand = getRuntimeEnvironment() === 'deno' ? 'deno' : 'node';
    const appMeta = getAppMetadata();
    const lines: Line[] = [
        {
            column1: intro 
                ? intro 
                : appMeta.description 
                    ? appMeta.description 
                    : appMeta.name 
                        ? appMeta.name 
                        : getProgramName(),
        },
        {
            column1: usage 
                ? `\n%cUsage: %c${usage}` 
                : `\n%cUsage: %c${runtimeCommand} ${getProgramName()} [OPTIONS]`,
            format: [palette.usage, palette.default],
        },
    ];

    if (more && more.length > 0) {
        lines.push({ column1: '' }, ...more);
    }

    return lines;
}

/**
 * Compiles complete CLI help output by combining intro, standard options, and schema options.
 * @param schema The top-level schema for application-specific options.
 * @param options Optional intro settings.
 * @returns Compiled help lines.
 */
function compileHelp(schema: typebox.TSchema, options: HelpOptions = {}): Line[] {
    return [
        ...createIntro(options),
        ...getStandardOptions(),
        ...compileOptionsHelp(schema),
    ];
}

/**
 * Display help text for CLI usage, aligning columns and applying formatting.
 * @param lines Columns to display, with optional formatting instructions.
 */
function displayHelpLines(lines: Line[]): void {
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
 * Display the program version, which is taken from the deno.json or package.json file.
 */
function displayVersionInfo(): void {
    const appMeta = getAppMetadata();
    console.log(
        appMeta.name ?? getProgramName(),
        appMeta.version ?? '0.0.0',
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
 * CLI that compiles schema-driven help and parse options and exposes runtime commands.
 */
export class Cli {
    #schema: typebox.TSchema;
    #helpOptions: HelpOptions;
    #positionalParams: TConfigElement[] | undefined;

    /**
     * Constructor.
     * @param schema The top-level schema for application-specific options.
     * @param options Optional help settings used to build the help display.
     */
    constructor(schema: typebox.TSchema, options: HelpOptions = {}) {
        this.#schema = schema;
        this.#helpOptions = options;
    }

    /**
     * Returns the positional (non-flag) arguments from the CLI.
     * @returns Array of positional parameter values.
     */
    getPositionalParams(): TConfigElement[] {
        if (!this.#positionalParams) {
            const parseOptions = compileParseOptions(this.#schema);
            const args = parseArgs(process.argv.slice(2), parseOptions);
            this.#positionalParams = args._;
        }
        return this.#positionalParams;
    }

    /**
     * Processes CLI commands and returns config files and supplemental configuration.
     * @returns Parsed CLI command results.
     */
    processCommands(): Result<{
        configFiles: string[];
        additionalConfig: TConfig | undefined;
    }, string> {
        const parseOptions = compileParseOptions(this.#schema);
        const args = parseArgs(process.argv.slice(2), parseOptions);

        // Remove standard options from the args object, leaving only those from the config schema.
        const { _, help, version, config, ...configArgs } = args;
        this.#positionalParams = _;

        if (version) {
            displayVersionInfo();
            process.exit(0);
        }

        if (help) {
            const lines = compileHelp(this.#schema, this.#helpOptions);
            displayHelpLines(lines);
            process.exit(0);
        }

        let configFiles: string[] = [];

        if (Array.isArray(config)) {
            if (config.some((item) => typeof item !== 'string')) {
                return failure('Config filenames must be strings');
            }
            configFiles = config as string[];
        }

        // Look for any supplemental configuration options from the CLI. Remove any options with
        // undefined values or zero-length arrays. Pass back any config files along with the
        // supplemental config.
        const additionalConfig = removeEmptyProperties(configArgs as TConfig);
        return success({ configFiles, additionalConfig });
    }
}