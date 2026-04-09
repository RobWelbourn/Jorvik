/**
 * @fileoverview Shared test helpers for the Jorvik test suite.
 */

import process from 'node:process';
import { Type } from 'typebox';

export function withProcessArgs(args: string[], fn: () => void): void {
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

export function withProcessExitStub(stub: (code?: number) => never, fn: () => void): void {
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

export function withConsoleLogCapture(fn: (calls: unknown[][]) => void): void {
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

export function createTestSchema() {
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

export function createTopLevelMetadataSchema() {
    return Type.Object({
        name: Type.String({ description: 'Agent name' }),
    }, {
        title: 'Application options',
        description: 'Top-level schema description',
    });
}
