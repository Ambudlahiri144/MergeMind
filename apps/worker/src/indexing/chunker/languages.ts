import type { ChunkKind } from '@mergemind/db';

/** Languages chunked by symbol with tree-sitter (ADR-024). */
export const TREE_SITTER_LANGUAGES = [
  'typescript',
  'tsx',
  'javascript',
  'python',
  'go',
  'java',
] as const;
export type TreeSitterLanguage = (typeof TREE_SITTER_LANGUAGES)[number];

/** Grammar wasm inside each official npm package (pinned exactly in package.json). */
export const GRAMMAR_WASM: Record<TreeSitterLanguage, string> = {
  typescript: 'tree-sitter-typescript/tree-sitter-typescript.wasm',
  tsx: 'tree-sitter-typescript/tree-sitter-tsx.wasm',
  javascript: 'tree-sitter-javascript/tree-sitter-javascript.wasm',
  python: 'tree-sitter-python/tree-sitter-python.wasm',
  go: 'tree-sitter-go/tree-sitter-go.wasm',
  java: 'tree-sitter-java/tree-sitter-java.wasm',
};

const EXTENSION_LANGUAGE: Record<string, TreeSitterLanguage> = {
  '.ts': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.tsx': 'tsx',
  '.js': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.jsx': 'javascript',
  '.py': 'python',
  '.go': 'go',
  '.java': 'java',
};

/** Code we index with line windows only (no grammar bundled). */
const WINDOW_ONLY_EXTENSIONS = new Set([
  '.rb',
  '.rs',
  '.c',
  '.h',
  '.cc',
  '.cpp',
  '.hpp',
  '.cs',
  '.php',
  '.kt',
  '.kts',
  '.swift',
  '.scala',
  '.vue',
  '.svelte',
  '.sql',
  '.sh',
]);

export type PathLanguage =
  | { kind: 'tree-sitter'; language: TreeSitterLanguage }
  | { kind: 'windows'; language: string }
  | { kind: 'none' };

export function languageForPath(path: string): PathLanguage {
  const dot = path.lastIndexOf('.');
  const extension = dot === -1 ? '' : path.slice(dot).toLowerCase();
  if (path.endsWith('.d.ts')) {
    return { kind: 'none' };
  }
  const language = EXTENSION_LANGUAGE[extension];
  if (language !== undefined) {
    return { kind: 'tree-sitter', language };
  }
  return WINDOW_ONLY_EXTENSIONS.has(extension)
    ? { kind: 'windows', language: extension.slice(1) }
    : { kind: 'none' };
}

/**
 * Which syntax nodes are symbols. Node types verified against each grammar's node-types.json at
 * the pinned versions (research 2026-10-06).
 */
export type LanguageSpec = {
  /** Symbols at file level. */
  topLevel: Readonly<Record<string, ChunkKind>>;
  /** Scopes whose `body` holds members (classes and friends). */
  containers: Readonly<Record<string, ChunkKind>>;
  /** Symbols inside a container body. */
  members: Readonly<Record<string, ChunkKind>>;
  /** Wrapper node → field holding the real declaration; the wrapper's range is used. */
  wrappers: Readonly<Record<string, string>>;
  /** Variable declarations whose function-valued declarators count as functions. */
  variableDeclarations: readonly string[];
  /** Value node types that make a declarator (or class field) a function. */
  functionValues: readonly string[];
};

const ECMASCRIPT_SPEC: LanguageSpec = {
  topLevel: {
    function_declaration: 'function',
    generator_function_declaration: 'function',
    interface_declaration: 'interface',
    type_alias_declaration: 'type',
    enum_declaration: 'type',
  },
  containers: { class_declaration: 'class', abstract_class_declaration: 'class' },
  members: { method_definition: 'method' },
  wrappers: { export_statement: 'declaration' },
  variableDeclarations: ['lexical_declaration', 'variable_declaration'],
  functionValues: ['arrow_function', 'function_expression', 'function', 'generator_function'],
};

export const LANGUAGE_SPECS: Record<TreeSitterLanguage, LanguageSpec> = {
  typescript: ECMASCRIPT_SPEC,
  tsx: ECMASCRIPT_SPEC,
  javascript: ECMASCRIPT_SPEC,
  python: {
    topLevel: { function_definition: 'function' },
    containers: { class_definition: 'class' },
    members: { function_definition: 'method' },
    wrappers: { decorated_definition: 'definition' },
    variableDeclarations: [],
    functionValues: [],
  },
  go: {
    topLevel: {
      function_declaration: 'function',
      method_declaration: 'method',
      type_declaration: 'type',
    },
    containers: {},
    members: {},
    wrappers: {},
    variableDeclarations: [],
    functionValues: [],
  },
  java: {
    topLevel: {},
    containers: {
      class_declaration: 'class',
      interface_declaration: 'interface',
      enum_declaration: 'class',
      record_declaration: 'class',
    },
    members: { method_declaration: 'method', constructor_declaration: 'method' },
    wrappers: {},
    variableDeclarations: [],
    functionValues: [],
  },
};
