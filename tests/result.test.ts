/**
 * @fileoverview Unit tests for the result.ts module.
 */

import { assert, assertEquals } from '@std/assert';
import { failure, success, type Result } from '../src/result.ts';

Deno.test('success: returns a success Result with value', () => {
    const result = success(123);

    assertEquals(result.success, true);
    if (result.success) {
        assertEquals(result.value, 123);
    }
});

Deno.test('failure: returns a failure Result with error', () => {
    const err = new Error('boom');
    const result = failure(err);

    assertEquals(result.success, false);
    if (!result.success) {
        assertEquals(result.error, err);
    }
});

Deno.test('Result: supports control-flow narrowing on success branch', () => {
    const result: Result<string, string> = success('ok');

    if (result.success) {
        assertEquals(result.value, 'ok');
    } else {
        assert(false, 'Expected success result');
    }
});

Deno.test('Result: supports control-flow narrowing on failure branch', () => {
    const result: Result<string, string> = failure('bad');

    if (!result.success) {
        assertEquals(result.error, 'bad');
    } else {
        assert(false, 'Expected failure result');
    }
});

Deno.test('success: preserves object identity for value', () => {
    const value = { service: { enabled: true } };
    const result = success(value);

    if (result.success) {
        assertEquals(result.value, value);
        assert(result.value === value);
    }
});

Deno.test('failure: preserves error payload identity', () => {
    const payload = { code: 'E_FAIL', message: 'Operation failed' };
    const result = failure(payload);

    if (!result.success) {
        assertEquals(result.error, payload);
        assert(result.error === payload);
    }
});
