const store = new Map();

async function getItem(key) {
  return store.has(key) ? store.get(key) : null;
}

async function setItem(key, value) {
  store.set(key, value);
  return value;
}

async function removeItem(key) {
  store.delete(key);
}

async function iterate(iterator) {
  let index = 1;
  for (const [key, value] of store.entries()) {
    const result = iterator(value, key, index++);
    if (result !== undefined) {
      return result;
    }
  }
  return undefined;
}

export default {
  getItem,
  setItem,
  removeItem,
  iterate,
};
