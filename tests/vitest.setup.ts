import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// Next's `server-only` package intentionally throws when evaluated outside the
// Next compiler. Unit tests may import server actions and shared domain modules
// to exercise their pure boundaries, so the marker is neutralized in Vitest;
// production builds still enforce the real client/server boundary.
vi.mock("server-only", () => ({}));
