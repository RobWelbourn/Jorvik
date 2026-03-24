/**
 * @fileoverview Unit tests for the cli.ts module.
 */

import { assert, assertEquals, assertExists, assertThrows } from '@std/assert';
import process from 'node:process';
import { Type } from 'typebox';
import {
	combineSections,
	compileSection,
	createIntro,
	displayHelp,
	displayVersion,
	getStandardOptions,
	getRuntimeEnvironment,
	getPalette,
	setPalette,
	processCommands,
	type CliData,
	type Palette,
	type ParseOptions,
} from '../src/cli.ts';

function withProcessArgs(args: string[], fn: () => void) {
	const descriptor = Object.getOwnPropertyDescriptor(process, 'argv');
	Object.defineProperty(process, 'argv', {
		configurable: true,
		value: ['node', 'app.js', ...args],
	});
	try {
		fn();
	} finally {
		if (descriptor) {
			Object.defineProperty(process, 'argv', descriptor);
		}
	}
}

function withProcessExitStub(stub: (code?: number) => never, fn: () => void) {
	const descriptor = Object.getOwnPropertyDescriptor(process, 'exit');
	Object.defineProperty(process, 'exit', {
		configurable: true,
		value: stub,
	});
	try {
		fn();
	} finally {
		if (descriptor) {
			Object.defineProperty(process, 'exit', descriptor);
		}
	}
}

function withConsoleLogCapture(fn: (calls: unknown[][]) => void) {
	const calls: unknown[][] = [];
	const original = console.log;
	console.log = (...args: unknown[]) => {
		calls.push(args);
	};
	try {
		fn(calls);
	} finally {
		console.log = original;
	}
}

Deno.test('compileSection: collects option lines and parse metadata', () => {
	const schema = Type.Object({
		service: Type.Object({
			enabled: Type.Boolean({ description: 'Enable service', default: false }),
			mode: Type.String({ description: 'Mode', enum: ['fast', 'safe'], default: 'safe' }),
			tags: Type.Array(Type.String({ description: 'Tags' })),
		}, {
			title: 'Service options',
			description: 'Service configuration'
		})
	});

	const compiled = compileSection(undefined, schema);
	const lines = compiled.lines;
	const parseOptions = compiled.parseOptions as ParseOptions;

	assert(lines.some(line => line.column1 === '\n%cService options'));
	assert(lines.some(line => line.column1 === 'Service configuration'));
	assert(lines.some(line => line.column1.includes('--service.enabled')));
	assert(lines.some(line => line.column1.includes('--service.mode')));
	assert(lines.some(line => line.column1.includes('--service.tags')));

	const modeLine = lines.find(line => line.column1.includes('--service.mode'));
	assertExists(modeLine);
	assertExists(modeLine.column2);
	assert(modeLine.column2.includes('options: %cfast safe%c'));
	assert(modeLine.column2.includes('default: %csafe%c'));

	assertEquals(parseOptions.negatable, ['service.enabled']);
	assertEquals(parseOptions.collect, ['service.tags']);
});

Deno.test('getStandardOptions: returns expected aliases and help lines', () => {
	const standard = getStandardOptions();

	assertEquals(standard.parseOptions?.boolean, ['help', 'version']);
	assertEquals(standard.parseOptions?.string, ['config', 'c']);
	assertEquals(standard.parseOptions?.collect, ['config', 'c']);
	assertEquals(standard.parseOptions?.alias, { help: 'h', version: 'v', config: 'c' });
	assert(standard.lines.some(line => line.column1.includes('--help, -h')));
	assert(standard.lines.some(line => line.column1.includes('--version, -v')));
	assert(standard.lines.some(line => line.column1.includes('--config, -c')));
});

Deno.test('createIntro: uses explicit intro and usage when provided', () => {
	const intro = createIntro('Test intro', 'node app.js [OPTIONS]');

	assertEquals(intro.lines.length, 2);
	assertEquals(intro.lines[0].column1, 'Test intro');
	assertEquals(intro.lines[1].column1, '\n%cUsage: %cnode app.js [OPTIONS]');
});

Deno.test('getRuntimeEnvironment: returns deno when running in Deno tests', () => {
	assertEquals(getRuntimeEnvironment(), 'deno');
});

Deno.test('createIntro: default usage reflects runtime environment', () => {
	const intro = createIntro('Runtime intro');
	const runtime = getRuntimeEnvironment();
	const expectedPrefix = runtime === 'deno' ? '\n%cUsage: %cdeno ' : '\n%cUsage: %cnode ';

	assertEquals(intro.lines.length, 2);
	assertEquals(intro.lines[0].column1, 'Runtime intro');
	assert((intro.lines[1].column1 as string).startsWith(expectedPrefix));
	assert((intro.lines[1].column1 as string).endsWith(' [OPTIONS]'));
});

