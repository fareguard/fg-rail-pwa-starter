'use client';

import { useEffect } from 'react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface the actual error to the console so we can see which file caused it
    console.error('Dashboard route error:', error);
  }, [error]);

  return (
    <div style={{ padding: 24 }}>
      <h2>Something went wrong loading your dashboard.</h2>
      <p style={{ color: '#c62828' }}>
        {error?.message || 'Unknown error'} {error?.['digest'] ? `(digest ${error['digest']})` : ''}
      </p>
      <button
        onClick={() => reset()}
        style={{
          marginTop: 12,
          padding: '10px 14px',
          borderRadius: 8,
          border: '1px solid #e6eef7',
          cursor: 'pointer',
        }}
      >
        Try again
      </button>
    </div>
  );
}
