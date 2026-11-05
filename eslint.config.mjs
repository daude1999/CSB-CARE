import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

const config = [
  { ignores: [".next/**", "node_modules/**", ".data/**", "next-env.d.ts", "playwright-report/**", "test-results/**", "public/pdfjs/**"] },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  // Build-time CommonJS helpers (the PostCSS dark-mode plugin) load each other with require().
  { files: ["scripts/**/*.cjs"], rules: { "@typescript-eslint/no-require-imports": "off" } },
  { rules: { "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }] } },
];

export default config;
