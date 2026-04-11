/**
 * @module cli/metadata
 * Functions for reading application metadata from package.json (Node.js) or deno.json (Deno)
 * and determining the runtime environment.
 */
import * as path from 'node:path';
import { readFileSync } from 'node:fs';
import process from 'node:process';

/** App metadata taken from either package.json or Deno's import.meta */
export type AppMetadata = {
    name: string;
    version: string;
    description: string;
};

/**
 * Utility function to get the short form of the program entry point.
 * @returns The module name.
 */
export function getProgramName() {
    return path.basename(process.argv[1] ?? 'app.js');
}

/**
 * Detects whether code is running under Deno or Node.js.
 * @returns 'deno' when Deno globals are present, otherwise 'node'.
 */
export function getRuntimeEnvironment(): 'deno' | 'node' {
    return typeof globalThis.Deno !== 'undefined' ? 'deno' : 'node';
}

/**
 * Looks in deno.json (Deno) or package.json (Node.js) for app metadata, i.e. name, version and description,
 * which are used in the CLI help and version display. Defaults are '[app]', '0.0.0' and ''.
 * @returns The app metadata.
 */
export function getAppMetadata(): AppMetadata {
    const runtime = getRuntimeEnvironment();

    if (runtime === 'deno') {
        // In Deno, read from deno.json
        try {
            const denoPath = new URL('deno.json', import.meta.url);
            const denoText = Deno.readTextFileSync(denoPath);
            const denoConfig = JSON.parse(denoText) as {
                name?: string;
                version?: string;
                description?: string;
            };
            return {
                name: denoConfig.name ?? '[app]',
                version: denoConfig.version ?? '0.0.0',
                description: denoConfig.description ?? '',
            };
        } catch {
            return {
                name: '[app]',
                version: '0.0.0',
                description: '',
            };
        }
    }

    // In Node.js, read from package.json
    try {
        const moduleDir = path.dirname(new URL(import.meta.url).pathname);
        const pkgPath = path.join(moduleDir, '../package.json');
        const pkgContent = readFileSync(pkgPath, 'utf-8');
        const pkgConfig = JSON.parse(pkgContent) as {
            name?: string;
            version?: string;
            description?: string;
        };
        return {
            name: pkgConfig.name ?? '[app]',
            version: pkgConfig.version ?? '0.0.0',
            description: pkgConfig.description ?? '',
        };
    } catch {
        return {
            name: '[app]',
            version: '0.0.0',
            description: '',
        };
    }
}
