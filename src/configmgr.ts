/**
 * @module configmgr
 * A class and associated types for processing configuration files. 
 */
import * as path from '@std/path';
import JSON5 from 'json5';
import { ParseError } from 'typebox/value';
import type { Static, TSchema } from 'typebox';
import { customParse, formatParseError } from './typeboxhelpers.ts';
import { type Result, success, failure } from './result.ts';

const CONFIG_DIR = 'config';
const defaultConfigFiles = [
    'default.json5', 
    'local.json5', 
];  

/**
 * Gets the list of default configuration files that are available in the config directory.
 * @returns The list of available default configuration files.
 */
async function getDefaultConfigFiles(): Promise<string[]> {
    const foundFiles: string[] = [];
    for (const file of defaultConfigFiles) {
        const filePath = path.join(CONFIG_DIR, file);
        try {
            if ((await Deno.stat(filePath)).isFile) {
                foundFiles.push(file);
            }
        } catch (_err) {
            // File not found, so continue to next.
        }
    }
    return foundFiles;
}

/**
 * Looks for a config file; if the name includes a path, looks there, otherwise looks in the current 
 * directory and then in ./config.
 * @param name 
 */
async function findConfigFile(name: string): Promise<Result<string, string>> {
    const basename = path.basename(name);
    if (basename === name) {  // no path component 
        // Look in current directory first, then in ./config
        try {
            if ((await Deno.stat(name)).isFile) {
                return success(name);
            }
        } catch (_err) {
            // File not found in the current directory, so try the config directory next.
        }

        try {
            const configPath = path.join('config', name);
            if ((await Deno.stat(configPath)).isFile) {
                return success(configPath);
            }
        } catch (_err) {
            // File not found in the config directory, so return an error.
            return failure(`Config file ${name} not found in current directory or ./config`);
        }
    }
  
    // Name includes a path, so look there
    try {
        if ((await Deno.stat(name)).isFile) {
            return success(name);
        } 
    } catch (_err) {
        return failure(`Config file ${name} not found`);
    }

    return failure(`Config file ${name} not found`);  // Catch-all error if file not found
}

/** TConfigElement is a recursive type that can represent any JSON value stored in a config object. */
export type TConfigElement =
    | string
    | number
    | boolean
    | null
    | TConfigElement[]
    | TConfig;

/** TConfig represents a JSON-derived configuration object. */
export interface TConfig {
    /** Key-value pairs where the key is a string and the value is a TConfigElement. */
    [key: string]: TConfigElement;
}

/**
 * Interface for functions that will replace environment variables with their actual values. 
 * Intended to be implemented by, for example:
 * - Cloud secrets managers
 * - OS keychains
 * - Environment variable replacers that read from the local process environment.
 */
export interface Replacer {
    /**
     * Replace an environment variable placeholder with its actual value. 
     * @param variableName The variable name.
     * @returns The value of the environment variable.
     * @throws Error if the environment variable is not defined or cannot be accessed.
     */
    replace: (variableName: string) => Promise<string>;
}

/**
 * @class A Replacer implementation that replaces environment variables
 * with their actual values from the local process environment.
 */
class EnvVariableReplacer implements Replacer {
    /**
     * Replaces environment variable placeholders in a string value with their actual values.  If the 
     * environment variable is not defined, an error is thrown.  
     * @param variableName Name of the environment variable.
     * @returns The replaced value, if found.
     * @throws Error if the environment variable is not defined.
     */
    replace(variableName: string): Promise<string> {
        const result = Deno.env.get(variableName);
        if (!result) {
            throw new Error(`Environment variable ${variableName} is not defined`);
        }
        return Promise.resolve(result);
    }
}

/** Options for the ConfigManager constructor. */
export interface ConfigOptions {
    /** 
     * Replacer object that replaces environment variable values from a secrets manager
     * or from the local environment. 
     */
    replacer?: Replacer;
}

/**
 * @class A class for loading, merging, and processing configuration files. The configuration files are 
 * expected to be in JSON5 format and located in the 'config' directory relative to the current working directory. 
 * The class supports loading multiple configuration files, merging them together, and substituting environment 
 * variable placeholders with their actual values. 
 */
export class ConfigManager<S extends TSchema = TSchema> {
    #schema: S;
    #files: string[] = [];
    #configs: TConfig[] = [];
    #supplementalConfigs: TConfig[] = []; // Added after constructor, but before load() is called.
    #mergedConfig: TConfig = {};
    #errors: string[] = [];
    #replacer = new EnvVariableReplacer();

