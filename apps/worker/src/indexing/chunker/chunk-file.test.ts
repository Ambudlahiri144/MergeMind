import { describe, expect, it } from 'vitest';

import { MAX_CHUNK_CHARS, chunkFile, windowChunks } from './chunk-file.js';
import { languageForPath } from './languages.js';
import { smokeTestGrammars } from './tree-sitter.js';

function summary(chunks: { symbol: string; kind: string; startLine: number; endLine: number }[]) {
  return chunks.map((chunk) => `${chunk.kind} ${chunk.symbol} ${chunk.startLine}-${chunk.endLine}`);
}

describe('tree-sitter grammars', () => {
  it('loads and parses every bundled grammar', async () => {
    await expect(smokeTestGrammars()).resolves.toBeUndefined();
  });
});

describe('chunkFile: TypeScript', () => {
  const source = [
    "import { db } from './db';", // 1
    '', // 2
    'export class UserService {', // 3
    '  private readonly table = "users";', // 4
    '  async save(user: User) {', // 5
    '    await db.insert(this.table, user);', // 6
    '  }', // 7
    '  remove = async (id: string) => db.delete(id);', // 8
    '}', // 9
    '', // 10
    'export const findUser = async (id: string) => db.find(id);', // 11
    'export interface User { id: string }', // 12
    'type Id = string;', // 13
    'function save() {}', // 14
  ].join('\n');

  it('emits methods, functions, types, the class residual and module code', async () => {
    const result = await chunkFile('src/users.ts', source);

    expect(result?.language).toBe('typescript');
    expect(summary(result?.chunks ?? [])).toEqual([
      'method UserService.save 5-7',
      'method UserService.remove 8-8',
      'class UserService 3-9',
      'function findUser 11-11',
      'interface User 12-12',
      'type Id 13-13',
      'function save 14-14',
      'module module 1-2',
    ]);
  });

  it('keeps the export keyword, strips member bodies from the class residual, and names by last segment', async () => {
    const chunks = (await chunkFile('src/users.ts', source))?.chunks ?? [];

    const residual = chunks.find((chunk) => chunk.symbol === 'UserService');
    expect(residual?.content).toContain('export class UserService {');
    expect(residual?.content).toContain('private readonly table');
    expect(residual?.content).not.toContain('db.insert');
    expect(chunks.find((chunk) => chunk.symbol === 'UserService.save')?.name).toBe('save');
  });

  it('parses TSX and JavaScript', async () => {
    const tsx = await chunkFile('src/App.tsx', 'export function App() {\n  return <div />;\n}');
    const js = await chunkFile('src/a.mjs', 'function a() {}\nclass B { m() {} }');

    expect(summary(tsx?.chunks ?? [])).toEqual(['function App 1-3']);
    // One-line class: its method covers every line, so there is no class residual chunk.
    expect(summary(js?.chunks ?? [])).toEqual(['function a 1-1', 'method B.m 2-2']);
  });
});

describe('chunkFile: Python, Go, Java', () => {
  it('includes decorators and qualifies methods (Python)', async () => {
    const source = [
      '@cache',
      'def load():',
      '    return 1',
      '',
      'class Repo:',
      '    def get(self):',
      '        return 2',
    ].join('\n');

    expect(summary((await chunkFile('app/repo.py', source))?.chunks ?? [])).toEqual([
      'function load 1-3',
      'method Repo.get 6-7',
      'class Repo 5-7',
    ]);
  });

  it('qualifies methods by receiver type (Go)', async () => {
    const source = [
      'package store',
      '',
      'type Store struct{}',
      '',
      'func (s *Store) Save() error {',
      '\treturn nil',
      '}',
      '',
      'func New() *Store { return &Store{} }',
    ].join('\n');

    expect(summary((await chunkFile('store/store.go', source))?.chunks ?? [])).toEqual([
      'type Store 3-3',
      'method Store.Save 5-7',
      'function New 9-9',
      'module module 1-2',
    ]);
  });

  it('emits constructors and methods inside classes (Java)', async () => {
    const source = [
      'class Account {',
      '  Account() {}',
      '  void debit(int amount) {',
      '    balance -= amount;',
      '  }',
      '}',
    ].join('\n');

    expect(summary((await chunkFile('src/Account.java', source))?.chunks ?? [])).toEqual([
      'method Account.Account 2-2',
      'method Account.debit 3-5',
      'class Account 1-6',
    ]);
  });
});

describe('chunkFile: fallbacks and limits', () => {
  it('suffixes repeated symbols', async () => {
    const result = await chunkFile('src/a.ts', 'function a() {}\nfunction a() {}');

    expect(result?.chunks.map((chunk) => chunk.symbol)).toEqual(['a', 'a#2']);
  });

  it('splits an oversized symbol at line boundaries', async () => {
    const body = Array.from(
      { length: 400 },
      (_, index) => `  const v${index} = "${'x'.repeat(40)}";`,
    );
    const source = ['function big() {', ...body, '}'].join('\n');

    const chunks = (await chunkFile('src/big.ts', source))?.chunks ?? [];

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.content.length <= MAX_CHUNK_CHARS)).toBe(true);
    expect(chunks.map((chunk) => chunk.symbol).slice(0, 2)).toEqual(['big', 'big#part2']);
    expect(chunks.at(-1)?.endLine).toBe(402);
  });

  it('uses line windows for languages without a grammar and for files without symbols', async () => {
    const ruby = await chunkFile('lib/a.rb', Array.from({ length: 70 }, () => 'puts 1').join('\n'));
    const script = await chunkFile('scripts/run.js', 'console.log(1);\nconsole.log(2);');

    expect(summary(ruby?.chunks ?? [])).toEqual([
      'window lines:1-60 1-60',
      'window lines:61-70 61-70',
    ]);
    expect(script?.chunks.map((chunk) => chunk.kind)).toEqual(['window']);
  });

  it('returns null for files that are not code', async () => {
    expect(await chunkFile('README.md', '# hi')).toBeNull();
    expect(await chunkFile('types/global.d.ts', 'declare const x: number;')).toBeNull();
  });

  it('skips blank windows', () => {
    expect(windowChunks('\n\n\n', 2)).toEqual([]);
  });

  it('maps extensions to languages', () => {
    expect(languageForPath('a/b.tsx')).toEqual({ kind: 'tree-sitter', language: 'tsx' });
    expect(languageForPath('a/b.rs')).toEqual({ kind: 'windows', language: 'rs' });
    expect(languageForPath('a/b.png')).toEqual({ kind: 'none' });
  });
});
