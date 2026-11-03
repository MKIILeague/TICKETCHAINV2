export async function withTimeout(promise, ms = 8000) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Request timed out')), ms); }),
    ]);
  } finally { clearTimeout(timer); }
}
