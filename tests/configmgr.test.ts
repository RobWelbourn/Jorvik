/**
 * @fileoverview Unit tests for the configmgr.ts module.
 */

import { assertEquals, assertExists, assert } from '@std/assert';
import { ConfigManager } from '../src/configmgr.ts';
import { Type } from 'typebox';

class MockReplacer {
    calls: string[] = [];
    values = new Map<string, string>();
    error?: string;

    replace(variableName: string): Promise<string> {
        this.calls.push(variableName);
        if (this.error) {
            throw new Error(this.error);
        }
        const value = this.values.get(variableName);
        if (!value) {
            throw new Error(`No mock value for ${variableName}`);
        }
        return Promise.resolve(value);
    }
}

// Setup and teardown helpers
async function createTestConfigDir(): Promise<void> {
    const configDir = Deno.cwd() + '/config';
    try {
        await Deno.mkdir(configDir, { recursive: true });
    } catch {
        // Directory might already exist
    }
}

async function writeTestConfig(filename: string, content: string): Promise<void> {
    const configDir = Deno.cwd() + '/config';
    const filePath = `${configDir}/${filename}`;
    await Deno.writeTextFile(filePath, content);
}

async function deleteTestConfig(filename: string): Promise<void> {
    const configDir = Deno.cwd() + '/config';
    const filePath = `${configDir}/${filename}`;
    try {
        await Deno.remove(filePath);
    } catch {
        // File might not exist
    }
}

async function _cleanupTestConfigDir(): Promise<void> {
    const configDir = Deno.cwd() + '/config';
    try {
        await Deno.remove(configDir, { recursive: true });
    } catch {
        // Directory might not exist
    }
}

// Tests

Deno.test('ConfigManager: empty constructor', async () => {
    const config = new ConfigManager();
    await config.load();
    assertEquals(config.hasErrors(), false);
    const cfg0 = config.getConfig();
    assertExists(cfg0);
});

Deno.test('ConfigManager: load single config file', async () => {
    await createTestConfigDir();
    const testConfig = { database: { host: 'localhost', port: 5432 } };
    await writeTestConfig('test.json5', JSON.stringify(testConfig));

    try {
        const config = new ConfigManager('test.json5');
        await config.load();
        assertEquals(config.hasErrors(), false);
        const cfg = config.getConfig();
        assertExists(cfg);
        const c = cfg as typeof testConfig;
        assertEquals(c.database.host, 'localhost');
        assertEquals(c.database.port, 5432);
    } finally {
        await deleteTestConfig('test.json5');
    }
});

Deno.test('ConfigManager: load non-existent file', async () => {
    await createTestConfigDir();
    const config = new ConfigManager('nonexistent.json5');
    await config.load();
    assertEquals(config.hasErrors(), true);
    assert(config.getErrors().includes('Failed to find config file'));
});

Deno.test('ConfigManager: load multiple config files', async () => {
    await createTestConfigDir();
    const config1 = { database: { host: 'localhost', port: 5432 } };
    const config2 = { cache: { ttl: 3600 } };
    
    await writeTestConfig('config1.json5', JSON.stringify(config1));
    await writeTestConfig('config2.json5', JSON.stringify(config2));

    try {
        const config = new ConfigManager(['config1.json5', 'config2.json5']);
        await config.load();
        assertEquals(config.hasErrors(), false);
        const cfg = config.getConfig();
        assertExists(cfg);
        const c = cfg as typeof config1 & typeof config2;
        assertEquals(c.database.host, 'localhost');
        assertEquals(c.database.port, 5432);
        assertEquals(c.cache.ttl, 3600);
    } finally {
        await deleteTestConfig('config1.json5');
        await deleteTestConfig('config2.json5');
    }
});

