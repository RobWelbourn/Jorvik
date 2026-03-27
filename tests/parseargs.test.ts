import { assertEquals } from '@std/assert';
import { parseArgs } from '../src/parseargs.ts';

Deno.test('parseArgs: parses long flags and positional arguments', () => {
    const parsed = parseArgs(['--name=jorvik', '--port', '8080', 'input.json']);

    assertEquals(parsed.name, 'jorvik');
    assertEquals(parsed.port, 8080);
    assertEquals(parsed._, ['input.json']);
});

Deno.test('parseArgs: coerces numeric and hexadecimal values', () => {
    const parsed = parseArgs(['--decimal', '12.5', '--hex', '0x1f', '42']);

    assertEquals(parsed.decimal, 12.5);
    assertEquals(parsed.hex, 31);
    assertEquals(parsed._, [42]);
});

Deno.test('parseArgs: resolves aliases and grouped short flags', () => {
    const parsed = parseArgs(['-h', '-abc'], {
        alias: {
            help: 'h',
            aFlag: 'a'
        }
    });

    assertEquals(parsed.help, true);
    assertEquals(parsed.aFlag, true);
    assertEquals(parsed.b, true);
    assertEquals(parsed.c, true);
});

Deno.test('parseArgs: supports nested keys via dotted flags', () => {
    const parsed = parseArgs(['--service.host', 'localhost', '--service.port', '9000']);

    assertEquals(parsed.service, {
        host: 'localhost',
        port: 9000
    });
});

Deno.test('parseArgs: collects repeated flags and comma-delimited values', () => {
    const parsed = parseArgs(['--tag', 'alpha,beta', '--tag', 'gamma'], {
        collect: ['tag']
    });

    assertEquals(parsed.tag, ['alpha', 'beta', 'gamma']);
});

Deno.test('parseArgs: treats collect flag with no value as empty array', () => {
    const parsed = parseArgs(['--tag'], {
        collect: ['tag']
    });

    assertEquals(parsed.tag, []);
});

Deno.test('parseArgs: treats non-collect flag with no value as true', () => {
    const parsed = parseArgs(['--verbose']);

    assertEquals(parsed.verbose, true);
});

Deno.test('parseArgs: does not treat standalone double-dash as separator', () => {
    const parsed = parseArgs(['--', '--name', 'jorvik']);

    assertEquals(parsed._, ['--']);
    assertEquals(parsed.name, 'jorvik');
});
