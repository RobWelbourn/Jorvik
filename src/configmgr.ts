/**
 * @filedesc A class and associated types for processing configuration files. 
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

/**
 * TConfigElement is a recursive type that can represent any JSON value stored in a config object.
 */
export type TConfigElement =
    | string
    | number
    | boolean
    | null
    | TConfigElement[]
    | TConfig;

/**
 * TConfig represents a JSON-derived configuration object.
 */
export interface TConfig {
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
 * @classdesc A Replacer implementation that replaces environment variables
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

/**
 * @classdesc A class for loading, merging, and processing configuration files. The configuration files are 
 * expected to be in JSON5 format and located in the 'config' directory relative to the current working directory. 
 * The class supports loading multiple configuration files, merging them together, and substituting environment 
 * variable placeholders with their actual values. 
 */
export class ConfigManager {
    private files: string[] = [];
    private configs: TConfig[] = [];
    private supplementalConfigs: TConfig[] = []; // Added after constructor, but before load() is called.
    private mergedConfig: TConfig = {};
    private errors: string[] = [];
    private replacer = new EnvVariableReplacer();

    /**
     * Constructor. Takes a single file name or an array of file names to load and process as the configuration. 
     * The files will be loaded in the order they are provided, and later files will overwrite values from earlier 
     * files when there are conflicts.
     * @param files The file name or names to load.
     * @param replacer Replacer object that will get the values of secrets; defaults to a standard Replacer that
     * gets values from local environment variables.
     */
    constructor(files: string | string[] = [], replacer?: Replacer) {
        this.files = Array.isArray(files) ? files : [files];
        if (replacer) {
            this.replacer = replacer;
        }
    }

    /**
     * Adds a configuration object to the list of configurations to be merged, prior to the load() operation.
     * @param config The configuration object to add.
     */
    addConfig(config: TConfig): void {
        this.supplementalConfigs.push(config);
    }

    /**
     * Do a deep merge of two configuration objects. The source object will overwrite any existing 
     * values in the target object, but if both values are non-array, non-null objects, they will be 
     * merged recursively instead of being overwritten.  Note that arrays are replaced rather than 
     * concatenated.
     * @param target The target configuration object to merge into.
     * @param source The source configuration object to merge from.
     * @returns A new configuration object that is the result of merging the source into the target.
     */
    private deepMerge<TConfigElement>(target: TConfigElement, source: TConfigElement): TConfigElement {
        const isObject = (item: unknown) => item !== null && typeof item === 'object' && !Array.isArray(item);
        const merged = structuredClone(target);

        if (isObject(target) && isObject(source)) {
            for (const key in source) {
                merged[key] = isObject(merged[key]) && isObject(source[key]) 
                    ? this.deepMerge(merged[key], source[key])
                    : structuredClone(source[key]);
            }
        }
        return merged;
    }

    /**
     * Replaces environment variable placeholders in a configuration object using a provided replacer function. 
     * The function will typically be used to replace environment variable placeholders in the configuration 
     * with their actual values.  In the general case, we may be using a cloud-based secrets manager, so the 
     * replacer function is async and returns a Promise. 
     * @param config The configuration object.
     * @param replacer The replacer function.
     * @returns The updated configuration object.
     */
    private async deepReplace(config: TConfigElement): Promise<TConfigElement> {
        if (typeof config === 'string') {
            // Is this an environment variable?
            if (config.startsWith('$')) { 
                const variableName = config.slice(1);
                if (variableName.startsWith('$')) {
                    // Escaped dollar sign, so return the string with one dollar sign.
                    return config.slice(1);
                }
                try {
                    return await this.replacer.replace(variableName);
                } catch (err) {
                    this.errors.push(err instanceof Error ? err.message : String(err));
                    return config;  // Return the original string if replacement fails
                }
            }
            return config;
        } else if (Array.isArray(config)) {
            for (let index = 0; index < config.length; index++) {
                config[index] = await this.deepReplace(config[index]);
            }
        } else if (config !== null && typeof config === 'object') {
            for (const key in config) {
                config[key] = await this.deepReplace(config[key]);
            }
        }
        return config;
    }

