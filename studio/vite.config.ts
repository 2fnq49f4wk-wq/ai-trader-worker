import path from "path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Library build: one classic script (IIFE) the site loads on demand — no module/CSP surprises.
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  build: {
    lib: { entry: path.resolve(__dirname, "src/main.tsx"), name: "BrainStudioBundle", formats: ["iife"], fileName: () => "brain-studio.js" },
    outDir: "dist", emptyOutDir: true, cssCodeSplit: false, sourcemap: false, target: "es2019",
  },
});
