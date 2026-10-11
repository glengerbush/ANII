try {
  const response = await fetch(`http://127.0.0.1:${process.env.PORT ?? 3000}/today`, {
    signal: AbortSignal.timeout(4000), redirect: 'manual'
  });
  process.exitCode = response.status === 200 ? 0 : 1;
} catch {
  process.exitCode = 1;
}
