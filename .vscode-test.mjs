import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
    // Pattern to find your compiled test files in the 'dist' folder
    files: 'dist/test/**/*.test.js', 
    mocha: {
        ui: 'tdd',       // Recommended for VS Code extensions
        timeout: 20000   // Give it time to launch the Extension Development Host
    }
});