Deno.test('ConfigManager: merge configs with override', async () => {
    await createTestConfigDir();
    const config1 = { database: { host: 'localhost', port: 5432 }, debug: true };
    const config2 = { database: { host: 'remotehost' }, cache: { ttl: 3600 } };
    
    await writeTestConfig('config1.json5', JSON.stringify(config1));
    await writeTestConfig('config2.json5', JSON.stringify(config2));

    try {
        const config = new ConfigManager(['config1.json5', 'config2.json5']);
        await config.load();
        assertEquals(config.hasErrors(), false);
        const cfg = config.getConfig();
        assertExists(cfg);
        const c = cfg as typeof config1 & typeof config2;
        assertEquals(c.database.host, 'remotehost');
        assertEquals(c.database.port, 5432);
        assertEquals(c.debug, true);
        assertEquals(c.cache.ttl, 3600);
    } finally {
        await deleteTestConfig('config1.json5');
        await deleteTestConfig('config2.json5');
    }
});

Deno.test('ConfigManager: replace environment variables', async () => {
    await createTestConfigDir();
    Deno.env.set('TEST_DB_HOST', 'test-host');
    const testConfig = { database: { host: '$TEST_DB_HOST', port: 5432 } };
    await writeTestConfig('envtest.json5', JSON.stringify(testConfig));

    try {
        const config = new ConfigManager('envtest.json5');
        await config.load();
        // console.log(JSON.stringify(config.getConfig()));
        assertEquals(config.hasErrors(), false);
        const cfg = config.getConfig();
        assertExists(cfg);
        const c = cfg as typeof testConfig;
        assertEquals(c.database.host, 'test-host');
    } finally {
        await deleteTestConfig('envtest.json5');
    }
});

Deno.test('ConfigManager: handle escaped dollar sign', async () => {
    await createTestConfigDir();
    const testConfig = { price: '$$100' };
    await writeTestConfig('escapedtest.json5', JSON.stringify(testConfig));

    try {
        const config = new ConfigManager('escapedtest.json5');
        await config.load();
        // console.log(JSON.stringify(config.getConfig()));
        // console.log(config.getErrors());
        assertEquals(config.hasErrors(), false);
        const cfg = config.getConfig();
        assertExists(cfg);
        const c = cfg as typeof testConfig;
        assertEquals(c.price, '$100');
    } finally {
        await deleteTestConfig('escapedtest.json5');
    }
});

Deno.test('ConfigManager: error on undefined environment variable', async () => {
    await createTestConfigDir();
    // Use a unique variable name to ensure it's not set
    const uniqueVarName = `NONEXISTENT_VAR_${Date.now()}`;
    const testConfig = { database: { host: `$${uniqueVarName}` } };
    await writeTestConfig('undeftest.json5', JSON.stringify(testConfig));

    try {
        const config = new ConfigManager('undeftest.json5');
        await config.load();
        // console.log(JSON.stringify(config.getConfig()));
        // console.log(config.getErrors());
        assertEquals(config.hasErrors(), true);
        assert(config.getErrors().includes('is not defined'));
    } finally {
        await deleteTestConfig('undeftest.json5');
    }
});

Deno.test('ConfigManager: JSON5 parsing', async () => {
    await createTestConfigDir();
    type dbConfig = {
        database: {
            host: string;
            port: number;
        };
    };
    // JSON5 allows trailing commas and comments
    const json5Content = `{
        // This is a comment
        database: {
            host: 'localhost',
            port: 5432,
        },
    }`;
    await writeTestConfig('json5test.json5', json5Content);

    try {
        const config = new ConfigManager('json5test.json5');
        await config.load();
        assertEquals(config.hasErrors(), false);
        const cfg = config.getConfig();
        assertExists(cfg);
        const c = cfg as dbConfig;
        assertEquals(c.database.host, 'localhost');
        assertEquals(c.database.port, 5432);
    } finally {
        await deleteTestConfig('json5test.json5');
    }
});

Deno.test('ConfigManager: JSON5 parse errors', async () => {
    await createTestConfigDir();
    const malformedJson5 = `{
        database: {
            host: 'localhost',
            port: 5432,,
        },
    }`;
    await writeTestConfig('json5parseerror.json5', malformedJson5);

    try {
        const config = new ConfigManager('json5parseerror.json5');
        await config.load();
        assertEquals(config.hasErrors(), true);
        const errors = config.getErrors();
        assert(errors.includes('Failed to parse config file json5parseerror.json5:'));
        assert(errors.includes('JSON5'));
    } finally {
        await deleteTestConfig('json5parseerror.json5');
    }
});

