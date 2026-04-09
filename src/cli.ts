/**
 * @module cli
 * Functions for creating a CLI from a TypeBox schema.  Standard options for help, version and
 * config file names are included, and additional options are created from the 'title' and 'description'
 * metadata in the schema.  The CLI is displayed with aligned columns and color formatting.
 */
import process from 'node:process';
import type * as typebox from 'typebox';
import { getAppMetadata, getProgramName } from './climetadata.ts';
import {
    compileHelp,
    type HelpOptions as HelpBuilderOptions,
    type HelpSchemaNode,
    type Line,
    type Palette,
} from './clihelp.ts';
import { type Result, failure, success } from './result.ts';
import type { TConfig, TConfigElement } from './configmgr.ts';
import { type ParseOptions, type ParseResults, parseArgs } from './parseargs.ts';
import { parsePositionalParams } from './clipositional.ts';

export { getRuntimeEnvironment } from './climetadata.ts';
export type { Palette };

/** Simplified version of TypeBox's TSchema, containing only fields relevant for CLI generation. */
type SchemaNode = HelpSchemaNode;

const MAX_COLUMN1_WIDTH = 35; // Max width for the first column in CLI help display

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

/** Optional settings for composing the introductory help section. */
export type HelpOptions<PositionalSchema extends typebox.TSchema | undefined = undefined> = {
    /** Brief description of what the app does. */
    intro?: string;
    /** Usage line, e.g. `deno foo.ts [OPTIONS]`. */
    usage?: string;
    /** Schema for positional (non-flag) parameters. */
    positionalSchema?: PositionalSchema;
};

type PositionalParamsValue<PositionalSchema extends typebox.TSchema | undefined> =
    PositionalSchema extends typebox.TSchema
        ? typebox.Static<PositionalSchema>
        : TConfigElement[];

export type CliRuntime = {
    getArgv: () => string[];
    log: (...args: unknown[]) => void;
    exit: (code?: number) => never | void;
};

const defaultCliRuntime: CliRuntime = {
    getArgv: () => process.argv,
    log: (...args: unknown[]) => {
        console.log(...args);
    },
    exit: (code?: number) => process.exit(code),
};

/**
 * Compiles parse options from a schema by identifying array properties (which can accept 
 * multiple values) and adding the standard options for help, version, and config files.
 * @param schema The schema to compile parse options from.
 * @returns The compiled parse options.
 */
function compileParseOptions(schema: typebox.TSchema): ParseOptions {
    const collect: string[] = [];

    // Helper function that recursively traverses the schema to find array properties.
    function traverseSchema(section: string | undefined, schema: SchemaNode): void {
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

    traverseSchema(undefined, schema as unknown as SchemaNode);

    // Merge with standard options
    return {
        collect: [...collect, 'config'],
        alias: { help: 'h', version: 'v', config: 'c' },
    };
}

/**
 * Display help text for CLI usage, aligning columns and applying formatting.
 * @param lines Columns to display, with optional formatting instructions.
 */
function displayHelpLines(lines: Line[], log: (...args: unknown[]) => void): void {
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
                log(theLine, ...line.format);
            } else {
                log(theLine, line.format);
            }
        } else {
            log(theLine);
        }
    }
}

/**
 * Display the program version, which is taken from the deno.json or package.json file.
 */
function displayVersionInfo(log: (...args: unknown[]) => void): void {
    const appMeta = getAppMetadata();
    log(
        appMeta.name ?? getProgramName(),
        appMeta.version ?? '0.0.0',
    );
}

type BuiltinAction =
    | { type: 'none' }
    | { type: 'version' }
    | { type: 'help'; lines: Line[] };

function evaluateBuiltinAction(
    version: unknown,
    help: unknown,
    schema: typebox.TSchema,
    helpOptions: HelpBuilderOptions,
    currentPalette: Palette,
): BuiltinAction {
    if (version) {
        return { type: 'version' };
    }

    if (help) {
        return {
            type: 'help',
            lines: compileHelp(schema, helpOptions, currentPalette),
        };
    }

    return { type: 'none' };
}

function executeBuiltinAction(action: BuiltinAction, runtime: CliRuntime): void {
    if (action.type === 'version') {
        displayVersionInfo(runtime.log);
        runtime.exit(0);
    }

    if (action.type === 'help') {
        displayHelpLines(action.lines, runtime.log);
        runtime.exit(0);
    }
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
export class Cli<PositionalSchema extends typebox.TSchema | undefined = undefined> {
    #schema: typebox.TSchema;
    #helpOptions: HelpOptions<PositionalSchema>;
    #runtime: CliRuntime;
    #parsedArgs: ParseResults | undefined;

    /**
     * Constructor.
     * @param schema The top-level schema for application-specific options.
     * @param options Optional help settings used to build the help display.
     */
    constructor(
        schema: typebox.TSchema,
        options: HelpOptions<PositionalSchema> = {} as HelpOptions<PositionalSchema>,
        runtime: CliRuntime = defaultCliRuntime,
    ) {
        this.#schema = schema;
        this.#helpOptions = options;
        this.#runtime = runtime;
    }

    #getArgs(): ParseResults {
        if (!this.#parsedArgs) {
            const parseOptions = compileParseOptions(this.#schema);
            this.#parsedArgs = parseArgs(this.#runtime.getArgv().slice(2), parseOptions);
        }
        return this.#parsedArgs;
    }

    /**
     * Returns the positional (non-flag) arguments from the CLI.
     * @returns Array of positional parameter values.
     */
    getPositionalParams(): Result<PositionalParamsValue<PositionalSchema>, string> {
        const positionals = this.#getArgs()._;
        const positionalSchema = this.#helpOptions.positionalSchema;
        if (!positionalSchema) {
            return success(positionals as PositionalParamsValue<PositionalSchema>);
        }

        const parsed = parsePositionalParams(positionalSchema, positionals);
        return parsed as Result<PositionalParamsValue<PositionalSchema>, string>;
    }

    /**
     * Processes CLI commands and returns config files and supplemental configuration.
     * @returns Parsed CLI command results.
     */
    processCommands(): Result<{
        configFiles: string[];
        additionalConfig: TConfig | undefined;
    }, string> {
        // Remove standard options from the args object, leaving only those from the config schema.
        const { _: _, help, version, config, ...configArgs } = this.#getArgs();

        const builtinAction = evaluateBuiltinAction(
            version,
            help,
            this.#schema,
            this.#helpOptions,
            palette,
        );
        executeBuiltinAction(builtinAction, this.#runtime);

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