Deno.test('combineSections: merges lines and parse options', () => {
	const sectionA: CliData = {
		lines: [{ column1: 'A1' }],
		parseOptions: {
			boolean: ['help'],
			negatable: ['enabled'],
			string: [],
			collect: ['config'],
			default: { enabled: true },
			alias: { help: 'h' },
		},
	};
	const sectionB: CliData = {
		lines: [{ column1: 'B1' }],
		parseOptions: {
			boolean: ['version'],
			negatable: ['feature'],
			string: [],
			collect: ['tag'],
			default: { retries: 2 },
			alias: { version: 'v' },
		},
	};

	const combined = combineSections([sectionA, sectionB]);

	assertEquals(combined.lines.map(l => l.column1), ['A1', 'B1']);
	assertEquals(combined.parseOptions?.boolean, ['help', 'version']);
	assertEquals(combined.parseOptions?.negatable, ['enabled', 'feature']);
	assertEquals(combined.parseOptions?.collect, ['config', 'tag']);
	assertEquals(combined.parseOptions?.default, { enabled: true, retries: 2 });
	assertEquals(combined.parseOptions?.alias, { help: 'h', version: 'v' });
});

Deno.test('displayHelp: logs padded multi-column and plain lines', () => {
	const lines = [
		{
			column1: '  %c--alpha',
			column2: '%cAlpha option',
			format: ['color: green', 'display: revert'],
		},
		{
			column1: 'Single line text'
		},
		{
			column1: '  %c--beta',
			column2: '%cBeta option',
			format: ['color: green', 'display: revert'],
		},
	];

	withConsoleLogCapture((calls) => {
		displayHelp(lines);
		assertEquals(calls.length, 3);

		assertEquals(calls[0][0], '  %c--alpha  %cAlpha option');
		assertEquals(calls[0][1], 'color: green');
		assertEquals(calls[0][2], 'display: revert');

		assertEquals(calls[1][0], 'Single line text');

		assertEquals(calls[2][0], '  %c--beta   %cBeta option');
	});
});

Deno.test('displayVersion: logs package name and version', () => {
	withConsoleLogCapture((calls) => {
		displayVersion();
		assertEquals(calls.length, 1);
		assertEquals(calls[0].length, 2);
		assertEquals(typeof calls[0][0], 'string');
		assertEquals(typeof calls[0][1], 'string');
		assert((calls[0][0] as string).length > 0);
		assert((calls[0][1] as string).length > 0);
	});
});

Deno.test('processCommands: returns config files and additional config', () => {
	const cliData: CliData = {
		lines: [{ column1: 'help' }],
		parseOptions: {
			boolean: ['help', 'version'],
			negatable: ['feature'],
			string: ['config', 'name'],
			collect: ['config'],
			default: {},
			alias: { help: 'h', version: 'v', config: 'c' },
		},
	};

	withProcessArgs(['--config', 'a.json5', '--config', 'b.json5', '--name', 'agent', '--feature'], () => {
		const result = processCommands(cliData);
		assertEquals(result.success, true);
		if (result.success) {
			assertEquals(result.value.configFiles, ['a.json5', 'b.json5']);
			assertEquals(result.value.additionalConfig, { name: 'agent', feature: true });
		}
	});
});

Deno.test('processCommands: returns failure for non-string config entries', () => {
	const cliData: CliData = {
		lines: [{ column1: 'help' }],
		parseOptions: {
			boolean: ['help', 'version'],
			negatable: [],
			string: [],
			collect: ['config'],
			default: {},
			alias: { help: 'h', version: 'v', config: 'c' },
		},
	};

	withProcessArgs(['--config'], () => {
		const result = processCommands(cliData);
		assertEquals(result.success, false);
		if (!result.success) {
			assertEquals(result.error, 'Config filenames must be strings');
		}
	});
});

Deno.test('processCommands: triggers displayVersion and exits when --version is present', () => {
	const cliData: CliData = {
		lines: [{ column1: 'help' }],
		parseOptions: {
			boolean: ['help', 'version'],
			negatable: [],
			string: ['config'],
			collect: ['config'],
			default: {},
			alias: { help: 'h', version: 'v', config: 'c' },
		},
	};

	withProcessArgs(['--version'], () => {
		withProcessExitStub((code?: number): never => {
			throw new Error(`exit:${code ?? ''}`);
		}, () => {
			withConsoleLogCapture(() => {
				assertThrows(() => processCommands(cliData), Error, 'exit:0');
			});
		});
	});
});