Deno.test('ConfigManager: load config with arrays', async () => {
    await createTestConfigDir();
    const testConfig = { servers: ['server1', 'server2', 'server3'], ports: [8080, 8081, 8082] };
    await writeTestConfig('arraytest.json5', JSON.stringify(testConfig));

    try {
        const config = new ConfigManager('arraytest.json5');
        await config.load();
        assertEquals(config.hasErrors(), false);
        const cfg = config.getConfig();
        assertExists(cfg);
        const c = cfg as typeof testConfig;
        assertEquals(Array.isArray(c.servers), true);
        assertEquals(c.servers.length, 3);
        assertEquals(c.ports[0], 8080);
    } finally {
        await deleteTestConfig('arraytest.json5');
    }
});

Deno.test('ConfigManager: load config with nested objects', async () => {
    await createTestConfigDir();
    const testConfig = {
        level1: {
            level2: {
                level3: {
                    value: 'deep'
                }
            }
        }
    };
    await writeTestConfig('nestedtest.json5', JSON.stringify(testConfig));

    try {
        const config = new ConfigManager('nestedtest.json5');
        await config.load();
        assertEquals(config.hasErrors(), false);
        const cfg = config.getConfig();
        assertExists(cfg);
        const c = cfg as typeof testConfig;
        assertEquals(c.level1.level2.level3.value, 'deep');
    } finally {
        await deleteTestConfig('nestedtest.json5');
    }
});

Deno.test('ConfigManager: load config with null values', async () => {
    await createTestConfigDir();
    const testConfig = { value: null, other: 'data' };
    await writeTestConfig('nulltest.json5', JSON.stringify(testConfig));

    try {
        const config = new ConfigManager('nulltest.json5');
        await config.load();
        assertEquals(config.hasErrors(), false);
        const cfg = config.getConfig();
        assertExists(cfg);
        const c = cfg as typeof testConfig;
        assertEquals(c.value, null);
        assertEquals(c.other, 'data');
    } finally {
        await deleteTestConfig('nulltest.json5');
    }
});

Deno.test('ConfigManager: load config with boolean and number values', async () => {
    await createTestConfigDir();
    const testConfig = { debug: true, enabled: false, timeout: 30000, rate: 0.95 };
    await writeTestConfig('typestest.json5', JSON.stringify(testConfig));

    try {
        const config = new ConfigManager('typestest.json5');
        await config.load();
        assertEquals(config.hasErrors(), false);
        const cfg = config.getConfig();
        assertExists(cfg);
        const c = cfg as typeof testConfig;
        assertEquals(c.debug, true);
        assertEquals(c.enabled, false);
        assertEquals(c.timeout, 30000);
        assertEquals(c.rate, 0.95);
    } finally {
        await deleteTestConfig('typestest.json5');
    }
});

Deno.test('ConfigManager: load multiple files with partial errors', async () => {
    await createTestConfigDir();
    const validConfig = { database: { host: 'localhost' } };
    await writeTestConfig('valid.json5', JSON.stringify(validConfig));

    try {
        const config = new ConfigManager(['valid.json5', 'nonexistent.json5']);
        await config.load();
        // Should have errors from the nonexistent file, but valid config was also loaded
        assertEquals(config.hasErrors(), true);
        const cfg = config.getConfig();
        assertExists(cfg);
        const c = cfg as typeof validConfig;
        assertEquals(c.database.host, 'localhost');
    } finally {
        await deleteTestConfig('valid.json5');
    }
});

Deno.test('ConfigManager: environment variable replacement in nested config', async () => {
    await createTestConfigDir();
    Deno.env.set('TEST_SECRET', 'secret-value');
    const testConfig = { 
        database: { 
            credentials: {
                password: '$TEST_SECRET'
            }
        } 
    };
    await writeTestConfig('nestedenvtest.json5', JSON.stringify(testConfig));

    try {
        const config = new ConfigManager('nestedenvtest.json5');
        await config.load();
        // console.log(JSON.stringify(config.getConfig()));
        // console.log(config.getErrors());
        assertEquals(config.hasErrors(), false);
        const cfg = config.getConfig();
        assertExists(cfg);
        const c = cfg as typeof testConfig;
        assertEquals(c.database.credentials.password, 'secret-value');
    } finally {
        await deleteTestConfig('nestedenvtest.json5');
    }
});

