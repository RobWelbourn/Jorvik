import { assertEquals, assertThrows } from '@std/assert';
import { Type } from 'typebox';
import type { ParseError } from 'typebox/value';
import { customParse, formatParseError } from '../src/typeboxhelpers.ts';

type MockParseIssue = {
    instancePath: string;
    keyword: string;
    message: string;
    params: Record<string, unknown>;
};

type MockParseIssueInput = Partial<Omit<MockParseIssue, 'message'>> & Pick<MockParseIssue, 'message'>;

function makeIssue(issue: MockParseIssueInput): MockParseIssue {
    return {
        instancePath: '',
        keyword: 'type',
        params: {},
        ...issue
    };
}

function makeParseError(...issues: MockParseIssueInput[]): ParseError {
    return {
        cause: {
            errors: issues.map(makeIssue)
        }
    } as ParseError;
}

Deno.test('customParse: accepts object when no extra props and additionalProperties=false', () => {
    const schema = Type.Object({ host: Type.String(), port: Type.Number() }, { additionalProperties: false });
    const value = { host: 'localhost', port: 8080 };
    const parsed = customParse(schema, value);
    assertEquals(parsed.host, 'localhost');
    assertEquals(parsed.port, 8080);
});

Deno.test('customParse: rejects additional properties when additionalProperties=false', () => {
    const schema = Type.Object({ host: Type.String(), port: Type.Number() }, { additionalProperties: false });
    const value = { host: 'localhost', port: 8080, extra: true };
    assertThrows(() => {
        customParse(schema, value);
    });
});

Deno.test('formatParseError: formats single error with section and path', () => {
    const err = makeParseError({ instancePath: '/host', message: 'Expected string' });

    const formatted = formatParseError('database', err);
    assertEquals(formatted, 'database.host Expected string');
});

Deno.test('formatParseError: formats multiple errors on separate lines', () => {
    const err = makeParseError(
        { instancePath: '/host', message: 'Expected string' },
        { instancePath: '/port', message: 'Expected number' }
    );

    const formatted = formatParseError('database', err);
    const lines = formatted.split('\n');
    assertEquals(lines.length, 2);
    assertEquals(lines[0], 'database.host Expected string');
    assertEquals(lines[1], 'database.port Expected number');
});

Deno.test('formatParseError: handles empty instancePath', () => {
    const err = makeParseError({ instancePath: '', message: 'Expected object' });

    const formatted = formatParseError('root', err);
    assertEquals(formatted, 'root Expected object');
});

Deno.test('formatParseError: converts nested paths and array indexes', () => {
    const err = makeParseError({ instancePath: '/db/hosts/0/name', message: 'Expected string' });

    const formatted = formatParseError(undefined, err);
    assertEquals(formatted, 'db.hosts[0].name Expected string');
});

Deno.test('formatParseError: strips leading dot in cleaned path', () => {
    const err = makeParseError({ instancePath: '/0', message: 'Expected object' });

    const formatted = formatParseError(undefined, err);
    assertEquals(formatted, '0 Expected object');
});

Deno.test('formatParseError: appends additional properties list', () => {
    const err = makeParseError({
        instancePath: '/database',
        keyword: 'additionalProperties',
        message: 'Unexpected properties',
        params: { additionalProperties: ['extra', 'legacy'] }
    });

    const formatted = formatParseError(undefined, err);
    assertEquals(formatted, 'database Unexpected properties: extra, legacy');
});

Deno.test('formatParseError: appends enum allowed values list', () => {
    const err = makeParseError({
        instancePath: '/logLevel',
        keyword: 'enum',
        message: 'Expected one of',
        params: { allowedValues: ['debug', 'info', 'warn', 'error'] }
    });

    const formatted = formatParseError(undefined, err);
    assertEquals(formatted, 'logLevel Expected one of: debug, info, warn, error');
});

Deno.test('formatParseError: groups union errors and prefers required message', () => {
    const err = makeParseError(
        {
            instancePath: '/backend',
            keyword: 'anyOf',
            message: 'Expected union'
        },
        {
            instancePath: '/backend',
            keyword: 'required',
            message: "Missing required property 'url'",
            params: { requiredProperty: 'url' }
        },
        {
            instancePath: '/backend/type',
            keyword: 'const',
            message: 'Must match const',
            params: { allowedValue: 'http' }
        }
    );

    const formatted = formatParseError('services', err);
    assertEquals(formatted, "services.backend Missing required property 'url'");
});
