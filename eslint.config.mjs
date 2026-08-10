import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Local legacy backup already excluded from TypeScript and Git.
    "copy file/**",
  ]),
  {
    // The legacy dashboard is an effect-driven client monolith and the React
    // Compiler is not enabled in this application. Keep the compiler-oriented
    // hook rules active everywhere else while this page is extracted into
    // smaller hooks/components; changing its orchestration during a release
    // cleanup would alter live market behavior.
    files: ["app/HomeClient.tsx"],
    rules: {
      "react-hooks/exhaustive-deps": "off",
      "react-hooks/immutability": "off",
      "react-hooks/purity": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
]);

export default eslintConfig;