Deno.test('ConfigManager: environment variable replacement in arrays', async () => {
    await createTestConfigDir();
    Deno.env.set('HOST1', 'production-host');
    const testConfig = { hosts: ['$HOST1', 'backup-host'] };
    await writeTestConfig('arrayenvtest.json5', JSON.stringify(testConfig));

    try {
        const config = new ConfigManager('arrayenvtest.json5');
        await config.load();
        // console.log(JSON.stringify(config.getConfig()));
        // console.log(config.getErrors());
        assertEquals(config.hasErrors(), false);
        const cfg = config.getConfig();
        assertExists(cfg);
        const c = cfg as typeof testConfig;
        assertEquals(c.hosts[0], 'production-host');
    } finally {
        await deleteTestConfig('arrayenvtest.json5');
    }
});

Deno.test('ConfigManager: constructor with string vs array', async () => {
    await createTestConfigDir();
    const testConfig = { test: true };
    await writeTestConfig('constructtest.json5', JSON.stringify(testConfig));

    try {
        // Test string constructor
        const config1 = new ConfigManager('constructtest.json5');
        await config1.load();
        assertEquals(config1.hasErrors(), false);
        const cfg1 = config1.getConfig();
        assertExists(cfg1);

        // Test array constructor
        const config2 = new ConfigManager(['constructtest.json5']);
        await config2.load();
        assertEquals(config2.hasErrors(), false);
        const cfg2 = config2.getConfig();
        assertExists(cfg2);
    } finally {
        await deleteTestConfig('constructtest.json5');
    }
});

Deno.test('ConfigManager: constructor uses provided Replacer for variable substitution', async () => {
    await createTestConfigDir();
    const testConfig = { database: { host: '$CUSTOM_DB_HOST', port: 5432 } };
    await writeTestConfig('custom-replacer.json5', JSON.stringify(testConfig));

    const replacer = new MockReplacer();
    replacer.values.set('CUSTOM_DB_HOST', 'replaced-by-mock');

    try {
        const config = new ConfigManager('custom-replacer.json5', replacer);
        await config.load();
        assertEquals(config.hasErrors(), false);

        const cfg = config.getConfig() as typeof testConfig;
        assertEquals(cfg.database.host, 'replaced-by-mock');
        assertEquals(cfg.database.port, 5432);
        assertEquals(replacer.calls, ['CUSTOM_DB_HOST']);
    } finally {
        await deleteTestConfig('custom-replacer.json5');
    }
});

Deno.test('ConfigManager: constructor reports errors from provided Replacer', async () => {
    await createTestConfigDir();
    const testConfig = { secret: '$API_KEY' };
    await writeTestConfig('custom-replacer-error.json5', JSON.stringify(testConfig));

    const replacer = new MockReplacer();
    replacer.error = 'mock replacer failure';

    try {
        const config = new ConfigManager('custom-replacer-error.json5', replacer);
        await config.load();
        assertEquals(config.hasErrors(), true);
        assert(config.getErrors().includes('mock replacer failure'));

        const cfg = config.getConfig() as typeof testConfig;
        // Original value should be preserved when replacement fails.
        assertEquals(cfg.secret, '$API_KEY');
        assertEquals(replacer.calls, ['API_KEY']);
    } finally {
        await deleteTestConfig('custom-replacer-error.json5');
    }
});

Deno.test('ConfigManager: constructor Replacer is not called for plain strings', async () => {
    await createTestConfigDir();
    const testConfig = { host: 'literal-host' };
    await writeTestConfig('custom-replacer-literal.json5', JSON.stringify(testConfig));

    const replacer = new MockReplacer();

    try {
        const config = new ConfigManager('custom-replacer-literal.json5', replacer);
        await config.load();
        assertEquals(config.hasErrors(), false);

        const cfg = config.getConfig() as typeof testConfig;
        assertEquals(cfg.host, 'literal-host');
        assertEquals(replacer.calls.length, 0);
    } finally {
        await deleteTestConfig('custom-replacer-literal.json5');
    }
});

