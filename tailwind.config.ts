import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "hsl(var(--bg-canvas))",
        surface: "hsl(var(--bg-surface))",
        overlay: "hsl(var(--bg-overlay))",
        "border-subtle": "hsl(var(--border-subtle))",
        "border-strong": "hsl(var(--border-strong))",
        "text-primary": "hsl(var(--text-primary))",
        "text-secondary": "hsl(var(--text-secondary))",
        "text-tertiary": "hsl(var(--text-tertiary))",
        "accent-signal": "hsl(var(--accent-signal))",
        "accent-warmth": "hsl(var(--accent-warmth))",
      },
      fontFamily: {
        display: ["var(--font-display)", "Inter", "system-ui", "sans-serif"],
        sans: ["var(--font-sans)", "Inter", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "JetBrains Mono", "ui-monospace", "monospace"],
      },
      borderRadius: {
        sm: "var(--radius-sm)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
      },
      transitionDuration: {
        fast: "var(--motion-fast)",
        base: "var(--motion-base)",
        slow: "var(--motion-slow)",
        graph: "var(--motion-graph)",
      },
      transitionTimingFunction: {
        "cubic-out": "var(--motion-ease-out)",
        "cubic-inout": "var(--motion-ease-inout)",
      },
    },
  },
  plugins: [],
};

export default config;
