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
 * which are used in the CLI help and version display. Defaults to the executing script name (without extension),
 * '0.0.0', and ''.
 * @returns The app metadata.
 */
export function getAppMetadata(): AppMetadata {
    const runtime = getRuntimeEnvironment();
    const configFile = runtime === 'deno' ? 'deno.json' : 'package.json';
    const configPath = path.join(process.cwd(), configFile);
    const defaultName = getProgramName().replace(/\.(js|ts|mjs|cjs|mts|cts)$/, '');

    try {
        const content = readFileSync(configPath, 'utf-8');
        const config = JSON.parse(content) as {
            name?: string;
            version?: string;
            description?: string;
        };
        return {
            name: config.name ?? defaultName,
            version: config.version ?? '0.0.0',
            description: config.description ?? '',
        };
    } catch {
        return {
            name: defaultName,
            version: '0.0.0',
            description: '',
        };
    }
}
