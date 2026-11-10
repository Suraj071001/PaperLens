'use client';
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="center-state">
      <h2>Something interrupted this page.</h2>
      <p>Your saved projects are still there.</p>
      <button onClick={reset}>Try again</button>
    </main>
  );
}
