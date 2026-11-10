'use client';
import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { Button } from './ui/button';
export function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const d = localStorage.getItem('paperlens-theme') === 'dark';
    setDark(d);
    document.documentElement.classList.toggle('dark', d);
  }, []);
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={dark ? 'Use light mode' : 'Use dark mode'}
      onClick={() => {
        setDark(!dark);
        document.documentElement.classList.toggle('dark', !dark);
        localStorage.setItem('paperlens-theme', !dark ? 'dark' : 'light');
      }}
    >
      {dark ? <Sun /> : <Moon />}
    </Button>
  );
}
