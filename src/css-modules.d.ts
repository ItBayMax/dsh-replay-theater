/**
 * CSS-module typing: each `*.module.css` import yields a class-name map.
 * Mirrors how the upstream client packages type their CSS modules.
 */
declare module '*.module.css' {
  const classes: Readonly<Record<string, string>>
  export default classes
}
