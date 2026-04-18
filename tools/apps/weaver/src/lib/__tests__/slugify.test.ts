import { describe, it, expect } from 'vitest';
import { slugify, uniqueSlug } from '../slugify.js';

describe('slugify', () => {
  it('lowercases and replaces spaces', () => {
    expect(slugify('Field Theme')).toBe('field-theme');
  });

  it('strips special characters', () => {
    expect(slugify('My Song! (remix)')).toBe('my-song-remix');
  });

  it('returns "untitled" for empty input', () => {
    expect(slugify('')).toBe('untitled');
    expect(slugify('!!!')).toBe('untitled');
  });
});

describe('uniqueSlug', () => {
  it('returns base slug when no conflict', () => {
    expect(uniqueSlug('Field', ['dungeon'])).toBe('field');
  });

  it('appends -2 on first conflict', () => {
    expect(uniqueSlug('Field', ['field'])).toBe('field-2');
  });

  it('increments until unique', () => {
    expect(uniqueSlug('Field', ['field', 'field-2', 'field-3'])).toBe('field-4');
  });
});
