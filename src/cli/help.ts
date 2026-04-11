/**
 * @module cli/help
 * Functions for generating CLI help text from a TypeBox schema, including formatting
 * and alignment of options, usage, and positional parameters.
 */
import type * as typebox from 'typebox';
import { getAppMetadata, getProgramName, getRuntimeEnvironment } from './metadata.ts';

/** Simplified version of TypeBox's TSchema, containing only fields relevant for CLI help generation. */
export type HelpSchemaNode = {
    type: 'object' | 'array' | 'string' | 'number' | 'boolean';
    properties?: { [key: string]: HelpSchemaNode };
    required?: string[];
    items?: HelpSchemaNode;
    title?: string;
    description?: string;
    default?: boolean | number | string | object | null;
    enum?: string[];
};

/** Represents a line in the CLI help output. */
export type Line = {
    /** First or only column */
    column1: string;
    /** Optional second column */
    column2?: string;
    /** Optional single or multiple CSS format strings */
    format?: string | string[];
};

/** Color palette for the console output, using CSS strings. */
export type Palette = {
    /** Resets to the default console color */
    default: string;
    /** Section header -- defaults to yellow */
    section: string;
    /** Option flags -- defaults to green */
    option: string;
    /** Values for options -- defaults to cyan */
    value: string;
    /** Usage prefix -- defaults to grey */
    usage: string;
};

/** Options for compiling the help text. */
export type HelpOptions = {
    /** Introductory line of text displayed at the top of the help output. */
    intro?: string;
    /** Usage line, e.g. `deno foo.ts [OPTIONS]`. */
    usage?: string;
    /** Schema for positional (non-flag) parameters. */
    positionalSchema?: typebox.TSchema;
};

export type OrderedPositionalParam = {
    key: string;
    prop: HelpSchemaNode;
    isRequired: boolean;
    isArray: boolean;
    isLast: boolean;
};

/**
 * Get the positional parameters from a TypeBox schema in the order they should appear
 * on the command line, respecting required vs optional parameters and array types.
 * @param schema The TypeBox schema.
 * @returns An array of the parameters.
 */
export function getOrderedPositionalParams(schema: HelpSchemaNode): OrderedPositionalParam[] {
    if (!schema.properties) {
        return [];
    }

    const propertyKeys = Object.keys(schema.properties);
    const requiredSet = new Set(schema.required ?? propertyKeys);
    const orderedKeys = [
        ...propertyKeys.filter((key) => requiredSet.has(key)),
        ...propertyKeys.filter((key) => !requiredSet.has(key)),
    ];

    return orderedKeys.map((key, index) => ({
        key,
        prop: schema.properties![key],
        isRequired: requiredSet.has(key),
        isArray: schema.properties![key].items !== undefined,
        isLast: index === orderedKeys.length - 1,
    }));
}

/**
 * Creates parenthesized suffixes for enum and default values.
 * @param prop The property
 * @param palette The current palette
 * @returns The suffix string
 */
function buildHelpValueSuffix(prop: HelpSchemaNode, palette: Palette): { suffix: string; format: string[] } {
    const format: string[] = [palette.default];
    let suffix = '';

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

    return { suffix, format };
}
/**
 * Compiles the help text for the CLI options.
 * @param schema The TypeBox schema for the options.
 * @param palette The current palette
 * @returns The array of help lines
 */
