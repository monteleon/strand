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
      keyframes: {
        "hero-drift": {
          "0%, 100%": { transform: "translate3d(0, 0, 0) scale(1)" },
          "25%":      { transform: "translate3d(12px, -8px, 0) scale(1.02)" },
          "50%":      { transform: "translate3d(-10px, 10px, 0) scale(1)" },
          "75%":      { transform: "translate3d(6px, -4px, 0) scale(1.03)" },
        },
      },
      animation: {
        "hero-drift": "hero-drift 60s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