    /**
     * Constructor.
     * @param schema TypeBox schema used to validate the configuration.
     * @param files The file name or names to load.
     * @param options Config options:
     * @param options.replacer Replacer object that gets the values of secrets; defaults to a standard 
     * Replacer that gets values from local environment variables.
     */
    constructor(schema: S, files: string | string[] = [], options: ConfigOptions = {}) {
        this.#schema = schema;
        this.#files = Array.isArray(files) ? files : [files];
        if (options.replacer) {
            this.#replacer = options.replacer;
        }
    }

    /**
     * Adds a configuration object to the list of configurations to be merged, prior to the load() operation.
     * @param config The configuration object to add.
     */
    addConfig(config: TConfig): void {
        this.#supplementalConfigs.push(config);
    }

    /**
     * @ignore
     * Do a deep merge of two configuration objects. The source object will overwrite any existing
     * values in the target object, but if both values are non-array, non-null objects, they will be
     * merged recursively instead of being overwritten. Note that arrays are replaced rather than
     * concatenated.
     * @param target The target configuration object to merge into.
     * @param source The source configuration object to merge from.
     * @returns A new configuration object that is the result of merging the source into the target.
     */
    #deepMerge<TElement>(target: TElement, source: TElement): TElement {
        const isObject = (item: unknown) => item !== null && typeof item === 'object' && !Array.isArray(item);
        const merged = structuredClone(target);

        if (isObject(target) && isObject(source)) {
            for (const key in source) {
                merged[key] = isObject(merged[key]) && isObject(source[key])
                    ? this.#deepMerge(merged[key], source[key])
                    : structuredClone(source[key]);
            }
        }
        return merged;
    }

    /**
     * @ignore
     * Replaces environment variable placeholders in a configuration object using a provided replacer function.
     * @param config The configuration object.
     * @returns The updated configuration object.
     */
    async #deepReplace(config: TConfigElement): Promise<TConfigElement> {
        if (typeof config === 'string') {
            // Is this an environment variable?
            if (config.startsWith('$')) {
                const variableName = config.slice(1);
                if (variableName.startsWith('$')) {
                    // Escaped dollar sign, so return the string with one dollar sign.
                    return config.slice(1);
                }
                try {
                    return await this.#replacer.replace(variableName);
                } catch (err) {
                    this.#errors.push(err instanceof Error ? err.message : String(err));
                    return config; // Return the original string if replacement fails
                }
            }
            return config;
        }

        if (Array.isArray(config)) {
            for (let index = 0; index < config.length; index++) {
                config[index] = await this.#deepReplace(config[index]);
            }
            return config;
        }

        if (config !== null && typeof config === 'object') {
            for (const key in config) {
                config[key] = await this.#deepReplace(config[key]);
            }
        }

        return config;
    }

    /**
     * Loads, merges, replaces env placeholders, and validates against the schema passed to the constructor.
     * @returns Result containing validated config on success, or error messages on failure.
     */
    async load(): Promise<Result<Static<S>, string>> {
        if (this.#files.length === 0) {
            this.#files = await getDefaultConfigFiles();
        }

        for (const file of this.#files) {
            const result = await findConfigFile(file);
            if (result.success) {
                try {
                    const filePath = result.value;
                    const content = await Deno.readTextFile(filePath);
                    const config = JSON5.parse(content) as TConfig;
                    this.#configs.push(config);
                } catch (err) {
                    this.#errors.push(`Failed to parse config file ${file}:`);
                    this.#errors.push(err instanceof Error ? err.message : String(err));
                }
            } else {
                this.#errors.push(`Failed to find config file ${file}:`);
                this.#errors.push(result.error);
            }
        }

        this.#configs.push(...this.#supplementalConfigs);

        if (this.#configs.length > 0) {
            this.#mergedConfig = this.#configs.reduce((target, source) => this.#deepMerge(target, source));
            this.#mergedConfig = await this.#deepReplace(this.#mergedConfig) as TConfig;
        }

        try {
            const validated = customParse(this.#schema, this.#mergedConfig);
            if (this.#errors.length > 0) {
                return failure(this.#errors.join('\n'));
            }
            return success(validated);
        } catch (error) {
            if (error instanceof ParseError) {
                this.#errors.push(formatParseError(undefined, error));
            } else if (error instanceof Error) {
                this.#errors.push(String(error.message));
            } else {
                this.#errors.push(String(error));
            }
            return failure(this.#errors.join('\n'));
        }
    }
}