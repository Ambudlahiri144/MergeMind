/** Exhaustiveness check for discriminated-union switches (rules.md §2). */
export function assertNever(value: never, context = 'value'): never {
  throw new Error(`Unexpected ${context}: ${JSON.stringify(value)}`);
}
