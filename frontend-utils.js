(function attachMacroVaultUtils(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.MacroVaultUtils = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createMacroVaultUtils() {
  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#039;"
    }[character]));
  }

  function safeHttpUrl(value) {
    try {
      const url = new URL(String(value || "").trim());
      return ["http:", "https:"].includes(url.protocol) ? url.href : "";
    } catch {
      return "";
    }
  }

  function safeImageUrl(value) {
    const candidate = String(value || "").trim();
    if (/^(?:blob:|data:image\/(?:png|jpe?g|gif|webp);base64,)/i.test(candidate)) return candidate;
    if (/^(?:\.\/)?api\/images\/[a-z0-9._~-]+$/i.test(candidate)) return candidate;
    return safeHttpUrl(candidate);
  }

  function safeCssToken(value, fallback = "default") {
    const token = String(value || "").trim().toLowerCase();
    return /^[a-z][a-z0-9_-]{0,48}$/.test(token) ? token : fallback;
  }

  function decodeTextEntities(value) {
    const namedEntities = {
      amp: "&",
      apos: "'",
      gt: ">",
      lt: "<",
      nbsp: " ",
      quot: "\""
    };
    return String(value ?? "").replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi, (entity, decimal, hexadecimal, named) => {
      if (decimal) return String.fromCodePoint(Number(decimal));
      if (hexadecimal) return String.fromCodePoint(parseInt(hexadecimal, 16));
      return namedEntities[named.toLowerCase()] ?? entity;
    });
  }

  function plainIngredientText(value) {
    return decodeTextEntities(value)
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/<[^>]+>/g, " ")
      .replace(/(\*\*|__)(.*?)\1/g, "$2")
      .replace(/([*_])([^*_]+)\1/g, "$2")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/\\([*_`[\]()]|\\)/g, "$1")
      .replace(/\s+/g, " ")
      .trim();
  }

  function stripIngredientBullet(value) {
    return plainIngredientText(value)
      .replace(/^\s*(?:(?:[•●◦○▪▫■□‣⁃·∙⋅]+|[-*]+)\s*|\(?\d{1,2}[.)]\s+)/u, "")
      .trim();
  }

  return { escapeHtml, safeHttpUrl, safeImageUrl, safeCssToken, stripIngredientBullet };
});
