module.exports = {
  root: true,
  // Without this, `npm run lint` fails with a few hundred errors the
  // moment anyone has run `npm run build` — eslint walks the bundled
  // output. The errors are meaningless and they bury real ones.
  ignorePatterns: ["dist", "node_modules"],
  env: { browser: true, es2021: true },
  extends: ["eslint:recommended", "plugin:react/recommended", "plugin:react-hooks/recommended"],
  parserOptions: { ecmaVersion: "latest", sourceType: "module", ecmaFeatures: { jsx: true } },
  settings: { react: { version: "detect" } },
  rules: {
    "react/prop-types": "off",
    "react/react-in-jsx-scope": "off",
  },
  overrides: [
    {
      files: ["server/**/*.js", "src/**/*.test.js"],
      env: { browser: false, node: true, es2021: true },
    },
    {
      // Playwright drivers: node at the top level, browser inside page.evaluate.
      files: ["scripts/**/*.mjs"],
      env: { browser: true, node: true, es2021: true },
    },
  ],
};
