import { prefersReducedMotion } from '../utils/dom.js';

export function fireConfetti(level = 1) {
  if (prefersReducedMotion()) return;
  const canvas = document.createElement('canvas');
  Object.assign(canvas.style, { position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: 9999 });
  canvas.setAttribute('aria-hidden', 'true');
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  const resize = () => { canvas.width = innerWidth; canvas.height = innerHeight; };
  resize();
  const particles = [];
  const colors = ['#b3261e', '#ff8f00', '#43a047', '#1e88e5', '#8e24aa', '#00897b', '#fdd835', '#5d4037'];
  const count = 60 + level * 20;
  for (let i = 0; i < count; i++) {
    particles.push({ x: Math.random() * canvas.width, y: -20 - Math.random() * 40, r: 4 + Math.random() * 6, c: colors[i % colors.length], vy: 2 + Math.random() * 3 + level * 0.5, vx: (Math.random() - 0.5) * 6, g: 0.15, a: 1 });
  }
  let t = 0; const maxT = 120;
  function tick() {
    t++; ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const p of particles) {
      p.vy += p.g; p.y += p.vy; p.x += p.vx; p.a -= 0.008; if (p.a < 0) p.a = 0;
      ctx.globalAlpha = p.a; ctx.fillStyle = p.c; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
    }
    if (t < maxT) requestAnimationFrame(tick); else canvas.remove();
  }
  requestAnimationFrame(tick);
  window.addEventListener('resize', resize, { once: true });
}
