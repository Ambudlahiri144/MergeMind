import { createRequire } from 'node:module';

import { Language, Parser, type Tree } from 'web-tree-sitter';

import { GRAMMAR_WASM, TREE_SITTER_LANGUAGES, type TreeSitterLanguage } from './languages.js';

const require = createRequire(import.meta.url);

let initPromise: Promise<void> | undefined;
const languages = new Map<TreeSitterLanguage, Promise<Language>>();
let sharedParser: Parser | undefined;

/** `Parser.init()` once per process (it loads web-tree-sitter.wasm). */
function init(): Promise<void> {
  initPromise ??= Parser.init();
  return initPromise;
}

function loadLanguage(language: TreeSitterLanguage): Promise<Language> {
  let loaded = languages.get(language);
  if (!loaded) {
    loaded = init().then(() => Language.load(require.resolve(GRAMMAR_WASM[language])));
    languages.set(language, loaded);
  }
  return loaded;
}

/**
 * Parses with a deadline; null when the deadline cancels it. One parser is reused: `parse` is
 * synchronous, so nothing can interleave between `setLanguage` and `parse` in this thread.
 * The caller must `tree.delete()` (WASM memory is not garbage-collected).
 */
export async function parseSource(
  language: TreeSitterLanguage,
  source: string,
  timeoutMs: number,
): Promise<Tree | null> {
  const grammar = await loadLanguage(language);
  sharedParser ??= new Parser();
  const parser = sharedParser;
  parser.setLanguage(grammar);
  const deadline = performance.now() + timeoutMs;
  const tree = parser.parse(source, null, { progressCallback: () => performance.now() > deadline });
  if (tree === null) {
    parser.reset();
  }
  return tree;
}

/** Loads and parses a line in every grammar; run at worker boot so a broken install fails fast. */
export async function smokeTestGrammars(): Promise<void> {
  for (const language of TREE_SITTER_LANGUAGES) {
    const tree = await parseSource(language, 'x', 1_000);
    if (tree === null) {
      throw new Error(`tree-sitter grammar ${language} did not parse`);
    }
    tree.delete();
  }
}
