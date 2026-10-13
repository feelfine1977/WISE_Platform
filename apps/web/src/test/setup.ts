import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(cleanup);

// The test page has no 2D canvas, so the map measures its texts by estimate. Said here once, in place of the page's report of it at every map.
HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
