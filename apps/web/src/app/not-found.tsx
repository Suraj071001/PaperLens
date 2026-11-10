import Link from 'next/link';
export default function NotFound() {
  return (
    <main className="center-state">
      <h1>This page isn’t in the collection.</h1>
      <p>The link may be out of date.</p>
      <Link href="/dashboard">← Return to your projects</Link>
    </main>
  );
}
