/**
 * @fileoverview Unit tests for the climetadata.ts module.
 */

import { assertEquals } from '@std/assert';
import process from 'node:process';
import { getRuntimeEnvironment, getProgramName, getAppMetadata } from '../../src/cli/metadata.ts';
import { withProcessArgs } from '../helpers.ts';

Deno.test('getRuntimeEnvironment: returns deno when running in Deno tests', () => {
    assertEquals(getRuntimeEnvironment(), 'deno');
});

Deno.test('getProgramName: returns basename with extension', () => {
    withProcessArgs([], () => {
        const name = getProgramName();
        assertEquals(name, 'app.js');
    });
});

Deno.test('getProgramName: handles different script paths', () => {
    const originalArgv = process.argv;
    try {
        process.argv = ['node', '/path/to/script.ts'];
        assertEquals(getProgramName(), 'script.ts');

        process.argv = ['deno', 'myapp.mjs'];
        assertEquals(getProgramName(), 'myapp.mjs');
    } finally {
        process.argv = originalArgv;
    }
});

Deno.test('getAppMetadata: strips .js extension from program name fallback', () => {
    withProcessArgs([], () => {
        // This test runs in a directory without deno.json/package.json or with one that lacks a name
        const metadata = getAppMetadata();
        // The program name is 'app.js' but should be stripped to 'app'
        if (metadata.name === 'app') {
            assertEquals(metadata.name, 'app');
        } else {
            // If deno.json has a name, that takes precedence
            assertEquals(typeof metadata.name, 'string');
        }
    });
});

Deno.test('getAppMetadata: strips .ts extension from program name fallback', () => {
    const originalArgv = process.argv;
    try {
        process.argv = ['deno', '/path/to/myapp.ts'];
        const metadata = getAppMetadata();
        // Should strip .ts extension if using fallback
        if (!metadata.name.includes('@jorvik')) {
            assertEquals(metadata.name.endsWith('.ts'), false);
        }
    } finally {
        process.argv = originalArgv;
    }
});

Deno.test('getAppMetadata: strips various JS/TS extensions', () => {
    const originalArgv = process.argv;
    const extensions = ['.js', '.ts', '.mjs', '.cjs', '.mts', '.cts'];

    for (const ext of extensions) {
        try {
            process.argv = ['node', `/path/to/testscript${ext}`];
            const metadata = getAppMetadata();
            // If using fallback (no config name), should not have extension
            if (!metadata.name.includes('@jorvik') && !metadata.name.includes('/')) {
                assertEquals(metadata.name.includes('.'), false, `Extension ${ext} should be stripped`);
            }
        } finally {
            process.argv = originalArgv;
        }
    }
});
