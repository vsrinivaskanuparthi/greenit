// SYNTHETIC revision; fewer findings do not establish lower emissions.
import { useEffect } from 'react';
export function Status() {
  useEffect(() => {
    const timer = setInterval(() => console.log('refresh'), 5000);
    return () => clearInterval(timer);
  }, []);
  return <p>Example status</p>;
}
