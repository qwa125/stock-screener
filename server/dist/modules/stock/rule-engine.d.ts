import { FormulaResult, SignalEntry } from './types';
export interface RuleInput {
    formula: FormulaResult;
}
export declare function generateSignals(input: RuleInput): SignalEntry[];
