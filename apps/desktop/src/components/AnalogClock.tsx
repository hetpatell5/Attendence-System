import { useEffect, useState } from 'react';

const QUOTES = [
  { text: 'Punctuality is the soul of business and the key to excellence.', author: 'Thomas Chandler' },
  { text: 'Time is the most valuable thing a man can spend.', author: 'Theophrastus' },
  { text: 'Focus on being productive instead of busy.', author: 'Tim Ferriss' },
  { text: 'Small disciplines repeated with consistency lead to great achievements.', author: 'John C. Maxwell' },
  { text: 'Your time is limited, make every single day count.', author: 'Steve Jobs' },
];

export function AnalogClock(): JSX.Element {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => {
      setTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const seconds = time.getSeconds();
  const minutes = time.getMinutes();
  const hours = time.getHours();

  // Mathematical hand angles in degrees around center (100, 100)
  const secondDeg = seconds * 6;
  const minuteDeg = minutes * 6 + seconds * 0.1;
  const hourDeg = (hours % 12) * 30 + minutes * 0.5;

  // Pick quote based on day of year
  const dayOfYear = Math.max(
    0,
    Math.floor((time.getTime() - new Date(time.getFullYear(), 0, 0).getTime()) / 1000 / 60 / 60 / 24)
  );
  const quote = QUOTES[dayOfYear % QUOTES.length];

  return (
    <div className="flex h-full w-full flex-col items-center justify-between p-8 text-white select-none">
      {/* Spacer to balance vertical layout */}
      <div className="h-4" />

      {/* Swiss-Minimalist Watch Face */}
      <div className="relative flex flex-col items-center my-auto">
        <div className="relative flex items-center justify-center">
          {/* Subtle Ambient Back-Glow */}
          <div className="absolute h-48 w-48 rounded-full bg-orange-500/5 blur-3xl" />

          {/* Precision SVG Dial */}
          <svg className="relative h-64 w-64 drop-shadow-xl" viewBox="0 0 200 200">
            <defs>
              <radialGradient id="dialBase" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#1c1d22" />
                <stop offset="100%" stopColor="#0c0d10" />
              </radialGradient>
            </defs>

            {/* Dial background */}
            <circle
              cx="100"
              cy="100"
              r="94"
              fill="url(#dialBase)"
              stroke="rgba(255, 255, 255, 0.1)"
              strokeWidth="1.2"
            />
            <circle
              cx="100"
              cy="100"
              r="90"
              fill="none"
              stroke="rgba(255, 255, 255, 0.03)"
              strokeWidth="0.8"
            />

            {/* 60 Minute Ticks & 12 Major Hour Markers */}
            {Array.from({ length: 60 }).map((_, i) => {
              const isMajor = i % 5 === 0;
              const angle = i * 6;
              const rad = (angle * Math.PI) / 180;
              const rOuter = 86;
              const rInner = isMajor ? 76 : 82;
              const x1 = 100 + rOuter * Math.sin(rad);
              const y1 = 100 - rOuter * Math.cos(rad);
              const x2 = 100 + rInner * Math.sin(rad);
              const y2 = 100 - rInner * Math.cos(rad);

              return (
                <line
                  key={i}
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke={isMajor ? 'rgba(255, 255, 255, 0.85)' : 'rgba(255, 255, 255, 0.2)'}
                  strokeWidth={isMajor ? 1.8 : 0.8}
                  strokeLinecap="round"
                />
              );
            })}

            {/* Hour Hand (Clean solid white baton) */}
            <g transform={`rotate(${hourDeg} 100 100)`}>
              <line
                x1="100"
                y1="108"
                x2="100"
                y2="52"
                stroke="#ffffff"
                strokeWidth="3.2"
                strokeLinecap="round"
              />
            </g>

            {/* Minute Hand (Sleek light silver baton) */}
            <g transform={`rotate(${minuteDeg} 100 100)`}>
              <line
                x1="100"
                y1="112"
                x2="100"
                y2="30"
                stroke="#e4e4e7"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </g>

            {/* Second Hand (Minimalist Orange/Red needle with counterweight) */}
            <g transform={`rotate(${secondDeg} 100 100)`}>
              <line
                x1="100"
                y1="120"
                x2="100"
                y2="22"
                stroke="#f97316"
                strokeWidth="1.2"
                strokeLinecap="round"
              />
              <circle cx="100" cy="116" r="2.5" fill="#f97316" />
            </g>

            {/* Precision Center Pin */}
            <circle cx="100" cy="100" r="4.5" fill="#18181b" stroke="#f97316" strokeWidth="1.5" />
            <circle cx="100" cy="100" r="1.5" fill="#ffffff" />
          </svg>
        </div>

        {/* Digital Time Display */}
        <div className="mt-6 flex flex-col items-center">
          <div className="font-mono text-3xl font-bold tracking-wider text-white">
            {time.toLocaleTimeString('en-IN', {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
              hour12: true,
            })}
          </div>
          <div className="mt-1 text-xs font-medium tracking-wide text-zinc-400">
            {time.toLocaleDateString('en-IN', {
              weekday: 'long',
              day: '2-digit',
              month: 'short',
              year: 'numeric',
            })}
          </div>
        </div>
      </div>

      {/* Quote / Motivational Footer */}
      <div className="w-full max-w-xs rounded-xl border border-white/10 bg-white/[0.02] p-3.5 text-center backdrop-blur-sm">
        <p className="text-xs font-light italic leading-relaxed text-zinc-300">
          &ldquo;{quote?.text ?? 'Focus on being productive instead of busy.'}&rdquo;
        </p>
        <p className="mt-1.5 text-[10px] font-medium tracking-wider uppercase text-zinc-500">
          — {quote?.author ?? 'Productivity'}
        </p>
      </div>
    </div>
  );
}