Deno.test('ConfigManager: getValidatedConfig validates whole config successfully', async () => {
    await createTestConfigDir();
    const valid = { host: 'localhost', port: 8080 };
    await writeTestConfig('validate.json5', JSON.stringify(valid));

    try {
        const mgr = new ConfigManager('validate.json5');
        await mgr.load();
        const schema = Type.Object({ host: Type.String(), port: Type.Number() });
        const result = mgr.getValidatedConfig(undefined, schema);
        assertEquals(result.success, true);
        if (result.success) {
            const v = result.value as typeof valid;
            assertEquals(v.host, 'localhost');
            assertEquals(v.port, 8080);
        }
    } finally {
        await deleteTestConfig('validate.json5');
    }
});

Deno.test('ConfigManager: getValidatedConfig reports failures in Result.error', async () => {
    await createTestConfigDir();
    // Missing required properties
    const invalid = { foo: 'bar' };
    await writeTestConfig('invalid.json5', JSON.stringify(invalid));

    try {
        const mgr = new ConfigManager('invalid.json5');
        await mgr.load();
        const schema = Type.Object({ host: Type.String(), port: Type.Number() });
        const result = mgr.getValidatedConfig(undefined, schema);
        assertEquals(result.success, false);
        if (!result.success) {
            assert(result.error.length > 0);
        }
    } finally {
        await deleteTestConfig('invalid.json5');
    }
});

Deno.test('ConfigManager: getValidatedConfig validates a section path', async () => {
    await createTestConfigDir();
    const cfg = { database: { host: 'dbhost', port: 27017 }, other: true };
    await writeTestConfig('section.json5', JSON.stringify(cfg));

    try {
        const mgr = new ConfigManager('section.json5');
        await mgr.load();
        const schema = Type.Object({ host: Type.String(), port: Type.Number() });
        const result = mgr.getValidatedConfig('database', schema);
        assertEquals(result.success, true);
        if (result.success) {
            const v = result.value as typeof cfg.database;
            assertEquals(v.host, 'dbhost');
            assertEquals(v.port, 27017);
        }
    } finally {
        await deleteTestConfig('section.json5');
    }
});

Deno.test('ConfigManager: load default.json5 when present', async () => {
    await createTestConfigDir();
    const defaultConfig = { source: 'default-json5', value: 1 };
    await writeTestConfig('default.json5', JSON.stringify(defaultConfig));

    try {
        const config = new ConfigManager();
        await config.load();
        assertEquals(config.hasErrors(), false);
        const cfg = config.getConfig() as typeof defaultConfig;
        assertEquals(cfg.source, 'default-json5');
        assertEquals(cfg.value, 1);
    } finally {
        await deleteTestConfig('default.json5');
    }
});

Deno.test('ConfigManager: default then local merge and override (json5)', async () => {
    await createTestConfigDir();
    const defaultConfig = { value: 'from-default', nested: { a: 1 }, keep: true };
    const localConfig = { nested: { a: 2 }, localOnly: true };
    await writeTestConfig('default.json5', JSON.stringify(defaultConfig));
    await writeTestConfig('local.json5', JSON.stringify(localConfig));

    try {
        const config = new ConfigManager();
        await config.load();
        assertEquals(config.hasErrors(), false);
        const cfg = config.getConfig() as typeof defaultConfig & typeof localConfig;
        // default value preserved
        assertEquals(cfg.value, 'from-default');
        // local overrides nested.a
        assertEquals(cfg.nested.a, 2);
        // local adds new key
        assertEquals(cfg.localOnly, true);
    } finally {
        await deleteTestConfig('default.json5');
        await deleteTestConfig('local.json5');
    }
});

