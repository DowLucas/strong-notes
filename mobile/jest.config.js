module.exports = {
  preset: 'jest-expo',
  setupFiles: ['<rootDir>/test-shims/jest.setup.js'],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg)',
  ],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
    '^expo-sqlite$': '<rootDir>/test-shims/expo-sqlite.js',
    '^react-native-safe-area-context$': '<rootDir>/test-shims/react-native-safe-area-context.js',
  },
};
