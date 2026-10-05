// SYNTHETIC source; never executed by the scanner.
import { useEffect } from 'react';
export function Status() {
  useEffect(() => {
    const timer = setInterval(() => console.log('refresh'), 100);
  }, []);
  return <p>Example status</p>;
}
