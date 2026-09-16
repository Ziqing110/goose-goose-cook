module.exports = {
  root: true,
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
      files: ["server/**/*.js", "voice-lab/server.js"],
      env: { browser: false, node: true, es2021: true },
    },
    {
      // AudioWorklet runs in its own global scope — no window, and
      // sampleRate / AudioWorkletProcessor / registerProcessor are
      // provided by the worklet runtime rather than the page.
      files: ["voice-lab/pcm-processor.js"],
      env: { browser: false, es2021: true },
      globals: {
        AudioWorkletProcessor: "readonly",
        registerProcessor: "readonly",
        sampleRate: "readonly",
        currentTime: "readonly",
      },
    },
  ],
};
