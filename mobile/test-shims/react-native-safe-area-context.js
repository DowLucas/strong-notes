const React = require('react');

const ZERO_INSETS = { top: 0, right: 0, bottom: 0, left: 0 };
const ZERO_FRAME = { x: 0, y: 0, width: 320, height: 640 };

function SafeAreaProvider({ children }) {
  return children;
}

module.exports = {
  SafeAreaProvider,
  SafeAreaConsumer: ({ children }) => children(ZERO_INSETS),
  SafeAreaInsetsContext: React.createContext(ZERO_INSETS),
  SafeAreaFrameContext: React.createContext(ZERO_FRAME),
  useSafeAreaInsets: () => ZERO_INSETS,
  useSafeAreaFrame: () => ZERO_FRAME,
  initialWindowMetrics: { insets: ZERO_INSETS, frame: ZERO_FRAME },
};