Deno.test('ConfigManager: getValidatedConfig rejects additional properties when additionalProperties=false', async () => {
    await createTestConfigDir();
    const cfg = { host: 'localhost', port: 8080, extra: 'notallowed' };
    await writeTestConfig('additional.json5', JSON.stringify(cfg));

    try {
        const mgr = new ConfigManager('additional.json5');
        await mgr.load();
        const schema = Type.Object({ host: Type.String(), port: Type.Number() }, { additionalProperties: false });
        const result = mgr.getValidatedConfig(undefined, schema);
        assertEquals(result.success, false);
        if (!result.success) {
            const found = result.error.includes('additional properties');
            assert(found);
        }
    } finally {
        await deleteTestConfig('additional.json5');
    }
});

// Tests for addConfig() method

Deno.test('ConfigManager: addConfig with single config object', async () => {
    await createTestConfigDir();
    const addedConfig = { database: { host: 'added-host', port: 5432 } };
    
    const config = new ConfigManager();
    config.addConfig(addedConfig);
    await config.load();
    
    assertEquals(config.hasErrors(), false);
    const cfg = config.getConfig() as typeof addedConfig;
    assertEquals(cfg.database.host, 'added-host');
    assertEquals(cfg.database.port, 5432);
});

Deno.test('ConfigManager: addConfig with multiple config objects', async () => {
    await createTestConfigDir();
    const config1 = { database: { host: 'localhost' } };
    const config2 = { database: { port: 3306 } };
    const config3 = { cache: { enabled: true } };
    
    const config = new ConfigManager();
    config.addConfig(config1);
    config.addConfig(config2);
    config.addConfig(config3);
    await config.load();
    
    assertEquals(config.hasErrors(), false);
    const cfg = config.getConfig() as typeof config1 & typeof config2 & typeof config3;
    assertEquals(cfg.database.host, 'localhost');
    assertEquals(cfg.database.port, 3306);
    assertEquals(cfg.cache.enabled, true);
});

Deno.test('ConfigManager: addConfig merge order and override', async () => {
    await createTestConfigDir();
    const config1 = { value: 'first', keep: 1 };
    const config2 = { value: 'second', another: 2 };
    
    const config = new ConfigManager();
    config.addConfig(config1);
    config.addConfig(config2);
    await config.load();
    
    assertEquals(config.hasErrors(), false);
    const cfg = config.getConfig() as typeof config1 & typeof config2;
    // Later config should override earlier ones
    assertEquals(cfg.value, 'second');
    // Earlier values that aren't overridden should be preserved
    assertEquals(cfg.keep, 1);
    assertEquals(cfg.another, 2);
});

Deno.test('ConfigManager: addConfig with file-based configs', async () => {
    await createTestConfigDir();
    const fileConfig = { source: 'file', database: { host: 'file-host' } };
    const addedConfig = { source: 'added', database: { port: 8080 } };
    
    await writeTestConfig('base.json5', JSON.stringify(fileConfig));
    
    try {
        const config = new ConfigManager('base.json5');
        config.addConfig(addedConfig);
        await config.load();
        
        assertEquals(config.hasErrors(), false);
        const cfg = config.getConfig() as typeof fileConfig & typeof addedConfig;
        // addConfig should be merged after file configs, so it overrides
        assertEquals(cfg.source, 'added');
        assertEquals(cfg.database.host, 'file-host');
        assertEquals(cfg.database.port, 8080);
    } finally {
        await deleteTestConfig('base.json5');
    }
});

Deno.test('ConfigManager: addConfig with multiple files and configs', async () => {
    await createTestConfigDir();
    const file1 = { level: 'file1', a: 1 };
    const file2 = { level: 'file2', b: 2 };
    const added1 = { level: 'added1', c: 3 };
    const added2 = { level: 'added2', d: 4 };
    
    await writeTestConfig('multi1.json5', JSON.stringify(file1));
    await writeTestConfig('multi2.json5', JSON.stringify(file2));
    
    try {
        const config = new ConfigManager(['multi1.json5', 'multi2.json5']);
        config.addConfig(added1);
        config.addConfig(added2);
        await config.load();
        
        assertEquals(config.hasErrors(), false);
        const cfg = config.getConfig() as typeof file1 & typeof file2 & typeof added1 & typeof added2;
        // Last added config should have final say
        assertEquals(cfg.level, 'added2');
        // All unique keys should be present
        assertEquals(cfg.a, 1);
        assertEquals(cfg.b, 2);
        assertEquals(cfg.c, 3);
        assertEquals(cfg.d, 4);
    } finally {
        await deleteTestConfig('multi1.json5');
        await deleteTestConfig('multi2.json5');
    }
});

