/**
 * @module cli/positional
 * Functions for parsing positional parameters from the command line according to a TypeBox schema.
 */
import type * as typebox from 'typebox';
import { ParseError } from 'typebox/value';
import type { TConfigElement } from '../configmgr.ts';
import { failure, type Result, success } from '../result.ts';
import { getOrderedPositionalParams, type HelpSchemaNode } from './help.ts';
import { customParse, formatParseError } from '../typeboxhelpers.ts';

/** 
 * Parses positional parameters from the command line according to a TypeBox schema.
 * @param schema The TypeBox schema describing the expected positional parameters.
 * @param positionalParams The array of positional parameters from the command line.
 * @returns A Result containing either the parsed parameters or an error string.
 */
export function parsePositionalParams<Schema extends typebox.TSchema>(
    schema: Schema,
    positionalParams: TConfigElement[],
): Result<typebox.Static<Schema>, string> {
    const rawSchema = schema as unknown as HelpSchemaNode;
    if (rawSchema.type !== 'object' || !rawSchema.properties) {
        return failure('positionalSchema must be an object schema');
    }

    const orderedParams = getOrderedPositionalParams(rawSchema);
    const mapped: Record<string, TConfigElement> = {};
    let position = 0;

    for (const param of orderedParams) {
        const key = param.key;
        const prop = param.prop;
        const isRequired = param.isRequired;
        const isLast = param.isLast;
        const isArrayParam = param.isArray;

        if (isArrayParam && !isLast) {
            return failure('Only the last positional parameter may be an array');
        }

        if (isArrayParam) {
            const rest = positionalParams.slice(position);
            if (rest.length > 0 || isRequired) {
                mapped[key] = rest;
            }
            position = positionalParams.length;
            continue;
        }

        if (position < positionalParams.length) {
            mapped[key] = positionalParams[position];
            position += 1;
            continue;
        }

        if (isRequired && prop.default === undefined) {
            return failure(`Missing required parameter: ${key}`);
        }
    }

    if (position < positionalParams.length) {
        return failure('Too many parameters');
    }

    try {
        return success(customParse(schema, mapped));
    } catch (err) {
        if (err instanceof ParseError) {
            return failure(formatParseError(undefined, err));
        }
        return failure(err instanceof Error ? err.message : String(err));
    }
}
