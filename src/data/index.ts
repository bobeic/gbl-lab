// Browser-safe barrel: the Node-only loadDefaultGameData lives in ./node.
export { loadGameData } from './loader';
export * from './types';
export { FORM_CHANGE_CORRECTIONS, type FormChangeCorrection } from './corrections';
