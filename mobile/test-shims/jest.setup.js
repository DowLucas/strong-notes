// React Native's jest mock of TextInput exposes clear/isFocused/getNativeRef
// on the ref but not setSelection (which the real component has). The editor
// places the caret through it after programmatic inserts; give the mock a
// no-op so components can call it and tests can spy on it.
const { TextInput } = require('react-native');

if (typeof TextInput.prototype.setSelection !== 'function') {
  TextInput.prototype.setSelection = function setSelection() {};
}
