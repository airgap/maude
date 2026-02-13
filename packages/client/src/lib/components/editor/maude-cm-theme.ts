import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';

/**
 * CM6 theme that reads from CSS custom properties (--syn-*, --bg-*, etc.)
 * so it automatically adapts to all 6 Maude themes.
 */
export const maudeEditorTheme = EditorView.theme(
  {
    '&': {
      height: '100%',
      fontSize: '13px',
      backgroundColor: 'var(--bg-code)',
      color: 'var(--text-primary)',
      fontFamily: 'var(--font-family)',
    },
    '.cm-content': {
      caretColor: 'var(--accent-primary)',
      padding: '8px 0',
      fontFamily: 'var(--font-family)',
      lineHeight: '1.6',
    },
    '.cm-cursor, .cm-dropCursor': {
      borderLeftColor: 'var(--accent-primary)',
      borderLeftWidth: '2px',
    },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
      backgroundColor: 'var(--bg-selection)',
    },
    '.cm-panels': {
      backgroundColor: 'var(--bg-secondary)',
      color: 'var(--text-primary)',
      borderColor: 'var(--border-primary)',
    },
    '.cm-panels.cm-panels-top': {
      borderBottom: '1px solid var(--border-primary)',
    },
    '.cm-panels.cm-panels-bottom': {
      borderTop: '1px solid var(--border-primary)',
    },
    '.cm-searchMatch': {
      backgroundColor: 'rgba(0, 180, 255, 0.2)',
      outline: '1px solid rgba(0, 180, 255, 0.4)',
    },
    '.cm-searchMatch.cm-searchMatch-selected': {
      backgroundColor: 'rgba(0, 180, 255, 0.35)',
    },
    '.cm-activeLine': {
      backgroundColor: 'var(--bg-hover)',
    },
    '.cm-selectionMatch': {
      backgroundColor: 'rgba(0, 180, 255, 0.12)',
    },
    '&.cm-focused .cm-matchingBracket': {
      backgroundColor: 'rgba(0, 180, 255, 0.2)',
      outline: '1px solid var(--accent-primary)',
    },
    '&.cm-focused .cm-nonmatchingBracket': {
      backgroundColor: 'rgba(255, 51, 68, 0.2)',
    },
    '.cm-gutters': {
      backgroundColor: 'var(--bg-secondary)',
      color: 'var(--text-tertiary)',
      borderRight: '1px solid var(--border-secondary)',
      fontFamily: 'var(--font-family)',
      fontSize: '12px',
    },
    '.cm-activeLineGutter': {
      backgroundColor: 'var(--bg-hover)',
      color: 'var(--text-secondary)',
    },
    '.cm-foldPlaceholder': {
      backgroundColor: 'var(--bg-tertiary)',
      border: '1px solid var(--border-primary)',
      color: 'var(--text-tertiary)',
    },
    '.cm-tooltip': {
      backgroundColor: 'var(--bg-elevated)',
      border: '1px solid var(--border-primary)',
      color: 'var(--text-primary)',
      boxShadow: 'var(--shadow)',
    },
    '.cm-tooltip .cm-tooltip-arrow:before': {
      borderTopColor: 'var(--border-primary)',
      borderBottomColor: 'var(--border-primary)',
    },
    '.cm-tooltip .cm-tooltip-arrow:after': {
      borderTopColor: 'var(--bg-elevated)',
      borderBottomColor: 'var(--bg-elevated)',
    },
    '.cm-tooltip-autocomplete': {
      '& > ul > li[aria-selected]': {
        backgroundColor: 'var(--bg-active)',
        color: 'var(--text-primary)',
      },
    },
    // Search panel inputs
    '.cm-panel input': {
      backgroundColor: 'var(--bg-input)',
      color: 'var(--text-primary)',
      border: '1px solid var(--border-primary)',
      fontFamily: 'var(--font-family)',
    },
    '.cm-panel button': {
      color: 'var(--text-secondary)',
    },
    // Scrollbar styling
    '.cm-scroller': {
      fontFamily: 'var(--font-family)',
      overflow: 'auto',
    },
  },
  { dark: true },
);