Deno.test('ConfigManager: addConfig with empty object', async () => {
    await createTestConfigDir();
    const baseConfig = { value: 'test' };
    
    const config = new ConfigManager();
    config.addConfig(baseConfig);
    config.addConfig({});
    await config.load();
    
    assertEquals(config.hasErrors(), false);
    const cfg = config.getConfig() as typeof baseConfig;
    // Empty config shouldn't affect existing values
    assertEquals(cfg.value, 'test');
});

Deno.test('ConfigManager: addConfig with nested objects', async () => {
    await createTestConfigDir();
    const config1 = { 
        app: { 
            name: 'myapp',
            settings: { theme: 'dark', lang: 'en' }
        } 
    };
    const config2 = { 
        app: { 
            settings: { theme: 'light' }
        } 
    };
    
    const config = new ConfigManager();
    config.addConfig(config1);
    config.addConfig(config2);
    await config.load();
    
    assertEquals(config.hasErrors(), false);
    const cfg = config.getConfig() as typeof config1;
    assertEquals(cfg.app.name, 'myapp');
    assertEquals(cfg.app.settings.theme, 'light'); // Overridden
    assertEquals(cfg.app.settings.lang, 'en'); // Preserved
});

Deno.test('ConfigManager: addConfig with arrays', async () => {
    await createTestConfigDir();
    const config1 = { servers: ['server1', 'server2'], ports: [8080] };
    const config2 = { servers: ['server3'], timeout: 5000 };
    
    const config = new ConfigManager();
    config.addConfig(config1);
    config.addConfig(config2);
    await config.load();
    
    assertEquals(config.hasErrors(), false);
    const cfg = config.getConfig() as typeof config1 & typeof config2;
    // Arrays should be replaced, not merged
    assertEquals(cfg.servers, ['server3']);
    assertEquals(cfg.ports, [8080]);
    assertEquals(cfg.timeout, 5000);
});

Deno.test('ConfigManager: addConfig with environment variable replacement', async () => {
    await createTestConfigDir();
    Deno.env.set('ADDED_HOST', 'env-host');
    const addedConfig = { database: { host: '$ADDED_HOST' } };
    
    const config = new ConfigManager();
    config.addConfig(addedConfig);
    await config.load();
    
    assertEquals(config.hasErrors(), false);
    const cfg = config.getConfig() as typeof addedConfig;
    assertEquals(cfg.database.host, 'env-host');
});

Deno.test('ConfigManager: addConfig with null and boolean values', async () => {
    await createTestConfigDir();
    const addedConfig = { 
        enabled: true,
        disabled: false,
        value: null,
        count: 0,
        name: ''
    };
    
    const config = new ConfigManager();
    config.addConfig(addedConfig);
    await config.load();
    
    assertEquals(config.hasErrors(), false);
    const cfg = config.getConfig() as typeof addedConfig;
    assertEquals(cfg.enabled, true);
    assertEquals(cfg.disabled, false);
    assertEquals(cfg.value, null);
    assertEquals(cfg.count, 0);
    assertEquals(cfg.name, '');
});

Deno.test('ConfigManager: addConfig with validation', async () => {
    await createTestConfigDir();
    const addedConfig = { host: 'added-host', port: 9000 };
    
    const config = new ConfigManager();
    config.addConfig(addedConfig);
    await config.load();
    
    const schema = Type.Object({ host: Type.String(), port: Type.Number() });
    const result = config.getValidatedConfig(undefined, schema);
    
    assertEquals(result.success, true);
    if (result.success) {
        const validated = result.value as typeof addedConfig;
        assertEquals(validated.host, 'added-host');
        assertEquals(validated.port, 9000);
    }
});

// Tests for file path resolution

