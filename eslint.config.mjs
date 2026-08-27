import { defineConfig } from "eslint/config";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

export default defineConfig([
  {
    // Vendored-style shims for react-icons, not application code.
    ignores: ["stubs/**"],
  },
  {
    extends: [...nextCoreWebVitals],
  },
  {
    // eslint-plugin-react-hooks@7 newly enables these React Compiler rules as
    // errors. They flag pre-existing code that eslint-config-next@15 never
    // checked; keep them visible as warnings rather than making this upgrade
    // a red gate. Fixing the findings is follow-up work, not part of the bump.
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
    },
  },
]);
