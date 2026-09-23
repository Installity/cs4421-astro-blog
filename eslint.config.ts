import eslintPluginAstro from "eslint-plugin-astro"

export default [
  {
    ignores: [".astro/**", "dist/**"],
  },
  // add more generic rule sets here, such as:
  // js.configs.recommended,
  ...eslintPluginAstro.configs.recommended,
  {
    files: ["*.astro", "**/*.astro"],
    languageOptions: {
      parserOptions: {
        // add this line
        project: "./tsconfig.eslint.json",

      },
    },

    rules: {
      // override/add rules settings here, such as:
      // "astro/no-set-html-directive": "error"
      "no-console": "error",
    },
    settings: {
      "import/core-modules": ["astro:content", "astro:transitions"],
      "import/parsers" : {
        "astro-eslint-parser": [".astro"],
        "espree": [".js", ".mjs", ".cjs"],
        "@typescript-eslint/parser": [".ts", ".tsx"]
      }
    }
  },
]