/**
 * @fileoverview Unit tests for the clihelp.ts module.
 * Tests call compileHelp and getOrderedPositionalParams directly.
 * An empty palette is used so assertions can focus on text content without CSS format strings.
 */

import { assert, assertEquals } from '@std/assert';
import { Type } from 'typebox';
import {
    compileHelp,
    getOrderedPositionalParams,
    type HelpSchemaNode,
    type Palette,
} from '../../src/cli/help.ts';

const emptyPalette: Palette = {
    default: '',
    section: '',
    option: '',
    value: '',
    usage: '',
};

// --- getOrderedPositionalParams ---

Deno.test('getOrderedPositionalParams: puts required params before optional', () => {
    const schema: HelpSchemaNode = {
        type: 'object',
        properties: {
            output: { type: 'string', default: 'out.txt' },
            input: { type: 'string' },
        },
        required: ['input'],
    };

    const params = getOrderedPositionalParams(schema);
    assertEquals(params[0].key, 'input');
    assertEquals(params[0].isRequired, true);
    assertEquals(params[1].key, 'output');
    assertEquals(params[1].isRequired, false);
});

Deno.test('getOrderedPositionalParams: marks array and last param correctly', () => {
    const schema: HelpSchemaNode = {
        type: 'object',
        properties: {
            input: { type: 'string' },
            rest: { type: 'array', items: { type: 'string' } },
        },
        required: ['input', 'rest'],
    };

    const params = getOrderedPositionalParams(schema);
    assertEquals(params.length, 2);
    assertEquals(params[0].isArray, false);
    assertEquals(params[0].isLast, false);
    assertEquals(params[1].isArray, true);
    assertEquals(params[1].isLast, true);
});

Deno.test('getOrderedPositionalParams: returns empty array for schema without properties', () => {
    assertEquals(getOrderedPositionalParams({ type: 'object' }), []);
});

// --- compileHelp ---

Deno.test('compileHelp: first line is intro text and second line contains usage', () => {
    const schema = Type.Object({ name: Type.String() });
    const lines = compileHelp(schema, { intro: 'My App', usage: 'node app.ts [OPTIONS]' }, emptyPalette);

    assertEquals(lines[0].column1, 'My App');
    assert(lines[1].column1.includes('Usage:'));
    assert(lines[1].column1.includes('node app.ts [OPTIONS]'));
});

Deno.test('compileHelp: includes standard options in output', () => {
    const schema = Type.Object({ name: Type.String() });
    const lines = compileHelp(schema, { intro: 'App', usage: 'app' }, emptyPalette);
    const allText = lines.map((l) => l.column1 + (l.column2 ?? '')).join('\n');

    assert(allText.includes('--help, -h'));
    assert(allText.includes('--version, -v'));
    assert(allText.includes('--config, -c'));
});

Deno.test('compileHelp: includes top-level schema title and description', () => {
    const schema = Type.Object(
        { name: Type.String({ description: 'Agent name' }) },
        { title: 'Application options', description: 'Top-level description' },
    );
    const lines = compileHelp(schema, { intro: 'App', usage: 'app' }, emptyPalette);
    const allText = lines.map((l) => l.column1 + (l.column2 ?? '')).join('\n');

    assert(allText.includes('Application options'));
    assert(allText.includes('Top-level description'));
});

Deno.test('compileHelp: includes positional schema section with param names', () => {
    const positionalSchema = Type.Object({
        input: Type.String({ description: 'Input filename' }),
        rest: Type.Optional(Type.Array(Type.String({ description: 'Extra args' }))),
    }, { description: 'File arguments' });

    const schema = Type.Object({ name: Type.String() });
    const lines = compileHelp(schema, { intro: 'App', usage: 'app', positionalSchema }, emptyPalette);
    const allText = lines.map((l) => l.column1 + (l.column2 ?? '')).join('\n');

    assert(allText.includes('Positional parameters'));
    assert(allText.includes('File arguments'));
    assert(allText.includes('input'));
    assert(allText.includes('rest...'));
});

Deno.test('compileHelp: uses positional schema title as section heading', () => {
    const positionalSchema = Type.Object({
        file: Type.String({ description: 'File to process' }),
    }, { title: 'File arguments' });

    const schema = Type.Object({ name: Type.String() });
    const lines = compileHelp(schema, { intro: 'App', usage: 'app', positionalSchema }, emptyPalette);
    const sectionHeadings = lines.map((l) => l.column1).join('\n');

    assert(sectionHeadings.includes('File arguments'));
    assert(!sectionHeadings.includes('Positional parameters'));
});

Deno.test('compileHelp: positional section appears before standard options', () => {
    const positionalSchema = Type.Object({
        input: Type.String({ description: 'Input file' }),
    });

    const schema = Type.Object({ name: Type.String() });
    const lines = compileHelp(schema, { intro: 'App', usage: 'app', positionalSchema }, emptyPalette);

    const positionalIdx = lines.findIndex((l) => l.column1.includes('input'));
    const standardIdx = lines.findIndex((l) => (l.column2 ?? '').includes('Display this help message'));
    assert(positionalIdx < standardIdx);
});
