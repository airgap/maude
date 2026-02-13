/**
 * Tree-sitter Web Worker for semantic analysis.
 * Handles parsing, symbol extraction, definition/reference queries.
 * WASM files are loaded from /tree-sitter/ in the static directory.
 */

export interface Symbol {
  name: string;
  kind: 'function' | 'class' | 'method' | 'variable' | 'type' | 'interface' | 'import' | 'property';
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
  children?: Symbol[];
}

export interface Location {
  filePath?: string;
  row: number;
  col: number;
  endRow: number;
  endCol: number;
  text: string;
}

export type WorkerRequest =
  | { type: 'init' }
  | { type: 'parse'; fileId: string; content: string; language: string }
  | { type: 'symbols'; fileId: string }
  | { type: 'definitions'; fileId: string; position: { row: number; col: number } }
  | { type: 'references'; fileId: string; symbolName: string };

export type WorkerResponse =
  | { type: 'ready' }
  | { type: 'parsed'; fileId: string; symbols: Symbol[] }
  | { type: 'definitions'; fileId: string; locations: Location[] }
  | { type: 'references'; fileId: string; locations: Location[] }
  | { type: 'error'; message: string };

// We use `any` for tree-sitter types since the module typing is awkward in workers
let TreeSitter: any = null;
const parsers = new Map<string, any>();
const trees = new Map<string, any>();
const fileLanguages = new Map<string, string>();

// Language name -> grammar WASM path mapping
const grammarFiles: Record<string, string> = {
  javascript: 'tree-sitter-javascript.wasm',
  typescript: 'tree-sitter-typescript.wasm',
  python: 'tree-sitter-python.wasm',
  rust: 'tree-sitter-rust.wasm',
  cpp: 'tree-sitter-cpp.wasm',
  c: 'tree-sitter-c.wasm',
  java: 'tree-sitter-java.wasm',
  go: 'tree-sitter-go.wasm',
  html: 'tree-sitter-html.wasm',
  css: 'tree-sitter-css.wasm',
  json: 'tree-sitter-json.wasm',
  markdown: 'tree-sitter-markdown.wasm',
};

async function initTreeSitter() {
  if (TreeSitter) return;
  const mod = await import('web-tree-sitter');
  const TS = mod.default as any;
  await TS.init({
    locateFile: (file: string) => `/tree-sitter/${file}`,
  });
  TreeSitter = TS;
}

async function getParser(language: string): Promise<any | null> {
  if (parsers.has(language)) return parsers.get(language)!;
  if (!TreeSitter) return null;

  const grammarFile = grammarFiles[language];
  if (!grammarFile) return null;

  try {
    const lang = await TreeSitter.Language.load(`/tree-sitter/${grammarFile}`);
    const parser = new TreeSitter();
    parser.setLanguage(lang);
    parsers.set(language, parser);
    return parser;
  } catch (e) {
    console.warn(`Failed to load tree-sitter grammar for ${language}:`, e);
    return null;
  }
}

function extractSymbols(node: any, language: string): Symbol[] {
  const symbols: Symbol[] = [];

  function walk(n: any) {
    const sym = nodeToSymbol(n, language);
    if (sym) {
      const children: Symbol[] = [];
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i);
        if (child) {
          const childSyms = extractSymbolsFromNode(child, language);
          children.push(...childSyms);
        }
      }
      if (children.length > 0) sym.children = children;
      symbols.push(sym);
    } else {
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i);
        if (child) walk(child);
      }
    }
  }

  walk(node);
  return symbols;
}

function extractSymbolsFromNode(node: any, language: string): Symbol[] {
  const symbols: Symbol[] = [];

  function walk(n: any) {
    const sym = nodeToSymbol(n, language);
    if (sym) {
      const children: Symbol[] = [];
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i);
        if (child) children.push(...extractSymbolsFromNode(child, language));
      }
      if (children.length > 0) sym.children = children;
      symbols.push(sym);
    } else {
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i);
        if (child) walk(child);
      }
    }
  }

  walk(node);
  return symbols;
}

function nodeToSymbol(node: any, language: string): Symbol | null {
  const type = node.type;

  // TypeScript/JavaScript
  if (['javascript', 'typescript'].includes(language)) {
    if (type === 'function_declaration' || type === 'function') {
      const name = node.childForFieldName('name');
      if (name) return makeSymbol(name.text, 'function', node);
    }
    if (type === 'class_declaration') {
      const name = node.childForFieldName('name');
      if (name) return makeSymbol(name.text, 'class', node);
    }
    if (type === 'method_definition') {
      const name = node.childForFieldName('name');
      if (name) return makeSymbol(name.text, 'method', node);
    }
    if (type === 'interface_declaration' || type === 'type_alias_declaration') {
      const name = node.childForFieldName('name');
      if (name) return makeSymbol(name.text, 'interface', node);
    }
    if (type === 'lexical_declaration' || type === 'variable_declaration') {
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child && child.type === 'variable_declarator') {
          const name = child.childForFieldName('name');
          const value = child.childForFieldName('value');
          if (name) {
            const kind =
              value && (value.type === 'arrow_function' || value.type === 'function')
                ? 'function'
                : 'variable';
            return makeSymbol(name.text, kind, node);
          }
        }
      }
    }
    if (type === 'export_statement') {
      return null; // Let children be processed
    }
  }

  // Python
  if (language === 'python') {
    if (type === 'function_definition') {
      const name = node.childForFieldName('name');
      if (name) return makeSymbol(name.text, 'function', node);
    }
    if (type === 'class_definition') {
      const name = node.childForFieldName('name');
      if (name) return makeSymbol(name.text, 'class', node);
    }
  }

  // Rust
  if (language === 'rust') {
    if (type === 'function_item') {
      const name = node.childForFieldName('name');
      if (name) return makeSymbol(name.text, 'function', node);
    }
    if (type === 'struct_item' || type === 'enum_item') {
      const name = node.childForFieldName('name');
      if (name) return makeSymbol(name.text, 'type', node);
    }
    if (type === 'impl_item') {
      const typeName = node.childForFieldName('type');
      if (typeName) return makeSymbol(`impl ${typeName.text}`, 'class', node);
    }
    if (type === 'trait_item') {
      const name = node.childForFieldName('name');
      if (name) return makeSymbol(name.text, 'interface', node);
    }
  }

  return null;
}