    /**
     * Loads the configuration from the specified files, merges them together, and substitutes the values for 
     * any environment variables. If a given file name includes a path, the method will look there. Otherwise,
     * it will look in the current directory and then in the ./config directory. If no files were specified in  
     * the constructor, it will attempt to load a default set of configuration files (e.g. default.json5, 
     * local.json5) if they are present in the config directory.  Any supplemental configuration objects added 
     * using the addConfig() method will be merged in after loading the files, but before environment variable 
     * replacement.
     * @returns A Result containing a clone of the merged configuration object if successful, or an error 
     * string if there were errors.
     */
    async load(): Promise<Result<TConfig, string>> {
        if (this.files.length === 0) {
            this.files = await getDefaultConfigFiles();
        }

        for (const file of this.files) {
            const result = await findConfigFile(file);
            if (result.success) {
                try {
                    const filePath = result.value;
                    const content = await Deno.readTextFile(filePath);
                    const config = JSON5.parse(content);
                    this.configs.push(config);
                } catch (err) {
                    this.errors.push(`Failed to parse config file ${file}:`);
                    this.errors.push(err instanceof Error ? err.message : String(err));
                }
            } else {
                this.errors.push(`Failed to find config file ${file}:`);
                this.errors.push(result.error);
            }
        }

        this.configs.push(...this.supplementalConfigs);

        if (this.configs.length > 0) {
            this.mergedConfig = this.configs.reduce((target, source) => this.deepMerge(target, source));
            this.mergedConfig = await this.deepReplace(this.mergedConfig) as TConfig;
        }

        if (this.hasErrors()) {
            return failure(this.getErrors());
        }
        return success(this.getConfig());
    }

    /**
     * Returns a deep copy of the merged configuration object.
     * @returns The merged configuration object.
     */
    getConfig(): TConfig {
        return structuredClone(this.mergedConfig);
    }

    /**
     * Returns a Result containing a validated configuration object for a given section and schema. 
     * If the section is undefined, the entire configuration will be validated against the schema. 
     * Otherwise, it will be treated as a dot-separated path to a section of the configuration to be 
     * extracted and validated.  If the section does not exist, an empty object will be used, which will 
     * trigger validation errors for any required properties that are missing. If there are any validation 
     * errors, they will be passed back in the Result, as a formatted string.
     * @param section Dot-separated path to the section of the configuration to validate, or undefined.
     * @param schema The schema.
     * @returns Result<Static<TSchema>, string> The validated configuration object if successful, or an 
     * error string if there were validation errors.
     */
    getValidatedConfig(section: string | undefined, schema: TSchema): Result<Static<TSchema>, string> {
        let config: TConfigElement = this.mergedConfig;

        if (section) {
            const parts = section.split('.');
            for (const part of parts) {
                if (typeof config === 'object' && config !== null && !Array.isArray(config) && part in config) {
                    config = config[part];
                } else {
                    // Set to empty object to trigger validation errors for missing section,
                    // or to use default values from the schema if appropriate.
                    config = {};
                    break;
                }
            }
        }

        try {
            return success(customParse(schema, config));
        } catch (error) {
            if (error instanceof ParseError) {
                return failure(formatParseError(section, error));
            } 
            if (error instanceof Error) {
                return failure(String(error.message));
            }
            return failure(String(error));
        }   
    }

    /**
     * Does this Config instance have any errors from loading or processing the configuration files?
     * @returns true if there are errors, false otherwise.
     */
    hasErrors(): boolean {
        return this.errors.length > 0;
    }

    /**
     * Returns a concatenated string of error messages accumulated during loading and processing the configuration files. 
     * @returns The error string, or an empty string if there are none.
     */
    getErrors(): string {
        return this.errors.join('\n');
    }   
}