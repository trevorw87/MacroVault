const assert = require("node:assert/strict");
const { escapeHtml, safeHttpUrl, safeImageUrl, safeCssToken } = require("../frontend-utils.js");

assert.equal(escapeHtml(`<img src=x onerror='bad'>`), "&lt;img src=x onerror=&#039;bad&#039;&gt;");
assert.equal(safeHttpUrl("javascript:alert(1)"), "");
assert.equal(safeHttpUrl("data:text/html,bad"), "");
assert.equal(safeHttpUrl("https://example.com/recipe"), "https://example.com/recipe");
assert.equal(safeImageUrl("data:image/svg+xml,<svg onload=alert(1)></svg>"), "");
assert.match(safeImageUrl("data:image/png;base64,AAAA"), /^data:image\/png/);
assert.equal(safeImageUrl("api/images/img-toast"), "api/images/img-toast");
assert.equal(safeCssToken("ashley"), "ashley");
assert.equal(safeCssToken("x\" onclick=bad"), "default");

console.log("Frontend safety utilities: PASS");
