module.exports = {
  preset: 'jest-expo',
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg)',
  ],
  moduleNameMapper: {
    // expo-sqlite is a native module with no Node-compatible build, and
    // jest-expo doesn't mock its SQL behavior. Redirect it to a
    // better-sqlite3-backed shim (test-only) so repo tests exercise real
    // SQL instead of hand-rolled fakes. Production code still imports the
    // real `expo-sqlite`.
    '^expo-sqlite$': '<rootDir>/test-shims/expo-sqlite.js',
  },
};
