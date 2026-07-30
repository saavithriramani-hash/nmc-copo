import type ExcelJS from 'exceljs';

/**
 * An independent spreadsheet formula evaluator, written for the
 * round-trip test.
 *
 * THE POINT: it NEVER reads a cell's cached result. A formula cell is
 * evaluated by parsing its formula and recursively resolving the cells it
 * references, bottoming out only at literal values. So if the workbook's
 * formulas disagree with the engine's numbers, this catches it — which is
 * exactly the guarantee the export must provide.
 *
 * Supports the subset the exporter emits: numbers, strings, cell
 * references (sheet-qualified or local, with or without $), ranges,
 * + - * / ^, comparisons, and IF / AND / OR / SUM / AVERAGE / COUNT.
 */

export type Value = number | string | boolean | null;

interface Token {
  kind: 'number' | 'string' | 'ref' | 'func' | 'op' | 'punct' | 'name';
  text: string;
  sheet?: string;
}

const CELL_RE = /^\$?[A-Za-z]{1,3}\$?\d{1,7}$/;

function tokenize(formula: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  const readCellAddress = (): string => {
    const start = i;
    while (i < formula.length && /[A-Za-z0-9$]/.test(formula[i]!)) i += 1;
    return formula.slice(start, i);
  };

  while (i < formula.length) {
    const char = formula[i]!;
    if (/\s/.test(char)) {
      i += 1;
      continue;
    }

    // number
    if (/[0-9]/.test(char) || (char === '.' && /[0-9]/.test(formula[i + 1] ?? ''))) {
      const start = i;
      while (i < formula.length && /[0-9.]/.test(formula[i]!)) i += 1;
      tokens.push({ kind: 'number', text: formula.slice(start, i) });
      continue;
    }

    // string literal, "" escapes an embedded quote
    if (char === '"') {
      i += 1;
      let text = '';
      while (i < formula.length) {
        if (formula[i] === '"') {
          if (formula[i + 1] === '"') {
            text += '"';
            i += 2;
            continue;
          }
          i += 1;
          break;
        }
        text += formula[i];
        i += 1;
      }
      tokens.push({ kind: 'string', text });
      continue;
    }

    // quoted sheet name → must be followed by ! and a cell address
    if (char === "'") {
      i += 1;
      let sheet = '';
      while (i < formula.length) {
        if (formula[i] === "'") {
          if (formula[i + 1] === "'") {
            sheet += "'";
            i += 2;
            continue;
          }
          i += 1;
          break;
        }
        sheet += formula[i];
        i += 1;
      }
      if (formula[i] !== '!') throw new Error(`Expected ! after sheet name '${sheet}' in: ${formula}`);
      i += 1;
      tokens.push({ kind: 'ref', text: readCellAddress(), sheet });
      continue;
    }

    // identifier: sheet name, function name, bare cell reference, or TRUE/FALSE
    if (/[A-Za-z_$]/.test(char)) {
      const start = i;
      while (i < formula.length && /[A-Za-z0-9_$.]/.test(formula[i]!)) i += 1;
      const word = formula.slice(start, i);
      if (formula[i] === '!') {
        i += 1;
        tokens.push({ kind: 'ref', text: readCellAddress(), sheet: word });
      } else if (formula[i] === '(') {
        tokens.push({ kind: 'func', text: word.toUpperCase() });
      } else if (CELL_RE.test(word)) {
        tokens.push({ kind: 'ref', text: word });
      } else {
        tokens.push({ kind: 'name', text: word.toUpperCase() });
      }
      continue;
    }

    // operators and punctuation
    const two = formula.slice(i, i + 2);
    if (two === '<>' || two === '>=' || two === '<=') {
      tokens.push({ kind: 'op', text: two });
      i += 2;
      continue;
    }
    if ('+-*/^=<>&'.includes(char)) {
      tokens.push({ kind: 'op', text: char });
      i += 1;
      continue;
    }
    if ('(),:'.includes(char)) {
      tokens.push({ kind: 'punct', text: char });
      i += 1;
      continue;
    }
    throw new Error(`Unexpected character '${char}' in formula: ${formula}`);
  }
  return tokens;
}

const normalizeAddress = (address: string): string => address.replace(/\$/g, '').toUpperCase();

/** Column letters → 1-based index, for expanding ranges. */
function columnIndex(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}
function columnLetters(index: number): string {
  let n = index;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}
function splitAddress(address: string): { col: number; row: number } {
  const match = /^([A-Za-z]+)(\d+)$/.exec(normalizeAddress(address));
  if (!match) throw new Error(`Bad cell address: ${address}`);
  return { col: columnIndex(match[1]!), row: Number(match[2]) };
}

const numbersOnly = (values: Value[]): number[] =>
  values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));

export class FormulaEvaluator {
  private readonly cache = new Map<string, Value>();
  private readonly visiting = new Set<string>();

  constructor(private readonly workbook: ExcelJS.Workbook) {}

