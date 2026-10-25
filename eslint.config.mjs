import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const config = [
  { ignores: [".next/**", "node_modules/**", ".data/**", "next-env.d.ts", "playwright-report/**", "test-results/**"] },
  ...nextVitals,
  ...nextTypescript,
  { rules: { "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }] } },
];

export default config;
