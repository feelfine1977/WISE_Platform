import { cleanup, configure } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(cleanup);

// The hosted Windows runners are several times slower than a desk computer: a first render of the map can take more
// than the default one second that findBy and waitFor wait, without being wrong.
configure({ asyncUtilTimeout: 10_000 });

// The test page has no 2D canvas, so the map measures its texts by estimate. Said here once, in place of the page's report of it at every map.
HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
