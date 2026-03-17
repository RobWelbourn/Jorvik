/**
 * @fileoverview Unit tests for the cli.ts module.
 */

import { assert, assertEquals, assertExists, assertThrows } from '@std/assert';
import { Type } from 'typebox';
import {
	combineSections,
	compileSection,
	createIntro,
	displayHelp,
	displayVersion,
	getStandardOptions,
	processCommands,
	type CliData,
	type ParseOptions,
} from '../src/cli.ts';

function withDenoArgs(args: string[], fn: () => void) {
	const descriptor = Object.getOwnPropertyDescriptor(Deno, 'args');
	Object.defineProperty(Deno, 'args', {
		configurable: true,
		value: args,
	});
	try {
		fn();
	} finally {
		if (descriptor) {
			Object.defineProperty(Deno, 'args', descriptor);
		}
	}
}

function withDenoExitStub(stub: (code?: number) => never, fn: () => void) {
	const descriptor = Object.getOwnPropertyDescriptor(Deno, 'exit');
	Object.defineProperty(Deno, 'exit', {
		configurable: true,
		value: stub,
	});
	try {
		fn();
	} finally {
		if (descriptor) {
			Object.defineProperty(Deno, 'exit', descriptor);
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
	const intro = createIntro('Test intro', 'deno run app.ts [OPTIONS]');

	assertEquals(intro.lines.length, 2);
	assertEquals(intro.lines[0].column1, 'Test intro');
	assertEquals(intro.lines[1].column1, '\n%cUsage: %cdeno run app.ts [OPTIONS]');
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

	withDenoArgs(['--config', 'a.json5', '--config', 'b.json5', '--name', 'agent', '--feature'], () => {
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

	withDenoArgs(['--config'], () => {
		const result = processCommands(cliData);
		assertEquals(result.success, false);
		if (!result.success) {
			assertEquals(result.error.message, 'Config filenames must be strings');
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

	withDenoArgs(['--version'], () => {
		withDenoExitStub((code?: number): never => {
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

	withDenoArgs(['--help'], () => {
		withDenoExitStub((code?: number): never => {
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
