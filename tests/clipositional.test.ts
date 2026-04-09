/**
 * @fileoverview Unit tests for the parsePositionalParams function (clipositional.ts).
 * These tests call the function directly with raw arrays, without going through argv.
 */

import { assert, assertEquals } from '@std/assert';
import { Type } from 'typebox';
import { parsePositionalParams } from '../src/clipositional.ts';

Deno.test('parsePositionalParams: maps positionals to schema properties in order', () => {
    const schema = Type.Object({
        input: Type.String(),
        mode: Type.String({ enum: ['fast', 'safe'], default: 'safe' }),
        rest: Type.Optional(Type.Array(Type.String())),
    });

    const result = parsePositionalParams(schema, ['in.txt', 'fast', 'one', 'two']);
    assertEquals(result.success, true);
    if (result.success) {
        assertEquals(result.value, { input: 'in.txt', mode: 'fast', rest: ['one', 'two'] });
    }
});

Deno.test('parsePositionalParams: puts required params before optional in processing order', () => {
    const schema = Type.Object({
        output: Type.String({ default: 'out.txt' }),
        input: Type.String(),
    }, {
        required: ['input'],
    });

    // 'input' is required so it's processed first, even though 'output' is declared first
    const result = parsePositionalParams(schema, ['in.txt']);
    assertEquals(result.success, true);
    if (result.success) {
        assertEquals(result.value.input, 'in.txt');
        assertEquals(result.value.output, 'out.txt'); // default applied
    }
});

Deno.test('parsePositionalParams: uses default value for omitted optional param', () => {
    const schema = Type.Object({
        input: Type.String(),
        mode: Type.String({ enum: ['fast', 'safe'], default: 'safe' }),
    });

    const result = parsePositionalParams(schema, ['in.txt']);
    assertEquals(result.success, true);
    if (result.success) {
        assertEquals(result.value, { input: 'in.txt', mode: 'safe' });
    }
});

Deno.test('parsePositionalParams: returns failure for missing required param', () => {
    const schema = Type.Object({
        input: Type.String(),
        output: Type.String(),
    });

    const result = parsePositionalParams(schema, ['in.txt']);
    assertEquals(result.success, false);
    if (!result.success) {
        assert(result.error.includes('Missing required positional parameter'));
    }
});

Deno.test('parsePositionalParams: returns failure when too many positionals are provided', () => {
    const schema = Type.Object({
        input: Type.String(),
    });

    const result = parsePositionalParams(schema, ['in.txt', 'extra']);
    assertEquals(result.success, false);
    if (!result.success) {
        assertEquals(result.error, 'Too many positional parameters');
    }
});

Deno.test('parsePositionalParams: returns failure when array param is not the last positional', () => {
    const schema = Type.Object({
        tags: Type.Array(Type.String()),
        name: Type.String(),
    });

    const result = parsePositionalParams(schema, ['tag1', 'name1']);
    assertEquals(result.success, false);
    if (!result.success) {
        assertEquals(result.error, 'Only the last positional parameter may be an array');
    }
});

Deno.test('parsePositionalParams: returns failure for non-object schema', () => {
    const schema = Type.String();
    const result = parsePositionalParams(schema, ['value']);
    assertEquals(result.success, false);
    if (!result.success) {
        assert(result.error.length > 0);
    }
});
