import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
<<<<<<< HEAD
  // Tauri-specific configurations
  server: {
    port: 5173,
    strictPort: true, // Prevents Vite from automatically trying a random port if 5173 is busy
    watch: {
      // Tells Vite to ignore the Rust backend changes so it doesn't trigger endless frontend reloads
      ignored: ["**/src-tauri/**"],
    },
  },
})
=======
})
>>>>>>> 2579928da3c7226ec8c9bb63ace4249848a1f5b0