function makeSymbol(name: string, kind: Symbol['kind'], node: any): Symbol {
  return {
    name,
    kind,
    startRow: node.startPosition.row,
    startCol: node.startPosition.column,
    endRow: node.endPosition.row,
    endCol: node.endPosition.column,
  };
}

function findDefinitions(tree: any, language: string, row: number, col: number): Location[] {
  const node = tree.rootNode.descendantForPosition({ row, column: col });
  if (!node) return [];

  const identNode =
    node.type === 'identifier' || node.type === 'property_identifier'
      ? node
      : node.parent?.type === 'identifier'
        ? node.parent
        : null;
  if (!identNode) return [];

  const name = identNode.text;
  const locations: Location[] = [];

  function walk(n: any) {
    const sym = nodeToSymbol(n, language);
    if (sym && sym.name === name) {
      locations.push({
        row: sym.startRow,
        col: sym.startCol,
        endRow: sym.endRow,
        endCol: sym.endCol,
        text: n.text.split('\n')[0].slice(0, 100),
      });
    }
    for (let i = 0; i < n.childCount; i++) {
      const child = n.child(i);
      if (child) walk(child);
    }
  }

  walk(tree.rootNode);
  return locations;
}

function findReferences(tree: any, symbolName: string): Location[] {
  const locations: Location[] = [];

  function walk(n: any) {
    if ((n.type === 'identifier' || n.type === 'property_identifier') && n.text === symbolName) {
      locations.push({
        row: n.startPosition.row,
        col: n.startPosition.column,
        endRow: n.endPosition.row,
        endCol: n.endPosition.column,
        text: n.parent?.text?.split('\n')[0].slice(0, 100) ?? symbolName,
      });
    }
    for (let i = 0; i < n.childCount; i++) {
      const child = n.child(i);
      if (child) walk(child);
    }
  }

  walk(tree.rootNode);
  return locations;
}

// Message handler
self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;

  try {
    switch (msg.type) {
      case 'init': {
        await initTreeSitter();
        self.postMessage({ type: 'ready' } satisfies WorkerResponse);
        break;
      }

      case 'parse': {
        await initTreeSitter();
        const parser = await getParser(msg.language);
        if (!parser) {
          self.postMessage({
            type: 'parsed',
            fileId: msg.fileId,
            symbols: [],
          } satisfies WorkerResponse);
          break;
        }

        const tree = parser.parse(msg.content);
        trees.set(msg.fileId, tree);
        fileLanguages.set(msg.fileId, msg.language);

        const symbols = extractSymbols(tree.rootNode, msg.language);
        self.postMessage({
          type: 'parsed',
          fileId: msg.fileId,
          symbols,
        } satisfies WorkerResponse);
        break;
      }

      case 'symbols': {
        const tree = trees.get(msg.fileId);
        const lang = fileLanguages.get(msg.fileId);
        if (!tree || !lang) {
          self.postMessage({
            type: 'parsed',
            fileId: msg.fileId,
            symbols: [],
          } satisfies WorkerResponse);
          break;
        }
        const symbols = extractSymbols(tree.rootNode, lang);
        self.postMessage({
          type: 'parsed',
          fileId: msg.fileId,
          symbols,
        } satisfies WorkerResponse);
        break;
      }

      case 'definitions': {
        const tree = trees.get(msg.fileId);
        const lang = fileLanguages.get(msg.fileId);
        if (!tree || !lang) {
          self.postMessage({
            type: 'definitions',
            fileId: msg.fileId,
            locations: [],
          } satisfies WorkerResponse);
          break;
        }
        const locations = findDefinitions(tree, lang, msg.position.row, msg.position.col);
        self.postMessage({
          type: 'definitions',
          fileId: msg.fileId,
          locations,
        } satisfies WorkerResponse);
        break;
      }

      case 'references': {
        const tree = trees.get(msg.fileId);
        if (!tree) {
          self.postMessage({
            type: 'references',
            fileId: msg.fileId,
            locations: [],
          } satisfies WorkerResponse);
          break;
        }
        const locations = findReferences(tree, msg.symbolName);
        self.postMessage({
          type: 'references',
          fileId: msg.fileId,
          locations,
        } satisfies WorkerResponse);
        break;
      }
    }
  } catch (err) {
    self.postMessage({
      type: 'error',
      message: String(err),
    } satisfies WorkerResponse);
  }
};
