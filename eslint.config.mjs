import tseslint from 'typescript-eslint';

export default tseslint.config(
  // BLOCK 1: Global Ignores (Must be first and have NO other keys)
  {
    ignores: ["dist/**", "node_modules/**"]
  },
  
  // BLOCK 2: Main Config
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parserOptions: {
        projectService: true, // This enables the high-speed 2026 service
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': 'warn',
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'warn'
    }
  }
);