  /** Evaluates the cell at `address` on `sheetName`, ignoring cached results. */
  cell(sheetName: string, address: string): Value {
    const key = `${sheetName}!${normalizeAddress(address)}`;
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;
    if (this.visiting.has(key)) throw new Error(`Circular reference at ${key}`);
    this.visiting.add(key);

    const sheet = this.workbook.getWorksheet(sheetName);
    if (!sheet) throw new Error(`No such sheet: ${sheetName}`);
    const cell = sheet.getCell(normalizeAddress(address));
    const raw = cell.value as unknown;

    let value: Value;
    if (raw && typeof raw === 'object' && 'sharedFormula' in (raw as object)) {
      throw new Error(`Shared formula at ${key}; the exporter should write each formula individually`);
    }
    if (raw && typeof raw === 'object' && 'formula' in (raw as object)) {
      // Deliberately ignore (raw as CellFormulaValue).result — the whole
      // point is to recompute from the formula and its precedents.
      const formula = String((raw as { formula: string }).formula);
      value = this.evaluate(formula, sheetName);
    } else if (typeof raw === 'number' || typeof raw === 'string' || typeof raw === 'boolean') {
      value = raw;
    } else if (raw && typeof raw === 'object' && 'richText' in (raw as object)) {
      value = (raw as { richText: { text: string }[] }).richText.map((part) => part.text).join('');
    } else {
      value = null;
    }

    this.visiting.delete(key);
    this.cache.set(key, value);
    return value;
  }

  /** Parses and evaluates a formula string in the context of a sheet. */
  evaluate(formula: string, contextSheet: string): Value {
    const tokens = tokenize(formula.replace(/^=/, ''));
    const parser = new Parser(tokens, contextSheet, this);
    const value = parser.parseExpression();
    parser.expectEnd();
    return value;
  }

  /** Expands a range into its cell values (used by SUM/AVERAGE/COUNT). */
  range(sheetName: string, from: string, to: string): Value[] {
    const a = splitAddress(from);
    const b = splitAddress(to);
    const values: Value[] = [];
    for (let row = Math.min(a.row, b.row); row <= Math.max(a.row, b.row); row += 1) {
      for (let col = Math.min(a.col, b.col); col <= Math.max(a.col, b.col); col += 1) {
        values.push(this.cell(sheetName, `${columnLetters(col)}${row}`));
      }
    }
    return values;
  }
}

/** Recursive-descent parser that evaluates as it goes. */
class Parser {
  private position = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly contextSheet: string,
    private readonly evaluator: FormulaEvaluator,
  ) {}

  expectEnd(): void {
    if (this.position < this.tokens.length) {
      throw new Error(`Unexpected trailing token '${this.tokens[this.position]!.text}'`);
    }
  }

  private peek(): Token | undefined {
    return this.tokens[this.position];
  }
  private next(): Token {
    const token = this.tokens[this.position];
    if (!token) throw new Error('Unexpected end of formula');
    this.position += 1;
    return token;
  }
  private eatPunct(text: string): boolean {
    const token = this.peek();
    if (token && token.kind === 'punct' && token.text === text) {
      this.position += 1;
      return true;
    }
    return false;
  }

  parseExpression(): Value {
    return this.parseComparison();
  }

  private parseComparison(): Value {
    let left = this.parseAdditive();
    for (;;) {
      const token = this.peek();
      if (!token || token.kind !== 'op' || !['=', '<>', '>', '<', '>=', '<='].includes(token.text)) break;
      this.position += 1;
      const right = this.parseAdditive();
      left = compare(left, right, token.text);
    }
    return left;
  }

  private parseAdditive(): Value {
    let left = this.parseMultiplicative();
    for (;;) {
      const token = this.peek();
      if (!token || token.kind !== 'op' || (token.text !== '+' && token.text !== '-')) break;
      this.position += 1;
      const right = this.parseMultiplicative();
      left = token.text === '+' ? num(left) + num(right) : num(left) - num(right);
    }
    return left;
  }

  private parseMultiplicative(): Value {
    let left = this.parsePower();
    for (;;) {
      const token = this.peek();
      if (!token || token.kind !== 'op' || (token.text !== '*' && token.text !== '/')) break;
      this.position += 1;
      const right = this.parsePower();
      if (token.text === '*') left = num(left) * num(right);
      else {
        const divisor = num(right);
        if (divisor === 0) throw new Error('Division by zero in formula');
        left = num(left) / divisor;
      }
    }
    return left;
  }

  private parsePower(): Value {
    const base = this.parseUnary();
    const token = this.peek();
    if (token && token.kind === 'op' && token.text === '^') {
      this.position += 1;
      return num(base) ** num(this.parsePower());
    }
    return base;
  }

  private parseUnary(): Value {
    const token = this.peek();
    if (token && token.kind === 'op' && (token.text === '-' || token.text === '+')) {
      this.position += 1;
      const value = this.parseUnary();
      return token.text === '-' ? -num(value) : num(value);
    }
    return this.parsePrimary();
  }

  private parsePrimary(): Value {
    const token = this.next();

    if (token.kind === 'number') return Number(token.text);
    if (token.kind === 'string') return token.text;
    if (token.kind === 'name') {
      if (token.text === 'TRUE') return true;
      if (token.text === 'FALSE') return false;
      throw new Error(`Unknown name '${token.text}'`);
    }
    if (token.kind === 'punct' && token.text === '(') {
      const value = this.parseExpression();
      if (!this.eatPunct(')')) throw new Error('Expected )');
      return value;
    }
    if (token.kind === 'ref') {
      const sheet = token.sheet ?? this.contextSheet;
      if (this.peek()?.kind === 'punct' && this.peek()!.text === ':') {
        throw new Error('A range may only appear as a direct function argument');
      }
      return this.evaluator.cell(sheet, token.text);
    }
    if (token.kind === 'func') {
      if (!this.eatPunct('(')) throw new Error(`Expected ( after ${token.text}`);
      const args: Value[][] = [];
      if (!this.eatPunct(')')) {
        for (;;) {
          args.push(this.parseArgument());
          if (this.eatPunct(',')) continue;
          if (this.eatPunct(')')) break;
          throw new Error(`Expected , or ) in ${token.text}`);
        }
      }
      return applyFunction(token.text, args);
    }
    throw new Error(`Unexpected token '${token.text}'`);
  }

  /**
   * A function argument may be a RANGE (`Sheet!$B$5:$B$9`), which yields
   * many values. Detected by lookahead — ref, ':', ref — before falling
   * back to a normal single-valued expression.
   */
  private parseArgument(): Value[] {
    const first = this.peek();
    const separator = this.tokens[this.position + 1];
    const second = this.tokens[this.position + 2];
    if (
      first?.kind === 'ref' &&
      separator?.kind === 'punct' &&
      separator.text === ':' &&
      second?.kind === 'ref'
    ) {
      this.position += 3;
      const sheet = first.sheet ?? this.contextSheet;
      return this.evaluator.range(sheet, first.text, second.text);
    }
    return [this.parseExpression()];
  }
}

