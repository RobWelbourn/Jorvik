/**
 * @fileoverview Unit tests for the cli.ts module.
 */

import { assert, assertEquals, assertThrows } from '@std/assert';
import process from 'node:process';
import { Type } from 'typebox';
import {
	Cli,
	getRuntimeEnvironment,
	getPalette,
	setPalette,
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

function createTestSchema() {
	return Type.Object({
name: Type.String({ description: 'Agent name' }),
feature: Type.Boolean({ description: 'Enable feature' }),
tags: Type.Array(Type.String({ description: 'Tag list' })),
service: Type.Object({
enabled: Type.Boolean({ description: 'Enable service', default: false }),
mode: Type.String({ description: 'Mode', enum: ['fast', 'safe'], default: 'safe' }),
}, {
title: 'Service options',
description: 'Service configuration',
}),
});
}

Deno.test('getRuntimeEnvironment: returns deno when running in Deno tests', () => {
	assertEquals(getRuntimeEnvironment(), 'deno');
});

Deno.test('Cli.processCommands: returns config files and additional config', () => {
	const cli = new Cli(createTestSchema());

	withProcessArgs(['--config', 'a.json5', '--config', 'b.json5', '--name', 'agent', '--feature'], () => {
		const result = cli.processCommands();
		assertEquals(result.success, true);
		if (result.success) {
			assertEquals(result.value.configFiles, ['a.json5', 'b.json5']);
			assertEquals(result.value.additionalConfig, { name: 'agent', feature: true });
		}
	});
});

Deno.test('Cli.processCommands: returns failure for non-string config entries', () => {
	const cli = new Cli(createTestSchema());

	withProcessArgs(['--config', '42'], () => {
		const result = cli.processCommands();
		assertEquals(result.success, false);
		if (!result.success) {
			assertEquals(result.error, 'Config filenames must be strings');
		}
	});
});

Deno.test('Cli.processCommands: triggers displayVersion and exits when --version is present', () => {
	const cli = new Cli(createTestSchema());

	withProcessArgs(['--version'], () => {
		withProcessExitStub((code?: number): never => {
			throw new Error(`exit:${code ?? ''}`);
		}, () => {
			withConsoleLogCapture(() => {
				assertThrows(() => cli.processCommands(), Error, 'exit:0');
			});
		});
	});
});

Deno.test('Cli.processCommands: triggers displayHelp and exits when --help is present', () => {
	const cli = new Cli(createTestSchema(), { intro: 'Usage line', usage: 'node app.js [OPTIONS]' });

	withProcessArgs(['--help'], () => {
		withProcessExitStub((code?: number): never => {
			throw new Error(`exit:${code ?? ''}`);
		}, () => {
			withConsoleLogCapture((calls) => {
				assertThrows(() => cli.processCommands(), Error, 'exit:0');
				assert(calls.length > 0);
				assertEquals(calls[0][0], 'Usage line');
			});
		});
	});
});

Deno.test('Cli.processCommands: triggers displayVersion and exits when -v is present', () => {
	const cli = new Cli(createTestSchema());

	withProcessArgs(['-v'], () => {
		withProcessExitStub((code?: number): never => {
			throw new Error(`exit:${code ?? ''}`);
		}, () => {
			withConsoleLogCapture(() => {
				assertThrows(() => cli.processCommands(), Error, 'exit:0');
			});
		});
	});
});

Deno.test('Cli.processCommands: triggers displayHelp and exits when -h is present', () => {
	const cli = new Cli(createTestSchema(), { intro: 'Usage line', usage: 'node app.js [OPTIONS]' });

	withProcessArgs(['-h'], () => {
		withProcessExitStub((code?: number): never => {
			throw new Error(`exit:${code ?? ''}`);
		}, () => {
			withConsoleLogCapture((calls) => {
				assertThrows(() => cli.processCommands(), Error, 'exit:0');
				assert(calls.length > 0);
				assertEquals(calls[0][0], 'Usage line');
			});
		});
	});
});

Deno.test('Cli.processCommands: returns config files with long form --config', () => {
	const cli = new Cli(createTestSchema());

	withProcessArgs(['--config', 'test.json5'], () => {
		const result = cli.processCommands();
		assertEquals(result.success, true);
		if (result.success) {
			assertEquals(result.value.configFiles, ['test.json5']);
		}
	});
});

Deno.test('Cli.processCommands: returns config files with short form -c', () => {
	const cli = new Cli(createTestSchema());

	withProcessArgs(['-c', 'test.json5'], () => {
		const result = cli.processCommands();
		assertEquals(result.success, true);
		if (result.success) {
			assertEquals(result.value.configFiles, ['test.json5']);
		}
	});
});

Deno.test('Cli.processCommands: returns multiple config files with long form --config', () => {
	const cli = new Cli(createTestSchema());

	withProcessArgs(['--config', 'a.json5', '--config', 'b.json5'], () => {
		const result = cli.processCommands();
		assertEquals(result.success, true);
		if (result.success) {
			assertEquals(result.value.configFiles, ['a.json5', 'b.json5']);
		}
	});
});

Deno.test('Cli.processCommands: returns multiple config files with short form -c', () => {
	const cli = new Cli(createTestSchema());

	withProcessArgs(['-c', 'a.json5', '-c', 'b.json5'], () => {
		const result = cli.processCommands();
		assertEquals(result.success, true);
		if (result.success) {
			assertEquals(result.value.configFiles, ['a.json5', 'b.json5']);
		}
	});
});

Deno.test('Cli.processCommands: returns mixed config files using both long and short forms', () => {
	const cli = new Cli(createTestSchema());

	withProcessArgs(['--config', 'a.json5', '-c', 'b.json5'], () => {
		const result = cli.processCommands();
		assertEquals(result.success, true);
		if (result.success) {
			assertEquals(result.value.configFiles, ['a.json5', 'b.json5']);
		}
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

	assertEquals(palette1, palette2);
	assert(palette1 !== palette2);
});

Deno.test('getPalette: returns independent copies even after modifications', () => {
	const originalPalette = getPalette();

	const modifiedCopy = getPalette();
	modifiedCopy.option = 'color: red';

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

	setPalette({ section: 'color: yellow' });
});

Deno.test('setPalette: updates multiple colors in the palette', () => {
	setPalette({
section: 'color: red',
option: 'color: blue',
value: 'color: orange',
});

	const after = getPalette();
	assertEquals(after.section, 'color: red');
	assertEquals(after.option, 'color: blue');
	assertEquals(after.value, 'color: orange');
	assertEquals(after.default, 'display: revert');
	assertEquals(after.usage, 'color: gray');

	setPalette({
section: 'color: yellow',
option: 'color: green',
value: 'color: cyan; font-weight: bold',
});
});

Deno.test('setPalette: preserves unchanged palette values', () => {
	const before = getPalette();
	const originalUsage = before.usage;

	setPalette({ section: 'color: purple' });

	const after = getPalette();
	assertEquals(after.usage, originalUsage);
	assertEquals(after.option, 'color: green');
	assertEquals(after.value, 'color: cyan; font-weight: bold');
	assertEquals(after.default, 'display: revert');

	setPalette({ section: 'color: yellow' });
});

Deno.test('getPalette: reflects changes made by setPalette', () => {
	const newValue = 'color: pink; text-decoration: underline';
	setPalette({ value: newValue });

	const palette = getPalette();
	assertEquals(palette.value, newValue);

	setPalette({ value: 'color: cyan; font-weight: bold' });
});

Deno.test('setPalette: with empty partial palette does nothing', () => {
	const beforePalette = getPalette();

	setPalette({});

	const afterPalette = getPalette();
	assertEquals(beforePalette, afterPalette);
});
