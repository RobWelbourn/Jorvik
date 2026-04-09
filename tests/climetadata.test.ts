/**
 * @fileoverview Unit tests for the climetadata.ts module.
 */

import { assertEquals } from '@std/assert';
import { getRuntimeEnvironment } from '../src/climetadata.ts';

Deno.test('getRuntimeEnvironment: returns deno when running in Deno tests', () => {
    assertEquals(getRuntimeEnvironment(), 'deno');
});