Deno.test('processCommands: triggers displayHelp and exits when --help is present', () => {
	const cliData: CliData = {
		lines: [{ column1: 'Usage line' }],
		parseOptions: {
			boolean: ['help', 'version'],
			negatable: [],
			string: ['config'],
			collect: ['config'],
			default: {},
			alias: { help: 'h', version: 'v', config: 'c' },
		},
	};

	withProcessArgs(['--help'], () => {
		withProcessExitStub((code?: number): never => {
			throw new Error(`exit:${code ?? ''}`);
		}, () => {
			withConsoleLogCapture((calls) => {
				assertThrows(() => processCommands(cliData), Error, 'exit:0');
				assertEquals(calls.length, 1);
				assertEquals(calls[0][0], 'Usage line');
			});
		});
	});
});

Deno.test('getPalette: returns default palette with expected keys', () => {
	const palette = getPalette();
	
	assertEquals(palette.default, 'display: revert');
	assertEquals(palette.section, 'color: yellow');
	assertEquals(palette.option, 'color: green');
	assertEquals(palette.value, 'color: cyan; font-weight: bold');
	assertEquals(palette.usage, 'color: gray');
});

Deno.test('getPalette: returns a deep copy of the palette', () => {
	const palette1 = getPalette();
	const palette2 = getPalette();
	
	// Should be equal in content
	assertEquals(palette1, palette2);
	
	// But not the same object reference
	assert(palette1 !== palette2);
});

Deno.test('getPalette: returns independent copies even after modifications', () => {
	const originalPalette = getPalette();
	
	// Modify the returned copy
	const modifiedCopy = getPalette();
	modifiedCopy.option = 'color: red';
	
	// Original should not be affected
	const afterModify = getPalette();
	assertEquals(afterModify.option, 'color: green');
	assertEquals(originalPalette.option, 'color: green');
});

Deno.test('setPalette: updates a single color in the palette', () => {
	const originalPalette = getPalette();
	assertEquals(originalPalette.section, 'color: yellow');
	
	setPalette({ section: 'color: magenta' });
	
	const after = getPalette();
	assertEquals(after.section, 'color: magenta');
	
	// Reset to original for other tests
	setPalette({ section: 'color: yellow' });
});

Deno.test('setPalette: updates multiple colors in the palette', () => {
	setPalette({ 
		section: 'color: red',
		option: 'color: blue',
		value: 'color: orange'
	});
	
	const after = getPalette();
	assertEquals(after.section, 'color: red');
	assertEquals(after.option, 'color: blue');
	assertEquals(after.value, 'color: orange');
	// Other values should be unchanged
	assertEquals(after.default, 'display: revert');
	assertEquals(after.usage, 'color: gray');
	
	// Reset for other tests
	setPalette({
		section: 'color: yellow',
		option: 'color: green',
		value: 'color: cyan; font-weight: bold'
	});
});

Deno.test('setPalette: preserves unchanged palette values', () => {
	const before = getPalette();
	const originalUsage = before.usage;
	
	// Only update one color
	setPalette({ section: 'color: purple' });
	
	const after = getPalette();
	assertEquals(after.usage, originalUsage);
	assertEquals(after.option, 'color: green');
	assertEquals(after.value, 'color: cyan; font-weight: bold');
	assertEquals(after.default, 'display: revert');
	
	// Reset
	setPalette({ section: 'color: yellow' });
});

Deno.test('getPalette: reflects changes made by setPalette', () => {
	const newValue = 'color: pink; text-decoration: underline';
	setPalette({ value: newValue });
	
	const palette = getPalette();
	assertEquals(palette.value, newValue);
	
	// Reset
	setPalette({ value: 'color: cyan; font-weight: bold' });
});

Deno.test('setPalette: with empty partial palette does nothing', () => {
	const beforePalette = getPalette();
	
	setPalette({});
	
	const afterPalette = getPalette();
	assertEquals(beforePalette, afterPalette);
});

Deno.test('setPalette: can set all palette values to custom strings', () => {
	const customPalette: Palette = {
		default: 'font-weight: bold',
		section: 'color: cyan',
		option: 'color: gray',
		value: 'font-style: italic',
		usage: 'color: green'
	};
	
	setPalette(customPalette);
	
	const result = getPalette();
	assertEquals(result, customPalette);
	
	// Reset to original
	setPalette({
		default: 'display: revert',
		section: 'color: yellow',
		option: 'color: green',
		value: 'color: cyan; font-weight: bold',
		usage: 'color: gray'
	});
});
