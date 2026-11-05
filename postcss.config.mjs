// The dark-mode plugin runs after Tailwind, so it sees every utility and component class (scripts/dark-mode).
const config = { plugins: { tailwindcss: {}, autoprefixer: {}, "./scripts/dark-mode/postcss-dark-mode.cjs": {} } };

export default config;
