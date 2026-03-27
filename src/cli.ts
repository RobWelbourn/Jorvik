/**
 * @module cli
 * Functions for creating a CLI from a TypeBox schema.  Standard options for help, version and
 * config file names are included, and additional options are created from the 'title' and 'description' 
 * metadata in the schema.  The CLI is displayed with aligned columns and color formatting.
 */
import * as path from 'node:path';
import { createRequire } from 'node:module';
import process from 'node:process';
import type * as typebox from 'typebox';
import { type Result, failure, success } from './result.ts';
import type { TConfig } from './configmgr.ts';
import { type ParseOptions, parseArgs } from './parseargs.ts';

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
 * Traverses the provided TypeBox schema and compiles CLI help text and parsing options
 * based on the schema's properties and their descriptions.  The schema is expected to be
 * a top-level object schema whose property names become the CLI flag prefixes
 * (e.g. a property `service` produces options such as `--service.enabled`).
 * @param schema The top-level schema.
 * @returns The compiled CLI data.
 */
export function compileSection(schema: typebox.TSchema): CliData {
    const lines: Line[] = [];
    const parseOptions = {
        collect: [] as string[],
    };

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
                    parseOptions.collect.push(subsection);
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
    return { lines, parseOptions };
}

/**
 * Gets standard options for the CLI, including help, version and config file names.
 * @returns The compiled CLI data.
 */
export function getStandardOptions(): CliData {
    const parseOptions: ParseOptions = {
        collect: ['config'],
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
    const parseOptions = {
        collect: [] as string[],
        alias: {} as Record<string, string>,
    };

    for (const cliSection of cliSections) {
        lines.push(...cliSection.lines);
        if (cliSection.parseOptions) {
            if (cliSection.parseOptions.alias) {
                Object.assign(parseOptions.alias, cliSection.parseOptions.alias);
            }
            if (cliSection.parseOptions.collect) {
                parseOptions.collect.push(...cliSection.parseOptions.collect);
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
    const args = parseArgs(process.argv.slice(2), cliData.parseOptions);

    // Remove standard options from the args object, leaving only those from the config schema. 
    const { _, help, version, config, ...configArgs } = args;

    if (version) {
        displayVersion();
        process.exit(0);
    }

    if (help) {
        displayHelp(cliData.lines);
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