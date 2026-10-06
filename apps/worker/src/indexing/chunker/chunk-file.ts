import type { ChunkKind } from '@mergemind/db';
import type { Node } from 'web-tree-sitter';

import { LANGUAGE_SPECS, languageForPath, type LanguageSpec } from './languages.js';
import { parseSource } from './tree-sitter.js';

/** ~1,500 tokens (Architecture.md §4 `codeChunks.content` cap), at ~4 chars per token. */
export const MAX_CHUNK_CHARS = 6_000;
export const WINDOW_LINES = 60;
const PARSE_TIMEOUT_MS = 2_000;

export type FileChunk = {
  symbol: string;
  name: string;
  kind: ChunkKind;
  startLine: number;
  endLine: number;
  content: string;
};

export type ChunkedFile = { language: string; chunks: FileChunk[] };

type SymbolRange = {
  qualifiedName: string;
  name: string;
  kind: ChunkKind;
  startLine: number;
  endLine: number;
  children: SymbolRange[];
};

function namedChildren(node: Node): Node[] {
  return node.namedChildren;
}

function lineSpan(node: Node): { startLine: number; endLine: number } {
  return { startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1 };
}

/** Go receivers qualify methods: `func (s *Store) Save()` → `Store.Save`. */
function goReceiverType(node: Node): string | null {
  const receiver = node.childForFieldName('receiver');
  const text = receiver?.text
    .replace(/[()*\s]/g, ' ')
    .trim()
    .split(/\s+/)
    .at(-1);
  return text?.replace(/\[.*$/, '') ?? null;
}

function symbolName(node: Node): string {
  if (node.type === 'type_declaration') {
    const spec = namedChildren(node).find(
      (child) => child.type === 'type_spec' || child.type === 'type_alias',
    );
    return spec?.childForFieldName('name')?.text ?? 'type';
  }
  const name = node.childForFieldName('name')?.text;
  if (node.type === 'method_declaration' && node.childForFieldName('receiver')) {
    const receiver = goReceiverType(node);
    return receiver ? `${receiver}.${name ?? 'method'}` : (name ?? 'method');
  }
  return name ?? `${node.type}@${node.startPosition.row + 1}`;
}

function unwrap(node: Node, spec: LanguageSpec): Node | null {
  const field = spec.wrappers[node.type];
  if (field === undefined) {
    return node;
  }
  return (
    node.childForFieldName(field) ??
    namedChildren(node).find((child) => child.type !== 'decorator') ??
    null
  );
}

function functionDeclarators(node: Node, spec: LanguageSpec): Node[] {
  return namedChildren(node).filter((declarator) => {
    const value = declarator.childForFieldName('value');
    return (
      declarator.type === 'variable_declarator' &&
      value !== null &&
      spec.functionValues.includes(value.type)
    );
  });
}

/** Walks file-level (or container-level) nodes and returns symbol ranges, nested. */
function collectSymbols(
  parent: Node,
  spec: LanguageSpec,
  scope: string[],
  isMember: boolean,
): SymbolRange[] {
  const symbols: SymbolRange[] = [];
  const add = (rangeNode: Node, name: string, kind: ChunkKind, children: SymbolRange[] = []) => {
    const qualifiedName = [...scope, name].join('.');
    symbols.push({
      qualifiedName,
      name: name.split('.').at(-1) ?? name,
      kind,
      ...lineSpan(rangeNode),
      children,
    });
  };

  for (const child of namedChildren(parent)) {
    const target = unwrap(child, spec);
    if (target === null) {
      continue;
    }
    const containerKind = spec.containers[target.type];
    if (containerKind !== undefined) {
      const name = symbolName(target);
      const body = target.childForFieldName('body');
      const members = body ? collectSymbols(body, spec, [...scope, name], true) : [];
      add(child, name, containerKind, members);
      continue;
    }
    const kind = (isMember ? spec.members : spec.topLevel)[target.type];
    if (kind !== undefined) {
      add(child, symbolName(target), kind);
      continue;
    }
    if (!isMember && spec.variableDeclarations.includes(target.type)) {
      for (const declarator of functionDeclarators(target, spec)) {
        add(child, declarator.childForFieldName('name')?.text ?? 'function', 'function');
      }
      continue;
    }
    if (isMember && target.type === 'public_field_definition') {
      const value = target.childForFieldName('value');
      if (value !== null && spec.functionValues.includes(value.type)) {
        add(child, target.childForFieldName('name')?.text ?? 'field', 'method');
      }
    }
  }
  return symbols;
}

function sliceLines(lines: readonly string[], startLine: number, endLine: number): string {
  return lines.slice(startLine - 1, endLine).join('\n');
}

/** Lines of [start, end] not covered by `covered`, as contiguous runs. */
function uncoveredRuns(
  start: number,
  end: number,
  covered: readonly { startLine: number; endLine: number }[],
): { startLine: number; endLine: number }[] {
  const runs: { startLine: number; endLine: number }[] = [];
  let runStart: number | null = null;
  for (let line = start; line <= end + 1; line += 1) {
    const isCovered =
      line > end || covered.some((range) => line >= range.startLine && line <= range.endLine);
    if (!isCovered && runStart === null) {
      runStart = line;
    }
    if (isCovered && runStart !== null) {
      runs.push({ startLine: runStart, endLine: line - 1 });
      runStart = null;
    }
  }
  return runs;
}

/** Splits oversized content at line boundaries: `save`, `save#part2`, ... */
function splitOversized(chunk: FileChunk): FileChunk[] {
  if (chunk.content.length <= MAX_CHUNK_CHARS) {
    return [chunk];
  }
  const parts: FileChunk[] = [];
  const lines = chunk.content.split('\n');
  let buffer: string[] = [];
  let partStart = chunk.startLine;
  const flush = (endLine: number) => {
    if (buffer.length === 0) {
      return;
    }
    const index = parts.length + 1;
    parts.push({
      ...chunk,
      symbol: index === 1 ? chunk.symbol : `${chunk.symbol}#part${index}`,
      startLine: partStart,
      endLine,
      content: buffer.join('\n'),
    });
    buffer = [];
  };
  lines.forEach((line, offset) => {
    const lineNumber = chunk.startLine + offset;
    if (buffer.join('\n').length + line.length + 1 > MAX_CHUNK_CHARS && buffer.length > 0) {
      flush(lineNumber - 1);
      partStart = lineNumber;
    }
    buffer.push(line.slice(0, MAX_CHUNK_CHARS));
  });
  flush(chunk.endLine);
  return parts;
}

/** Plain line windows: for languages without a grammar, and as the parse-failure fallback. */
export function windowChunks(source: string, windowLines = WINDOW_LINES): FileChunk[] {
  const lines = source.split('\n');
  const chunks: FileChunk[] = [];
  for (let start = 1; start <= lines.length; start += windowLines) {
    const end = Math.min(lines.length, start + windowLines - 1);
    const content = sliceLines(lines, start, end);
    if (content.trim() !== '') {
      chunks.push({
        symbol: `lines:${start}-${end}`,
        name: `lines:${start}-${end}`,
        kind: 'window',
        startLine: start,
        endLine: end,
        content,
      });
    }
  }
  return chunks.flatMap(splitOversized);
}

function toChunks(symbols: readonly SymbolRange[], lines: readonly string[]): FileChunk[] {
  const chunks: FileChunk[] = [];
  for (const symbol of symbols) {
    if (symbol.children.length === 0) {
      chunks.push({
        symbol: symbol.qualifiedName,
        name: symbol.name,
        kind: symbol.kind,
        startLine: symbol.startLine,
        endLine: symbol.endLine,
        content: sliceLines(lines, symbol.startLine, symbol.endLine),
      });
      continue;
    }
    chunks.push(...toChunks(symbol.children, lines));
    // The container's own lines (header, fields) without its members.
    const residual = uncoveredRuns(symbol.startLine, symbol.endLine, symbol.children)
      .map((run) => sliceLines(lines, run.startLine, run.endLine))
      .join('\n');
    if (residual.trim() !== '') {
      chunks.push({
        symbol: symbol.qualifiedName,
        name: symbol.name,
        kind: symbol.kind,
        startLine: symbol.startLine,
        endLine: symbol.endLine,
        content: residual,
      });
    }
  }
  return chunks;
}

/** Repeated qualified names (overloads, re-declarations) get `#2`, `#3`, ... */
function dedupeSymbols(chunks: readonly FileChunk[]): FileChunk[] {
  const seen = new Map<string, number>();
  return chunks.map((chunk) => {
    const count = (seen.get(chunk.symbol) ?? 0) + 1;
    seen.set(chunk.symbol, count);
    return count === 1 ? chunk : { ...chunk, symbol: `${chunk.symbol}#${count}` };
  });
}

/**
 * Splits a file into symbol chunks (tree-sitter, ADR-024): functions, methods, classes (their
 * non-member lines), interfaces and types, plus `module` chunks for top-level code outside any
 * symbol. Falls back to line windows for other languages, timeouts, or files with no symbols.
 * Returns null for files that are not indexable code.
 */
export async function chunkFile(path: string, source: string): Promise<ChunkedFile | null> {
  const pathLanguage = languageForPath(path);
  if (pathLanguage.kind === 'none') {
    return null;
  }
  if (pathLanguage.kind === 'windows') {
    return { language: pathLanguage.language, chunks: windowChunks(source) };
  }
  const { language } = pathLanguage;
  const tree = await parseSource(language, source, PARSE_TIMEOUT_MS);
  if (tree === null) {
    return { language, chunks: windowChunks(source) };
  }
  try {
    const symbols = collectSymbols(tree.rootNode, LANGUAGE_SPECS[language], [], false);
    if (symbols.length === 0) {
      return { language, chunks: windowChunks(source) };
    }
    const lines = source.split('\n');
    const moduleChunks = uncoveredRuns(1, lines.length, symbols)
      .filter((run) => sliceLines(lines, run.startLine, run.endLine).trim() !== '')
      .map((run) => ({
        symbol: 'module',
        name: 'module',
        kind: 'module' as const,
        startLine: run.startLine,
        endLine: run.endLine,
        content: sliceLines(lines, run.startLine, run.endLine),
      }));
    const chunks = dedupeSymbols(
      [...toChunks(symbols, lines), ...moduleChunks].flatMap(splitOversized),
    );
    return { language, chunks };
  } finally {
    tree.delete();
  }
}