function compileOptionsHelp(schema: typebox.TSchema, palette: Palette): Line[] {
    const lines: Line[] = [];

    function annotateOption(option: string, prop: HelpSchemaNode) {
        if (prop.type === 'object' && prop.description) {
            lines.push({ column1: prop.description });
            return;
        }

        const column1 = `  %c--${option}`;
        const format = [palette.option, palette.default];
        const { suffix, format: valueFormat } = buildHelpValueSuffix(prop, palette);
        format.push(...valueFormat.slice(1));

        const column2 = `%c${prop.description} ${suffix}`;
        lines.push({ column1, column2, format });
    }

    function traverseSchema(section: string | undefined, node: HelpSchemaNode) {
        if (node.properties) {
            for (const [key, prop] of Object.entries(node.properties)) {
                if (prop.title) {
                    lines.push({
                        column1: '\n%c' + prop.title,
                        format: [palette.section],
                    });
                }

                const subsection = section ? `${section}.${key}` : key;
                if (prop.items) {
                    if (prop.items.description) {
                        annotateOption(subsection, prop.items);
                    } else if (prop.description) {
                        annotateOption(subsection, prop);
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

    const simplifiedSchema = schema as unknown as HelpSchemaNode;
    if (simplifiedSchema.title) {
        lines.push({
            column1: '\n%c' + simplifiedSchema.title,
            format: [palette.section],
        });
    }
    if (simplifiedSchema.description) {
        lines.push({ column1: simplifiedSchema.description });
    }

    traverseSchema(undefined, simplifiedSchema);
    return lines;
}

/**
 * Compiles the help section for positional parameters.
 * @param schema The positional parameter schema
 * @param palette The current palette
 * @returns The array of help lines
 */
function compilePositionalHelp(schema: typebox.TSchema | undefined, palette: Palette): Line[] {
    if (!schema) {
        return [];
    }

    const positional = schema as unknown as HelpSchemaNode;
    if (positional.type !== 'object' || !positional.properties) {
        return [];
    }

    const sectionTitle = positional.title ?? 'Positional parameters';
    const lines: Line[] = [
        {
            column1: `\n%c${sectionTitle}`,
            format: [palette.section],
        },
    ];

    if (positional.description) {
        lines.push({ column1: positional.description });
    }

    for (const [key, prop] of Object.entries(positional.properties)) {
        const label = prop.items ? `${key}...` : key;
        const { suffix, format: valueFormat } = buildHelpValueSuffix(prop, palette);
        const column2Body = prop.description ?? '';
        const spacer = column2Body && suffix ? ' ' : '';
        lines.push({
            column1: `  %c${label}`,
            column2: `%c${column2Body}${spacer}${suffix}`,
            format: [palette.option, ...valueFormat],
        });
    }

    return lines;
}

/**
 * Create the standard options section of the help text, including --version,
 * --help, and --config.
 * @param palette The current palette
 * @returns The array of help lines
 */
function getStandardOptions(palette: Palette): Line[] {
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
 * Builds the string representing the positional parameters for the usage line.
 * @param schema The positional parameter schema
 * @returns The parameter string
 */
function buildPositionalParamsString(schema: typebox.TSchema | undefined): string {
    if (!schema) {
        return '';
    }

    const positional = schema as unknown as HelpSchemaNode;
    if (positional.type !== 'object' || !positional.properties) {
        return '';
    }

    const orderedParams = getOrderedPositionalParams(positional);
    const parts: string[] = [];
    for (const param of orderedParams) {
        const suffix = param.isArray ? '...' : '';
        const label = `${param.key}${suffix}`;
        parts.push(param.isRequired ? label : `[${label}]`);
    }

    return parts.join(' ');
}

/**
 * Creates the introductory section of the help text, including the intro
 * message and usage line.
 * @param options Intro and usage options
 * @param palette The current palette
 * @returns The array of help lines
 */
function createIntro(options: HelpOptions, palette: Palette): Line[] {
    const { intro, usage } = options;
    const runtimeCommand = getRuntimeEnvironment() === 'deno' ? 'deno' : 'node';
    const appMeta = getAppMetadata();

    let usageLine: string;
    if (usage) {
        usageLine = usage;
    } else {
        const positionalSuffix = buildPositionalParamsString(options.positionalSchema);
        const positionalPart = positionalSuffix ? ` ${positionalSuffix}` : '';
        usageLine = `${runtimeCommand} ${getProgramName()} [OPTIONS]${positionalPart}`;
    }

    return [
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
            column1: `\n%cUsage: %c${usageLine}`,
            format: [palette.usage, palette.default],
        },
    ];
}

/**
 * Compliles the help text, comprised of the intro, usage, positional parameters,
 * standard options, and schema-defined options.
 * @param schema The configuration schema
 * @param options Intro and usage options, and positional parameter schema
 * @param palette The current palette
 * @returns The array of help lines
 */
export function compileHelp(
    schema: typebox.TSchema,
    options: HelpOptions,
    palette: Palette,
): Line[] {
    return [
        ...createIntro(options, palette),
        ...compilePositionalHelp(options.positionalSchema, palette),
        ...getStandardOptions(palette),
        ...compileOptionsHelp(schema, palette),
    ];
}
