// Ambient types for CSS Modules so `tsc --build` resolves `import s from './X.module.scss'`.
// The default export is the class-name map (camelCased keys via the Vite
// `localsConvention: 'camelCaseOnly'` convention); typed loosely as a string
// record so both `s.cardTop` and a computed `s[key]` lookup are valid.
declare module '*.module.scss' {
  const classes: Record<string, string>
  export default classes
}

declare module '*.module.css' {
  const classes: Record<string, string>
  export default classes
}

// Plain (non-module) global stylesheet, imported for side effects only (e.g. `import './styles.css'`
// in index.ts so the library build bundles the global CSS). No exported shape.
declare module '*.css' {}
