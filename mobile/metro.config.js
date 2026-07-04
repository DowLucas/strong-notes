// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// expo-sqlite's web implementation loads a WASM build (wa-sqlite) that Metro's
// default resolver doesn't recognize as an asset extension out of the box.
// Native iOS/Android use real SQLite and never hit this path.
config.resolver.assetExts.push('wasm');

config.server = {
  ...config.server,
  enhanceMiddleware: (middleware) => {
    return (req, res, next) => {
      // wa-sqlite's WASM build needs a cross-origin isolated context to use
      // SharedArrayBuffer for its worker-backed storage on web.
      res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
      res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
      return middleware(req, res, next);
    };
  },
};

module.exports = config;