Deno.test('ConfigManager: load config from current directory', async () => {
    const testConfig = { source: 'current-dir', value: 42 };
    const filename = 'current-dir-test.json5';
    await Deno.writeTextFile(filename, JSON.stringify(testConfig));
    
    try {
        const config = new ConfigManager(filename);
        await config.load();
        assertEquals(config.hasErrors(), false);
        const cfg = config.getConfig() as typeof testConfig;
        assertEquals(cfg.source, 'current-dir');
        assertEquals(cfg.value, 42);
    } finally {
        try {
            await Deno.remove(filename);
        } catch {
            // Ignore if file doesn't exist
        }
    }
});

Deno.test('ConfigManager: current directory takes precedence over ./config', async () => {
    await createTestConfigDir();
    const currentDirConfig = { source: 'current', priority: 'high' };
    const configDirConfig = { source: 'config', priority: 'low' };
    const filename = 'precedence-test.json5';
    
    // Write to both current directory and ./config directory
    await Deno.writeTextFile(filename, JSON.stringify(currentDirConfig));
    await writeTestConfig(filename, JSON.stringify(configDirConfig));
    
    try {
        const config = new ConfigManager(filename);
        await config.load();
        assertEquals(config.hasErrors(), false);
        const cfg = config.getConfig() as typeof currentDirConfig;
        // Should load from current directory, not ./config
        assertEquals(cfg.source, 'current');
        assertEquals(cfg.priority, 'high');
    } finally {
        try {
            await Deno.remove(filename);
        } catch {
            // Ignore if file doesn't exist
        }
        await deleteTestConfig(filename);
    }
});

Deno.test('ConfigManager: load from ./config when not in current directory', async () => {
    await createTestConfigDir();
    const testConfig = { source: 'config-dir', location: 'config' };
    const filename = 'config-only-test.json5';
    
    // Write only to ./config directory, not current directory
    await writeTestConfig(filename, JSON.stringify(testConfig));
    
    try {
        // Ensure file doesn't exist in current directory
        try {
            await Deno.remove(filename);
        } catch {
            // Already doesn't exist, which is what we want
        }
        
        const config = new ConfigManager(filename);
        await config.load();
        assertEquals(config.hasErrors(), false);
        const cfg = config.getConfig() as typeof testConfig;
        assertEquals(cfg.source, 'config-dir');
        assertEquals(cfg.location, 'config');
    } finally {
        await deleteTestConfig(filename);
    }
});

Deno.test('ConfigManager: load file with explicit path', async () => {
    // Create a test directory in a temporary location
    const testDir = './temp-test-dir';
    await Deno.mkdir(testDir, { recursive: true });
    
    const testConfig = { source: 'explicit-path', path: 'temp-test-dir' };
    const filePath = `${testDir}/explicit-path-test.json5`;
    await Deno.writeTextFile(filePath, JSON.stringify(testConfig));
    
    try {
        const config = new ConfigManager(filePath);
        await config.load();
        assertEquals(config.hasErrors(), false);
        const cfg = config.getConfig() as typeof testConfig;
        assertEquals(cfg.source, 'explicit-path');
        assertEquals(cfg.path, 'temp-test-dir');
    } finally {
        try {
            await Deno.remove(testDir, { recursive: true });
        } catch {
            // Ignore cleanup errors
        }
    }
});

Deno.test('ConfigManager: file not found in current or config directory', async () => {
    await createTestConfigDir();
    const filename = 'definitely-nonexistent-file.json5';
    
    // Ensure file doesn't exist in either location
    try {
        await Deno.remove(filename);
    } catch {
        // Already doesn't exist
    }
    try {
        await deleteTestConfig(filename);
    } catch {
        // Already doesn't exist
    }
    
    const config = new ConfigManager(filename);
    await config.load();
    assertEquals(config.hasErrors(), true);
    const errors = config.getErrors();
    assert(errors.includes('Failed to find config file'));
    assert(errors.includes('not found in current directory or ./config'));
});

Deno.test('ConfigManager: file with explicit path not found', async () => {
    const nonExistentPath = './nonexistent/path/to/file.json5';
    
    const config = new ConfigManager(nonExistentPath);
    await config.load();
    assertEquals(config.hasErrors(), true);
    const errors = config.getErrors();
    assert(errors.includes('Failed to find config file'));
});
