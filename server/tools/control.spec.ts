import { describe, it, expect } from 'vitest';
import { sendKeysEscape, parseKeyCombo, vkFor, sendKeysForKey } from '../tools/automation';
import { clampPercent } from '../tools/media';

describe('sendKeysEscape', () => {
	it('escapes SendKeys meta characters', () => {
		expect(sendKeysEscape('a+b^c%d~e(f)g{h}')).toBe('a{+}b{^}c{%}d{~}e{(}f{)}g{{}h{}}');
	});

	it('leaves plain text untouched', () => {
		expect(sendKeysEscape('hello world')).toBe('hello world');
	});
});

describe('parseKeyCombo', () => {
	it('parses a modifier chain', () => {
		expect(parseKeyCombo('ctrl+shift+esc')).toEqual({ mods: ['ctrl', 'shift'], key: 'esc' });
	});

	it('parses a bare key', () => {
		expect(parseKeyCombo('enter')).toEqual({ mods: [], key: 'enter' });
	});

	it('handles the win modifier', () => {
		expect(parseKeyCombo('win+r')).toEqual({ mods: ['win'], key: 'r' });
	});
});

describe('vkFor', () => {
	it('maps single characters to ASCII VK codes', () => {
		expect(vkFor('a')).toBe(0x41);
		expect(vkFor('z')).toBe(0x5a);
	});

	it('maps named keys', () => {
		expect(vkFor('enter')).toBe(0x0d);
		expect(vkFor('space')).toBe(0x20);
	});

	it('maps function keys', () => {
		expect(vkFor('f1')).toBe(0x70);
		expect(vkFor('f13')).toBe(0x7c);
	});

	it('rejects unknown keys', () => {
		expect(vkFor('zz')).toBeNull();
		expect(vkFor('')).toBeNull();
	});
});

describe('sendKeysForKey', () => {
	it('passes through alphanumerics', () => {
		expect(sendKeysForKey('a')).toBe('a');
		expect(sendKeysForKey('5')).toBe('5');
	});

	it('wraps named keys in braces', () => {
		expect(sendKeysForKey('enter')).toBe('{ENTER}');
		expect(sendKeysForKey('f5')).toBe('{F5}');
	});

	it('returns null for unsupported keys', () => {
		expect(sendKeysForKey('??')).toBeNull();
	});
});

describe('clampPercent', () => {
	it('clamps to 0..100', () => {
		expect(clampPercent(-10)).toBe(0);
		expect(clampPercent(150)).toBe(100);
		expect(clampPercent(42.4)).toBe(42);
	});
});