/**
 * Syntax highlighting using CSS custom properties.
 * We can't use var() in HighlightStyle directly, so we use computed colors
 * that match our theme system. The theme is applied via the EditorView theme above.
 */
export const maudeHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: 'var(--syn-keyword)' },
  { tag: tags.controlKeyword, color: 'var(--syn-keyword)' },
  { tag: tags.operatorKeyword, color: 'var(--syn-keyword)' },
  { tag: tags.definitionKeyword, color: 'var(--syn-keyword)' },
  { tag: tags.moduleKeyword, color: 'var(--syn-keyword)' },
  { tag: tags.operator, color: 'var(--syn-operator)' },
  { tag: tags.string, color: 'var(--syn-string)' },
  { tag: tags.special(tags.string), color: 'var(--syn-string)' },
  { tag: tags.regexp, color: 'var(--syn-string)' },
  { tag: tags.number, color: 'var(--syn-number)' },
  { tag: tags.bool, color: 'var(--syn-number)' },
  { tag: tags.null, color: 'var(--syn-number)' },
  { tag: tags.function(tags.variableName), color: 'var(--syn-function)' },
  { tag: tags.function(tags.propertyName), color: 'var(--syn-function)' },
  { tag: tags.definition(tags.function(tags.variableName)), color: 'var(--syn-function)' },
  { tag: tags.comment, color: 'var(--syn-comment)', fontStyle: 'italic' },
  { tag: tags.lineComment, color: 'var(--syn-comment)', fontStyle: 'italic' },
  { tag: tags.blockComment, color: 'var(--syn-comment)', fontStyle: 'italic' },
  { tag: tags.docComment, color: 'var(--syn-comment)', fontStyle: 'italic' },
  { tag: tags.typeName, color: 'var(--syn-type)' },
  { tag: tags.typeOperator, color: 'var(--syn-type)' },
  { tag: tags.className, color: 'var(--syn-type)' },
  { tag: tags.namespace, color: 'var(--syn-type)' },
  { tag: tags.variableName, color: 'var(--syn-variable)' },
  { tag: tags.definition(tags.variableName), color: 'var(--syn-variable)' },
  { tag: tags.propertyName, color: 'var(--syn-variable)' },
  { tag: tags.attributeName, color: 'var(--syn-variable)' },
  { tag: tags.labelName, color: 'var(--syn-variable)' },
  { tag: tags.tagName, color: 'var(--syn-keyword)' },
  { tag: tags.angleBracket, color: 'var(--syn-operator)' },
  { tag: tags.attributeValue, color: 'var(--syn-string)' },
  { tag: tags.meta, color: 'var(--syn-comment)' },
  { tag: tags.processingInstruction, color: 'var(--syn-comment)' },
  { tag: tags.punctuation, color: 'var(--text-secondary)' },
  { tag: tags.paren, color: 'var(--text-secondary)' },
  { tag: tags.squareBracket, color: 'var(--text-secondary)' },
  { tag: tags.brace, color: 'var(--text-secondary)' },
  { tag: tags.separator, color: 'var(--text-secondary)' },
  { tag: tags.invalid, color: 'var(--accent-error)' },
  { tag: tags.self, color: 'var(--syn-keyword)' },
  { tag: tags.atom, color: 'var(--syn-number)' },
  { tag: tags.unit, color: 'var(--syn-number)' },
  { tag: tags.heading, color: 'var(--syn-function)', fontWeight: 'bold' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strong, fontWeight: 'bold' },
  { tag: tags.link, color: 'var(--text-link)', textDecoration: 'underline' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
]);

export const maudeSyntaxHighlighting = syntaxHighlighting(maudeHighlightStyle);
