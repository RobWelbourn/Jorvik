/**
 * @module typeboxhelpers
 * Helper functions for working with TypeBox schemas and values.
 * Note: Requires TypeBox 1.1 or later for the customParse function to work correctly, due to
 * breaking changes in the Parse function.
 */
import type { Static, TSchema } from 'typebox';
import Value, { type ParseError, Pipeline } from 'typebox/value';

const parsePipeline = Pipeline([
    (_context, _schema, value) => Value.Clone(value),
    (context, schema, value) => Value.Default(context, schema, value),
    (context, schema, value) => Value.Convert(context, schema, value),
    // (context, schema, value) => Value.Clean(context, schema, value),
    (context, schema, value) => Value.Parse(context, schema, value),
]);

/**
 * Creates a custom pipeline for the Parse function. The pipeline includes the following steps:
 * 1. Clone: Creates a deep copy of the input value to avoid mutating the original.
 * 2. Default: Applies default values from the schema to the input value.
 * 3. Convert: Converts the input value to match the types defined in the schema.
 * 4. Parse: Validates and parses the input value according to the schema.
 * Most notably, the pipeline omits the Clean step that removes additional properties not defined
 * in the schema, so that they can be caught by the Parse step and reported as errors.
 * @param schema The TypeBox schema.
 * @param value The value to parse.
 * @returns The parsed value.
 * @throws ParseError if the value does not conform to the schema.
 */
export function customParse<S extends TSchema>(schema: S, value: unknown): Static<S> {
    return parsePipeline(schema, value) as Static<S>;
}

/**
 * Formats a ParseError from TypeBox into a readable string.
 * @param section The section of the configuration where the error occurred, if any.
 * @param err The ParseError object.
 * @returns A formatted string representing the error.
 */
export function formatParseError(section: string | undefined, err: ParseError): string {
    // Convert instance paths to dot notation and add square brackets for array indices.
    // Replace empty paths with 'Configuration' for better readability.
    function normalizePath(path: string): string {
        const normalizedPath = path
            .replaceAll('/', '.')
            .replace(/^\./, '') // Remove leading dot if present
            .replaceAll(/\.(\d+)/g, '[$1]'); // Convert .0, .1, etc. to [0], [1], etc.
        return normalizedPath || 'Configuration';
    }

    // console.log('ParseError:', err.cause);
    let errors = err.cause.errors;
    const messages = [];

    // Find all discriminated union errors.
    const unionErrors = errors.filter((e) => e.keyword === 'anyOf');
    for (const unionError of unionErrors) {
        // Group the errors by their instancePath.
        const group = errors.filter((e) => e.instancePath.startsWith(unionError.instancePath));
        const path = normalizePath((section ?? '') + unionError.instancePath);

        // Check for common types of error.  If it's not one of these, we will assume
        // it's an invalid value of the union discriminator, and display the allowed values.
        const additionalPropsErrors = group.filter((e) => e.keyword === 'additionalProperties'); // Extra properties
        const requiredErrors = group.filter((e) => e.keyword === 'required'); // Missing properties
        const typeErrors = group.filter((e) => e.keyword === 'type'); // Type mismatches
        const formatErrors = group.filter((e) => e.keyword === 'format'); // Format errors
        const enumErrors = group.filter((e) => e.keyword === 'enum'); // Invalid enum values
        const minLengthErrors = group.filter((e) => e.keyword === 'minLength'); // String too short
        const maxLengthErrors = group.filter((e) => e.keyword === 'maxLength'); // String too long

        // The order in which we check for types of error is important; additionalProperties errors are
        // the penultimate, because they can mask other errors, and checking for type discriminator errors
        // is the last.
        const message = requiredErrors.length > 0
            ? requiredErrors[0].message
            : typeErrors.length > 0
                ? typeErrors[0].message
                : formatErrors.length > 0
                    ? formatErrors[0].message
                    : enumErrors.length > 0
                        ? enumErrors[0].message + ': '
                            + enumErrors[0].params.allowedValues.join(', ')
                        : minLengthErrors.length > 0
                            ? minLengthErrors[0].message
                            : maxLengthErrors.length > 0
                                ? maxLengthErrors[0].message
                                : additionalPropsErrors.length > 0
                                    ? additionalPropsErrors[0].message + ': '
                                        + additionalPropsErrors[0].params.additionalProperties.join(', ')
                                    : group
                                        .filter((e) => e.keyword === 'const')
                                        .map((e) => e.params.allowedValue ?? '')
                                        .join(', ');
        messages.push(path ? `${path} ${message}` : message);

        // Remove the grouped errors from the main errors array to avoid duplicate messages.
        errors = errors.filter((e) => !group.includes(e));
    }

    // Handle other kinds of error.
    for (const e of errors) {
        const path = normalizePath((section ?? '') + e.instancePath);
        let message = path ? `${path} ${e.message}` : e.message;
        if (e.keyword === 'additionalProperties') {
            message += ': ' + e.params.additionalProperties.join(', ');
        }
        if (e.keyword === 'enum') {
            message += ': ' + e.params.allowedValues.join(', ');
        }
        messages.push(message);
    }
    return messages.join('\n');
}