function num(value: Value): number {
  if (typeof value === 'number') return value;
  if (value === null || value === '') return 0;
  if (typeof value === 'boolean') return value ? 1 : 0;
  const parsed = Number(value);
  if (Number.isNaN(parsed)) throw new Error(`Cannot use '${value}' as a number`);
  return parsed;
}

function compare(left: Value, right: Value, operator: string): boolean {
  // Excel treats an empty cell as "" when compared with a string and as 0
  // when compared with a number.
  let a = left;
  let b = right;
  if (typeof a === 'string' || typeof b === 'string') {
    a = a === null ? '' : a;
    b = b === null ? '' : b;
    if (typeof a === 'number' || typeof b === 'number') {
      // number vs text: in Excel every number sorts before any text.
      const aIsText = typeof a === 'string';
      const bIsText = typeof b === 'string';
      if (aIsText !== bIsText) {
        switch (operator) {
          case '=':
            return false;
          case '<>':
            return true;
          case '<':
          case '<=':
            return !aIsText;
          default:
            return aIsText;
        }
      }
    }
    const as = String(a);
    const bs = String(b);
    switch (operator) {
      case '=':
        return as === bs;
      case '<>':
        return as !== bs;
      case '>':
        return as > bs;
      case '<':
        return as < bs;
      case '>=':
        return as >= bs;
      default:
        return as <= bs;
    }
  }
  const an = num(a);
  const bn = num(b);
  switch (operator) {
    case '=':
      return an === bn;
    case '<>':
      return an !== bn;
    case '>':
      return an > bn;
    case '<':
      return an < bn;
    case '>=':
      return an >= bn;
    default:
      return an <= bn;
  }
}

function applyFunction(name: string, args: Value[][]): Value {
  const flat = args.flat();
  switch (name) {
    case 'IF': {
      const condition = args[0]?.[0] ?? null;
      const truthy = typeof condition === 'boolean' ? condition : num(condition) !== 0;
      const branch = truthy ? args[1] : args[2];
      return branch === undefined ? (truthy ? true : false) : (branch[0] ?? null);
    }
    case 'AND':
      return flat.every((value) => (typeof value === 'boolean' ? value : num(value) !== 0));
    case 'OR':
      return flat.some((value) => (typeof value === 'boolean' ? value : num(value) !== 0));
    case 'SUM':
      return numbersOnly(flat).reduce((sum, value) => sum + value, 0);
    case 'AVERAGE': {
      const values = numbersOnly(flat);
      if (values.length === 0) throw new Error('AVERAGE over no numeric values (#DIV/0!)');
      return values.reduce((sum, value) => sum + value, 0) / values.length;
    }
    case 'COUNT':
      return numbersOnly(flat).length;
    case 'ROUND': {
      const value = num(args[0]?.[0] ?? 0);
      const digits = num(args[1]?.[0] ?? 0);
      const factor = 10 ** digits;
      return Math.round(value * factor) / factor;
    }
    default:
      throw new Error(`Unsupported function in export formula: ${name}`);
  }
}
